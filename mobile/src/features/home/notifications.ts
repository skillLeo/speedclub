/**
 * HOME-02: the text of a notification is made here, from `type`, `actors` and `actor_count` (the API sends no sentences, so every
 * language has its own grammar and plurals), and so is the day it belongs to and the page it opens.
 */
import type { Href } from 'expo-router';
import type { TFunction } from 'i18next';

import type { AppNotification } from '@/api/queries/notifications';
import { formatDueMonth } from '@/features/garage/huAu';
import i18n from '@/i18n';
import { formatNumber, keepNameTogether, type FormatLocale } from '@/lib/format';
import type { IconName } from '@/ui';

const ZONE = 'Europe/Berlin';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day in Berlin, "2026-11-03": the key of a day group. */
export function berlinDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Milliseconds until the next Berlin day starts: when "Heute" becomes "Gestern". */
export function msUntilNextBerlinDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + date.getMilliseconds();
  return Math.max(1000, DAY_MS - elapsed);
}

/** Whole Berlin days between two keys. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** FS-7 day separators: "Heute", "Gestern", then "Mo., 3. Nov." ("Mon, Nov 3"), with the year when it is not this year's. */
export function dayLabel(date: Date, now: Date, locale: FormatLocale, t: TFunction): string {
  const day = berlinDayKey(date);
  const today = berlinDayKey(now);
  const ago = daysBetween(day, today);
  if (ago === 0) return t('notifications.today');
  if (ago === 1) return t('notifications.yesterday');
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export type NotificationListRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'row'; key: string; notification: AppNotification };

/** Newest first, a day header before the first row of each Berlin day. A row without a valid date joins the day before it. */
export function groupByDay(
  rows: readonly AppNotification[],
  now: Date,
  locale: FormatLocale,
  t: TFunction,
): NotificationListRow[] {
  const list: NotificationListRow[] = [];
  let current: string | null = null;
  for (const notification of rows) {
    const date = notification.created_at ? new Date(notification.created_at) : null;
    if (date && !Number.isNaN(date.getTime())) {
      const day = berlinDayKey(date);
      if (day !== current) {
        current = day;
        list.push({ kind: 'day', key: `day.${day}`, label: dayLabel(date, now, locale, t) });
      }
    }
    list.push({ kind: 'row', key: notification.id, notification });
  }
  return list;
}

/**
 * DQ-305: a vehicle name in a sentence keeps its last two words on one line ("Nissan Silvia S15", never "Silvia / S15" with the code
 * alone), and a hyphenated name stays whole.
 */
function keepLastWordWithNext(name: string): string {
  return keepNameTogether(name.replace(/ (\S+)$/, '\u00A0$1'));
}

/** A member as the text names them: "@lukas.sc". */
const handle = (actor: { username: string }) => `@${actor.username}`;

