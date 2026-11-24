/**
 * The view beacon (10 §6.1, m5.7-contract §2.3, §3.1): VEH-01 and PROF-02 send `POST views` once per open of somebody else's public
 * page, in the native app with source `app`, on the member web with `web`, `shared_link` when the page was opened from a link with
 * `?via=share`, and `sticker_scan` when it was opened from a sticker (`/c/{code}` in the app).
 *
 * Never sent: before the screen is focused (a preloaded or prefetched route renders unfocused), on a revalidation or refetch (once per
 * screen instance, and once per subject and Berlin day in this app run), for QA renders (any `qa*` override), in staff view-as, on the
 * owner's own page, for sample content, offline, or while the `insights` flag is off. Fire and forget: no retry, no offline replay.
 * The server dedupes again per person, page and day, so these rules only keep the app from sending what can never count.
 */
import { useEffect, useRef } from 'react';

import { isViewAsTab } from '@/api/clientViewAs';
import { useFlag } from '@/api/queries/appConfig';
import { INSIGHTS_FLAG, postView, type ViewBeaconBody, type ViewSource } from '@/api/queries/insights';
import { now } from '@/lib/clock';
import { TIME_ZONE } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useScreenFocused } from '@/ui/SkeletonFocus';

export type ViewTarget = { subject: 'vehicle'; id: string } | { subject: 'profile'; username: string };

/** What the beacon knows about the page on screen. `ready` once the page's own data has loaded. */
export type BeaconInput = {
  target: ViewTarget | null;
  ready: boolean;
  /** The viewer owns the car, or this is the viewer's own profile. */
  own: boolean;
  /** The car or member is sample content (09 §8.19). */
  sample: boolean;
  /** The route's `via` parameter ("share" from a shared link). */
  via?: string | null;
  /** The slug of the car, to pick up a sticker scan that opened it. */
  slug?: string | null;
};

export type BeaconContext = {
  focused: boolean;
  online: boolean;
  enabled: boolean;
  viewAs: boolean;
  qaRender: boolean;
};

/** The calendar day in Berlin, "2026-11-16": the server's dedupe window (contract D-3). */
export function berlinDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function targetKey(target: ViewTarget): string {
  return target.subject === 'vehicle' ? `vehicle:${target.id}` : `profile:${target.username.toLowerCase()}`;
}

/** Subjects sent today in this app run (key + Berlin day). */
const sentToday = new Set<string>();
/** Slugs a sticker scan in the app is about to open, with the time it was noted. */
const stickerOpens = new Map<string, number>();
/** A sticker scan's hand-over to VEH-01 is consumed within this time, so a later, ordinary visit of the same car is not one. */
const STICKER_HANDOFF_MS = 2 * 60 * 1000;

/** `/c/{code}` in the app resolved to this car: the VEH-01 it opens next counts as a sticker scan. */
export function noteStickerScanOpen(slug: string): void {
  if (slug) stickerOpens.set(slug, now().getTime());
}

function takeStickerOpen(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const at = stickerOpens.get(slug);
  if (at === undefined) return false;
  stickerOpens.delete(slug);
  return now().getTime() - at <= STICKER_HANDOFF_MS;
}

/** Tests only. */
export function resetBeaconForTests(): void {
  sentToday.clear();
  stickerOpens.clear();
}

/** Whether any QA override is set (never in production, where `qa` is empty): a QA render never counts. */
export function isQaRender(overrides: object = qa): boolean {
  return Object.keys(overrides).length > 0;
}

/** The source of this open (contract §2.3): a sticker scan first, then a shared link, else the platform. */
export function sourceOf(input: Pick<BeaconInput, 'via' | 'slug'>, web: boolean = isWeb, sticker: boolean = false): ViewSource {
  if (sticker) return 'sticker_scan';
  if (input.via === 'share') return 'shared_link';
  return web ? 'web' : 'app';
}

/** Why nothing goes out for this page right now, or null when the beacon may send. Pure, for the rules' tests. */
export function beaconBlock(input: BeaconInput, context: BeaconContext): string | null {
  if (!input.target) return 'no-target';
  if (!input.ready) return 'not-ready';
  if (!context.focused) return 'not-focused';
  if (context.qaRender) return 'qa';
  if (context.viewAs) return 'view-as';
  if (!context.enabled) return 'flag-off';
  if (input.own) return 'own';
  if (input.sample) return 'sample';
  if (!context.online) return 'offline';
  return null;
}

/** Sends the view once for this subject today; false when it was already sent in this run. */
export function sendViewOnce(target: ViewTarget, source: ViewSource, date: Date = now()): boolean {
  const key = `${targetKey(target)}|${berlinDayKey(date)}`;
  if (sentToday.has(key)) return false;
  sentToday.add(key);
  const body: ViewBeaconBody =
    target.subject === 'vehicle' ? { subject: 'vehicle', id: target.id, source } : { subject: 'profile', username: target.username, source };
  // Fire and forget: a failed beacon is not worth a retry, and an answer says nothing either way.
  postView(body).catch(() => undefined);
  return true;
}

/** One view per open of this screen: the first moment the rules allow it, never again for this screen instance. */
export function useViewBeacon(input: BeaconInput): void {
  const focused = useScreenFocused();
  const online = useOnline();
  const enabled = useFlag(INSIGHTS_FLAG);
  const sentFor = useRef<string | null>(null);
  const block = beaconBlock(input, { focused, online, enabled, viewAs: isViewAsTab(), qaRender: isQaRender() });
  const key = input.target ? targetKey(input.target) : null;

  useEffect(() => {
    if (block !== null || !input.target || key === null || sentFor.current === key) return;
    sentFor.current = key;
    sendViewOnce(input.target, sourceOf(input, isWeb, takeStickerOpen(input.slug)));
    // `input` is read once at the moment the rules allow the send; its identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, key]);
}
