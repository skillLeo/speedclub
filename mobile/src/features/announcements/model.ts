/**
 * Which announcements of app-config a viewer sees (M3.5 ADM-30): the server already drops what is outside its schedule, the app checks
 * the schedule again with its own clock (a config may be five minutes old) and decides the audience per viewer, as app-config says:
 * guests see `all` only, `new` is a member registered within 14 days, `with_vehicles` a member with at least one vehicle. A dismissed
 * announcement stays hidden on this device while it is dismissible.
 */
import type { Announcement } from '@/api/queries/appConfig';

export const NEW_MEMBER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AnnouncementViewer = { memberSince: string | null; vehicles: number } | null;

function inSchedule(announcement: Announcement, at: number): boolean {
  const starts = announcement.starts_at ? Date.parse(announcement.starts_at) : Number.NaN;
  const ends = announcement.ends_at ? Date.parse(announcement.ends_at) : Number.NaN;
  if (!Number.isNaN(starts) && starts > at) return false;
  if (!Number.isNaN(ends) && ends <= at) return false;
  return true;
}

function forAudience(announcement: Announcement, viewer: AnnouncementViewer, at: number): boolean {
  const audience = announcement.audience ?? 'all';
  if (audience === 'all') return true;
  if (!viewer) return false;
  if (audience === 'with_vehicles') return viewer.vehicles > 0;
  const since = viewer.memberSince ? Date.parse(viewer.memberSince) : Number.NaN;
  return !Number.isNaN(since) && at - since <= NEW_MEMBER_DAYS * DAY_MS;
}

/** The announcements to show, warnings first, each group in the server's order. */
export function visibleAnnouncements(
  announcements: readonly Announcement[],
  viewer: AnnouncementViewer,
  dismissed: ReadonlySet<string>,
  at: Date,
): Announcement[] {
  const time = at.getTime();
  const shown = announcements.filter(
    (announcement) =>
      announcement.title.trim() !== '' &&
      inSchedule(announcement, time) &&
      forAudience(announcement, viewer, time) &&
      !(announcement.dismissible !== false && dismissed.has(announcement.id)),
  );
  return [...shown.filter(isWarning), ...shown.filter((announcement) => !isWarning(announcement))];
}

/** Only a warning may use the accent (§3 red budget): every other announcement is neutral. */
export function isWarning(announcement: Pick<Announcement, 'severity'>): boolean {
  return announcement.severity === 'warning';
}

export type AnnouncementLink = { kind: 'internal'; path: string } | { kind: 'external'; url: string };

/** An internal path ("/discover?make=bmw") stays in the app, an https URL opens in the in-app browser; anything else is no link. */
export function announcementLink(link: string | null | undefined): AnnouncementLink | null {
  const value = link?.trim() ?? '';
  if (value.startsWith('/') && !value.startsWith('//')) return { kind: 'internal', path: value };
  if (/^https:\/\/[^\s/]+/i.test(value)) return { kind: 'external', url: value };
  return null;
}