/** `details`: what else the type needs, language-free (followed_published, build_saved, security). */
function dataOf(notification: Pick<AppNotification, 'details'>): Record<string, unknown> {
  const data = notification.details as unknown;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

const numberIn = (data: Record<string, unknown>, key: string): number | null => {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const stringIn = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
};

/** What a reporter learns of a decision (`report_decided` details). */
const REPORT_OUTCOMES = new Set(['no_action', 'remove_content', 'measures', 'reversed']);

/** A support request's reference as the receipt mail names it ("SC-7H2KQXMB"). */
const TICKET_REFERENCE = /^SC-[A-Z0-9]{4,16}$/;
/** A ticket id (ULID) that may go into a path. */
const TICKET_ID = /^[0-9A-Za-z]{10,40}$/;

/** The decisions that have a sentence of their own (`no_action` never reaches the affected member). */
const MODERATION_ACTIONS = new Set(['remove_content', 'restrict', 'suspend', 'reverse']);

/** The security events of the §7 matrix that have a sentence of their own. */
const SECURITY_EVENTS = new Set([
  'new_device',
  'password_changed',
  'email_changed',
  'two_factor_changed',
  'deletion_requested',
  // M2.5: SET-06 and the second-factor guard (ADR-203 f).
  'sessions_revoked',
  'verification_failed',
  'recovery_code_used',
]);

/**
 * The sentence of a row, in the app's language:
 * - new_follower: "@lukas.sc folgt dir jetzt", "@lukas.sc und @max.e46 folgen dir jetzt", "@lukas.sc und 3 weitere folgen dir jetzt"
 * - followed_published: "@lukas.sc hat Nissan Skyline GT-R R34 veröffentlicht", "… hat Nissan Skyline GT-R R34 aktualisiert", or for a
 *   day with more: "@lukas.sc hat 3 Build-Updates veröffentlicht"
 * - build_saved: "3 Mitglieder haben deinen Nissan Skyline GT-R R34 gespeichert" (never who)
 * - security: one sentence per event.
 * - moderation_decision (M2.6): what was decided, "Tippe für die Begründung"; report_decided: the outcome of the report ("… und den Inhalt entfernt").
 * - support_reply: "Das Team hat auf deine Anfrage SC-7H2KQXMB geantwortet".
 * - qr_milestone [SIG]: "Dein QR-Code für Nissan Skyline GT-R R34 wurde 100-mal gescannt"; hu_au_reminder [SIG]: "HU/AU für … ist im
 *   März 2027 fällig".
 * A row whose actor is gone (blocked, deleted) names "Ein Mitglied".
 */
export function notificationText(notification: AppNotification, t: TFunction): string {
  const data = dataOf(notification);
  const [first, second] = notification.actors;
  const actor = first ? handle(first) : t('notifications.someone');
  const vehicle = keepLastWordWithNext(notification.vehicle?.full_title?.trim() || t('notifications.aBuild'));
  switch (notification.type) {
    case 'new_follower': {
      const total = Math.max(notification.actor_count, notification.actors.length, 1);
      if (total === 1) return t('notifications.text.newFollower', { actor });
      if (total === 2 && second) return t('notifications.text.newFollowerTwo', { actor, other: handle(second) });
      return t('notifications.text.newFollowerMany', { actor, count: total - 1 });
    }
    case 'followed_published': {
      // One row per actor and day: `vehicles` builds published and `updates` build updates posted, `kind` the latest of them.
      const vehicles = numberIn(data, 'vehicles') ?? 0;
      const updates = numberIn(data, 'updates') ?? 0;
      if (vehicles + updates > 1) {
        if (updates === 0) return t('notifications.text.followedBuilds', { actor, count: vehicles });
        if (vehicles === 0) return t('notifications.text.followedUpdates', { actor, count: updates });
        return t('notifications.text.followedMixed', { actor, count: vehicles + updates });
      }
      return stringIn(data, 'kind') === 'vehicle'
        ? t('notifications.text.followedPublished', { actor, vehicle })
        : t('notifications.text.followedUpdated', { actor, vehicle });
    }
    case 'build_saved': {
      const count = numberIn(data, 'count') ?? Math.max(notification.actor_count, 1);
      const title = notification.vehicle?.full_title?.trim();
      const shown = title ? keepLastWordWithNext(title) : null;
      return shown ? t('notifications.text.buildSaved', { count, vehicle: shown }) : t('notifications.text.buildSavedAny', { count });
    }
    case 'security': {
      const event = stringIn(data, 'event');
      const device = stringIn(data, 'device_name');
      if (event === 'new_device' && device) return t('notifications.text.security.new_device_named', { device });
      return event && SECURITY_EVENTS.has(event) ? t(`notifications.text.security.${event}`) : t('notifications.text.security.other');
    }
    case 'moderation_decision': {
      // M2.6: a decision about your content or account; the row names the action, the statement of reasons is on SAFE-01.
      const action = stringIn(data, 'action');
      return action && MODERATION_ACTIONS.has(action) ? t(`notifications.text.moderation.${action}`) : t('notifications.text.moderation.other');
    }
    case 'report_decided': {
      // `outcome` only, never the measure that hit the other member (handover §11.2).
      const outcome = stringIn(data, 'outcome');
      return outcome && REPORT_OUTCOMES.has(outcome) ? t(`notifications.text.reportDecidedOutcome.${outcome}`) : t('notifications.text.reportDecided');
    }
    case 'qr_milestone': {
      const milestone = numberIn(data, 'milestone');
      if (milestone === null) return t('notifications.text.other');
      const scans = formatNumber(milestone, localeOf(t));
      const title = notification.vehicle?.full_title?.trim();
      return title ? t('notifications.text.qrMilestone', { scans, vehicle: keepLastWordWithNext(title) }) : t('notifications.text.qrMilestoneAny', { scans });
    }
    case 'hu_au_reminder': {
      const due = stringIn(data, 'due');
      const month = due ? formatDueMonth(due, localeOf(t)) : null;
      if (!month) return t('notifications.text.other');
      const title = notification.vehicle?.full_title?.trim();
      return title ? t('notifications.text.huAuReminder', { month, vehicle: keepLastWordWithNext(title) }) : t('notifications.text.huAuReminderAny', { month });
    }
    case 'catalog_request': {
      // M3.3: the answer to the member's catalogue request (ADM-14); a refusal names the team's reason right in the row.
      const title = notification.vehicle?.full_title?.trim() || stringIn(data, 'requested')?.trim();
      const named = title ? keepLastWordWithNext(title) : t('notifications.text.catalogRequest.yourVehicle');
      if (stringIn(data, 'outcome') === 'accepted') return t('notifications.text.catalogRequest.accepted', { vehicle: named });
      const reason = stringIn(data, 'reason')?.trim();
      return reason
        ? t('notifications.text.catalogRequest.rejectedReason', { vehicle: named, reason })
        : t('notifications.text.catalogRequest.rejected', { vehicle: named });
    }
    case 'support_reply': {
      // ADR-249: the team answered one of the member's support requests; the row names its reference, SET-15b shows the answer.
      const reference = stringIn(data, 'reference');
      return reference && TICKET_REFERENCE.test(reference)
        ? t('notifications.text.supportReply', { reference })
        : t('notifications.text.supportReplyAny');
    }
    default:
      return t('notifications.text.other');
  }
}

/** Figures and months in the language of the text ("1.000", "März 2027"): a fixed `t` carries its own, else the app's. */
function localeOf(t: TFunction): FormatLocale {
  const language = (t as unknown as { lng?: string }).lng ?? i18n.language ?? 'de';
  return language.startsWith('en') ? 'en' : 'de';
}

/** The glyph in place of an avatar, for rows without an actor to show. */
export function notificationIcon(notification: Pick<AppNotification, 'type'>): IconName {
  switch (notification.type) {
    case 'new_follower':
      return 'user';
    case 'followed_published':
      return 'garage';
    case 'build_saved':
      return 'bookmark-simple';
    case 'security':
      return 'lock-simple';
    case 'moderation_decision':
      return 'scales';
    case 'report_decided':
      return 'flag';
    case 'qr_milestone':
      return 'qr-code';
    case 'hu_au_reminder':
      return 'clock';
    case 'catalog_request':
      return 'garage';
    case 'support_reply':
      return 'lifebuoy';
    default:
      return 'bell';
  }
}

/**
 * Where a row leads: one new follower → their profile, several → your Follower list; a followed build or update → its page or
 * Verlauf entry; a saved build → your vehicle; security → the settings; a decision or a decided report → SAFE-01. Null when the target
 * is gone.
 */
export function notificationTarget(notification: AppNotification, own: string | null | undefined): Href | null {
  const data = dataOf(notification);
  const [first] = notification.actors;
  switch (notification.type) {
    case 'new_follower':
      if (notification.actor_count <= 1 && first) {
        return own && own.toLowerCase() === first.username.toLowerCase() ? '/profile' : `/u/${first.username}`;
      }
      return { pathname: '/profile/connections', params: { tab: 'followers' } };
    case 'followed_published': {
      const vehicle = notification.vehicle;
      if (!vehicle) return first ? `/u/${first.username}` : null;
      const updateId = stringIn(data, 'update_id');
      const single = (numberIn(data, 'vehicles') ?? 0) + (numberIn(data, 'updates') ?? 0) <= 1;
      if (!single && first) return own && own.toLowerCase() === first.username.toLowerCase() ? '/profile' : `/u/${first.username}`;
      return updateId && stringIn(data, 'kind') !== 'vehicle' ? `/v/${vehicle.slug}/updates/${updateId}` : `/v/${vehicle.slug}`;
    }
    case 'build_saved':
      return notification.vehicle ? `/garage/${notification.vehicle.id}` : '/garage';
    case 'security':
      return '/settings';
    case 'moderation_decision':
    case 'report_decided': {
      // SAFE-01; without the id, the list of SET-16.
      const decisionId = stringIn(data, 'decision_id');
      return decisionId ? { pathname: '/decision/[id]', params: { id: decisionId } } : '/settings/reports';
    }
    // [SIG] QR-02 with its scans; GAR-06 with the HU/AU month. Without the vehicle: the QR list and the garage.
    case 'qr_milestone':
      return notification.vehicle ? `/qr/${notification.vehicle.id}` : '/profile/qr';
    case 'hu_au_reminder':
      return notification.vehicle ? `/garage/${notification.vehicle.id}/specs` : '/garage';
    // M3.3: the member's own vehicle the request was for (GAR-02), else the garage.
    case 'catalog_request':
      return notification.vehicle ? `/garage/${notification.vehicle.id}` : '/garage';
    // ADR-249: the request's thread (SET-15b), else the list of requests (SET-15a).
    case 'support_reply': {
      const ticketId = stringIn(data, 'ticket_id');
      return ticketId && TICKET_ID.test(ticketId)
        ? { pathname: '/settings/help/requests/[ticket]', params: { ticket: ticketId } }
        : '/settings/help/requests';
    }
    default:
      return null;
  }
}
