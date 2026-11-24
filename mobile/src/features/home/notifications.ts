/**
 * HOME-02: the text of a notification is made here, from `type`, `actors` and `actor_count` (the API sends no sentences, so every
 * language has its own grammar and plurals), and so is the day it belongs to and the page it opens.
 */
import type { Href } from 'expo-router';
import type { TFunction } from 'i18next';

import type { AppNotification } from '@/api/queries/notifications';
import { ownerSpotsRoute } from '@/features/dex/navigation';
import '@/features/events/i18n';
import '@/features/parts/i18n';
import { formatDueMonth } from '@/features/garage/huAu';
import { deviceNameText } from '@/features/settings/deviceLines';
import { passkeyOwnName } from '@/features/settings/passkeyName';
import i18n from '@/i18n';
import { formatNumber, keepNameTogether, type FormatLocale } from '@/lib/format';
import type { IconName } from '@/ui/icons/Icon';
import { machineNameText } from '@/ui/textBreaks';

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

/** 09 §7.4 filter chips: Alle · Builds · Social · Treffen · System. */
export const NOTIFICATION_FILTERS = ['all', 'builds', 'social', 'events', 'system'] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

const BUILD_TYPES = new Set<string>(['followed_published', 'build_saved', 'qr_milestone', 'hu_au_reminder', 'catalog_request', 'business_tag']);
// M5.9b: the grouped spot alert is filed under "Sozial" (its server category `social`).
// M5.8 (m5.8-contract D10): the forum's replies, mentions and solutions are filed under "Sozial" too.
// R4-2.3 (contract-crews §5): the crew rows are filed under "Sozial" too.
const SOCIAL_TYPES = new Set<string>(['new_follower', 'reaction', 'mention', 'comment', 'vehicle_follower', 'spot_alert', 'forum_reply', 'forum_mention', 'forum_solved', 'crew']);

/** The chip a row belongs to: builds, people, meets, or the system (security, moderation, support and anything unknown). */
export function notificationCategory(notification: Pick<AppNotification, 'type'>): Exclude<NotificationFilter, 'all'> {
  if (BUILD_TYPES.has(notification.type)) return 'builds';
  if (SOCIAL_TYPES.has(notification.type)) return 'social';
  if (notification.type.startsWith('event_')) return 'events';
  return 'system';
}

export function matchesFilter(notification: Pick<AppNotification, 'type'>, filter: NotificationFilter): boolean {
  return filter === 'all' || notificationCategory(notification) === filter;
}

/** 09 §7.4 sections: Heute · Gestern · Diese Woche (2–6 days ago) · Früher, by the Berlin day. */
export type NotificationSection = 'today' | 'yesterday' | 'week' | 'earlier';

export function sectionOf(date: Date, now: Date): NotificationSection {
  const ago = daysBetween(berlinDayKey(date), berlinDayKey(now));
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 7) return 'week';
  return 'earlier';
}

const SECTION_KEYS: Record<NotificationSection, string> = {
  today: 'notifications.today',
  yesterday: 'notifications.yesterday',
  week: 'notifications.thisWeek',
  earlier: 'notifications.earlier',
};

/**
 * Newest first, a section header before the first row of each section. A row without a valid date joins the section before it (or
 * Früher when it is the first). Header keys stay `day.<section>` for the screen's testIDs.
 */
export function groupBySection(rows: readonly AppNotification[], now: Date, t: TFunction): NotificationListRow[] {
  const list: NotificationListRow[] = [];
  let current: NotificationSection | null = null;
  for (const notification of rows) {
    const date = notification.created_at ? new Date(notification.created_at) : null;
    const section: NotificationSection = date && !Number.isNaN(date.getTime()) ? sectionOf(date, now) : (current ?? 'earlier');
    if (section !== current) {
      current = section;
      list.push({ kind: 'day', key: `day.${section}`, label: t(SECTION_KEYS[section]) });
    }
    list.push({ kind: 'row', key: notification.id, notification });
  }
  return list;
}

/**
 * The parts of a row's sentence set in bold (09 §7.4: "**Lukas** hat ein Update zu seinem **E46 M3** gepostet."): the members it names
 * and the vehicle, as `notificationText` writes them. Splits the sentence into runs; a name not found leaves the text plain.
 */
export function emphasisRuns(text: string, notification: Pick<AppNotification, 'actors' | 'vehicle' | 'type'>): { text: string; strong: boolean }[] {
  const names = [...notification.actors.slice(0, 2).map(handle)];
  const title = notification.vehicle?.full_title?.trim();
  if (title && notification.type !== 'security') names.push(keepLastWordWithNext(title));
  const found = names
    .map((name) => ({ name, at: text.indexOf(name) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);
  const runs: { text: string; strong: boolean }[] = [];
  let cursor = 0;
  for (const { name, at } of found) {
    if (at < cursor) continue;
    if (at > cursor) runs.push({ text: text.slice(cursor, at), strong: false });
    runs.push({ text: name, strong: true });
    cursor = at + name.length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), strong: false });
  return runs;
}

/** The car photo at the row's end (09 §7.4: the object, never an icon); null without a vehicle or its cover. */
export function notificationThumb(notification: Pick<AppNotification, 'vehicle' | 'type'>) {
  return notification.type === 'security' ? null : (notification.vehicle?.cover ?? null);
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
/** A thread or post id as the forum's ULIDs come (26 characters), before it goes into a path. */
const FORUM_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

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
  // M4.6 Auth 2.0 (SecurityNotice): the e-mail code lock, linked providers and passkeys.
  'email_code_locked',
  'provider_linked',
  'provider_unlinked',
  'passkey_added',
  'passkey_removed',
  'passkey_rejected',
]);

/** M4.6: the events whose `device_name` carries a label (the provider's name, the passkey's name) for a sentence of its own. */
/** A modification id (ULID), as business_tag carries it in `mod_id`. */
const TAG_MOD_ID = /^[0-9A-Za-z]{26}$/;

/** A member_security_events id (ULID), as the server puts it in `security_event_id`. */
const SECURITY_EVENT_ID = /^[0-9A-Za-z]{26}$/;

const LABELLED_EVENTS = new Set(['provider_linked', 'provider_unlinked', 'passkey_added', 'passkey_removed', 'passkey_rejected']);

/**
 * DQ-910: whether the sentence may hyphenate. A sentence that names a device ("Neue Anmeldung auf sdk_gphone64_arm64") is set
 * without hyphenation, so the device name never splits ("sdk_gpho-/ne64_arm64"); its words are short enough to wrap whole.
 * One flag for the whole text, because Android hyphenates a paragraph, not a span.
 */
export function notificationHyphenates(notification: Pick<AppNotification, 'type' | 'details'>): boolean {
  if (notification.type !== 'security') return true;
  const data = dataOf(notification);
  return !(stringIn(data, 'event') === 'new_device' && stringIn(data, 'device_name'));
}

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
 * - spot_alert (M5.9b): "Dein Nissan Skyline GT-R R34 wurde heute 4-mal in Düsseldorf gespottet" (never who spotted it).
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
      if (event === 'new_device' && device) return t('notifications.text.security.new_device_named', { device: machineNameText(deviceNameText(device)) });
      // DQ-999: a passkey with only the generic fallback name ("Passkey") gets the sentence without a name, never „Passkey“ quoted.
      const label = event?.startsWith('passkey_') ? passkeyOwnName(device) : device;
      if (event && LABELLED_EVENTS.has(event) && label) {
        return t(`notifications.text.security.${event}_named`, { name: keepNameTogether(label.trim().slice(0, 64)) });
      }
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
    case 'spot_alert':
      return spotAlertText(notification, data, t);
    case 'event_review':
    case 'event_promoted':
    case 'event_reminder':
    case 'event_update':
    case 'event_cancelled':
      return eventText(notification, data, t);
    case 'business_review':
    case 'business_tag':
    case 'business_invite':
      return businessText(notification, data, t);
    case 'forum_reply':
    case 'forum_mention':
    case 'forum_solved':
      return forumText(notification, data, t);
    case 'crew':
      return crewText(data, t);
    default:
      return t('notifications.text.other');
  }
}

/**
 * M5.9b spot_alert: one row per car and Berlin day with that day's totals, `details` {day, count, cities_count, city}. The city is
 * named when the day's day spots were all in one; "heute" only while `day` is today in Berlin (a row stays in the list for days).
 */
function spotAlertText(notification: AppNotification, data: Record<string, unknown>, t: TFunction, now: Date = new Date()): string {
  const count = Math.max(1, numberIn(data, 'count') ?? 1);
  const citiesCount = numberIn(data, 'cities_count') ?? 0;
  const city = citiesCount === 1 ? stringIn(data, 'city') : null;
  const title = notification.vehicle?.full_title?.trim();
  const vehicle = title ? keepLastWordWithNext(title) : t('notifications.text.spotAlert.yourCar');
  const when = stringIn(data, 'day') === berlinDayKey(now) ? 'today' : 'day';
  if (city) return t(`notifications.text.spotAlert.${when}.city`, { count, vehicle, city: keepNameTogether(city) });
  if (citiesCount > 1) return t(`notifications.text.spotAlert.${when}.cities`, { count, vehicle, cities: citiesCount });
  return t(`notifications.text.spotAlert.${when}.plain`, { count, vehicle });
}

/** business_review outcomes with their own sentence; anything else reads as the rejection (the reason is on BIZ-03). */
const REVIEW_OUTCOMES: ReadonlySet<string> = new Set(['verified', 'rejected', 'suspended', 'reinstated', 'reopened']);
/** business_invite states (SEC-414-01): invited/removed for the member, accepted/declined/left for the business. */
const INVITE_STATES: ReadonlySet<string> = new Set(['invited', 'removed', 'accepted', 'declined', 'left']);
const INVITE_MEMBER_STATES: ReadonlySet<string> = new Set(['invited', 'removed']);
/** A username as the API allows it, before it goes into a sentence. */
const USERNAME = /^[a-z0-9._]{2,30}$/i;

/**
 * M4.14 (09 §8.10, ADR-414; in-app only): business_review says how staff decided on the member's business (never the reason, which
 * BIZ-03 shows); business_tag says where an "Eingebaut von" tag stands, for the business (BIZ-04) or for the build's owner (VEH-02).
 * The row carries no business name, so the sentence names the build instead.
 */
function businessText(notification: AppNotification, data: Record<string, unknown>, t: TFunction): string {
  const tx = (key: string, values: Record<string, string> = {}) =>
    (t as unknown as (name: string, options: Record<string, string>) => string)(`parts:notifications.${key}`, values);
  if (notification.type === 'business_review') {
    const outcome = stringIn(data, 'outcome');
    return tx(`review.${outcome && REVIEW_OUTCOMES.has(outcome) ? outcome : 'rejected'}`);
  }
  if (notification.type === 'business_invite') {
    // SEC-414-01: the member was invited to (or removed from) a team, or the business hears how the member answered or that they left.
    const state = stringIn(data, 'state');
    const username = stringIn(data, 'username');
    const key = state && INVITE_STATES.has(state) ? state : 'invited';
    return username && USERNAME.test(username) ? tx(`invite.${key}`, { username }) : tx(`invite.${key}Anonymous`);
  }
  const vehicle = keepLastWordWithNext(notification.vehicle?.full_title?.trim() || tx('aBuild'));
  const side = stringIn(data, 'side') === 'business' ? 'business' : 'member';
  const state = stringIn(data, 'state');
  return tx(`tag.${side}.${state === 'accepted' || state === 'declined' ? state : 'requested'}`, { vehicle });
}

/**
 * M4.12 (ADR-437, ADR-439): the sentences of the event rows. The title comes from `event` (EventRefResource); never the text of an
 * organiser update and never the place (the push and the row say only that something changed).
 */
function eventText(notification: AppNotification, data: Record<string, unknown>, t: TFunction): string {
  const tx = (key: string, values: Record<string, string>) => (t as unknown as (name: string, options: Record<string, string>) => string)(`events:notifications.${key}`, values);
  const title = keepNameTogether(notification.event?.title?.trim() || tx('anEvent', {}));
  switch (notification.type) {
    case 'event_review': {
      if (stringIn(data, 'outcome') === 'approved') return tx('reviewApproved', { title });
      const reason = stringIn(data, 'reason')?.trim();
      return reason ? tx('reviewRejectedReason', { title, reason }) : tx('reviewRejected', { title });
    }
    case 'event_promoted':
      return tx('promoted', { title });
    case 'event_reminder':
      return stringIn(data, 'kind') === '2h' ? tx('reminder2h', { title }) : tx('reminder24h', { title });
    case 'event_update':
      return stringIn(data, 'kind') === 'changed' ? tx('changed', { title }) : tx('update', { title });
    default:
      return data.by_staff === true ? tx('cancelledByStaff', { title }) : tx('cancelled', { title });
  }
}

/**
 * M5.8 (m5.8-contract §5): forum_reply ("@lukas.sc hat auf „{Titel}“ geantwortet.", the day's repliers joined, or an answer to the
 * reader's own reply), forum_mention and forum_solved. The title is the thread's public title from `forum_thread`; never a post's text.
 */
function forumText(notification: AppNotification, data: Record<string, unknown>, t: TFunction): string {
  const tx = (key: string, values: Record<string, string | number>) =>
    (t as unknown as (name: string, options: Record<string, string | number>) => string)(`forum:notifications.${key}`, values);
  const title = keepNameTogether(notification.forum_thread?.title?.trim() || tx('aThread', {}));
  const [first, second] = notification.actors;
  const actor = first ? handle(first) : t('notifications.someone');
  if (notification.type === 'forum_solved') return tx('solved', { title });
  if (notification.type === 'forum_mention') return tx('mention', { actor, title });
  const total = Math.max(notification.actor_count, notification.actors.length, 1);
  if (total === 2 && second) return tx('replyTwo', { actor, other: handle(second), title });
  if (total > 2) return tx('replyMany', { actor, count: total - 1, title });
  return stringIn(data, 'reply_to') === 'post' ? tx('replyToPost', { actor, title }) : tx('reply', { actor, title });
}

/** R4-2.3 (contract-crews §5): the three states of a `crew` row. Never "left", never "declined", no counts. */
const CREW_STATES: ReadonlySet<string> = new Set(['request_received', 'request_approved', 'invited']);
/** A crew slug as the API allows it (`[a-z0-9-]{1,64}`), before it goes into a path. */
const CREW_SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * R4-2.3 crew rows: "@lukas.sc möchte „Nordlicht Crew“ beitreten." (to founder and admins), "Du bist jetzt Mitglied von „Nordlicht
 * Crew“." and "@lukas.sc hat dich zu „Nordlicht Crew“ eingeladen." The crew's name comes from `details.crew_name`.
 */
function crewText(data: Record<string, unknown>, t: TFunction): string {
  const state = stringIn(data, 'state');
  const crew = keepNameTogether(stringIn(data, 'crew_name')?.trim() || t('crews.notifications.aCrew'));
  const username = stringIn(data, 'username');
  const actor = username && USERNAME.test(username) ? `@${username}` : t('notifications.someone');
  if (state === 'request_received') return t('crews.notifications.requestReceived', { actor, crew });
  if (state === 'request_approved') return t('crews.notifications.requestApproved', { crew });
  if (state === 'invited') return t('crews.notifications.invited', { actor, crew });
  return t('crews.notifications.other', { crew });
}

/** R4-2.3 tap paths (contract-crews §5): request_received → CREW-03 Anfragen, request_approved → CREW-01, invited → CREW-05. */
function crewTarget(data: Record<string, unknown>): Href | null {
  const state = stringIn(data, 'state');
  const slug = stringIn(data, 'crew_slug');
  if (state === 'invited') return '/crews/invites' as Href;
  if (!slug || !CREW_SLUG.test(slug) || !state || !CREW_STATES.has(state)) return null;
  return (state === 'request_received' ? `/crews/${slug}/requests` : `/crews/${slug}`) as Href;
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
    case 'spot_alert':
      return 'qr-sticker';
    case 'hu_au_reminder':
      return 'clock';
    case 'catalog_request':
      return 'garage';
    case 'support_reply':
      return 'lifebuoy';
    case 'event_review':
    case 'event_promoted':
    case 'event_reminder':
    case 'event_update':
    case 'event_cancelled':
      return 'meet';
    case 'business_review':
    case 'business_tag':
    case 'business_invite':
      return 'workshop';
    case 'forum_reply':
    case 'forum_mention':
    case 'forum_solved':
      return 'chats';
    case 'crew':
      return 'users';
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
    // R5-5: a comment or mention in the car's own thread (`target: vehicle`) opens VEH-01 with the car's comments sheet open
    // (`?comments=1`, read once, as the push path); one on an update opens VEH-05, where its thread is; else the build.
    case 'comment':
    case 'mention': {
      const vehicle = notification.vehicle;
      if (!vehicle) return null;
      if (stringIn(data, 'target') === 'vehicle') return { pathname: '/v/[slug]', params: { slug: vehicle.slug, comments: '1' } };
      const updateId = stringIn(data, 'update_id');
      return updateId ? `/v/${vehicle.slug}/updates/${updateId}` : `/v/${vehicle.slug}`;
    }
    case 'security': {
      // M4.7: a row of the SET-21 log opens it there, highlighted, with "Das war ich nicht" (lead ruling on the HOME-02 copy).
      const eventId = stringIn(data, 'security_event_id');
      if (eventId && SECURITY_EVENT_ID.test(eventId)) return { pathname: '/settings/security/activity', params: { event: eventId } };
      // M4.6: a passkey, a linked provider or the e-mail code lock opens SET-19, where it can be checked or undone.
      const event = stringIn(data, 'event');
      return event && (LABELLED_EVENTS.has(event) || event === 'email_code_locked') ? '/settings/security/sign-in' : '/settings';
    }
    case 'moderation_decision':
    case 'report_decided': {
      // SAFE-01; without the id, the list of SET-16.
      const decisionId = stringIn(data, 'decision_id');
      return decisionId ? { pathname: '/decision/[id]', params: { id: decisionId } } : '/settings/reports';
    }
    // [SIG] QR-02 with its scans; GAR-06 with the HU/AU month. Without the vehicle: the QR list and the garage.
    case 'qr_milestone':
      return notification.vehicle ? `/stickers/${notification.vehicle.id}` : '/stickers';
    case 'hu_au_reminder':
      return notification.vehicle ? `/garage/${notification.vehicle.id}/specs` : '/garage';
    // M5.9b: DEX-06, the owner's spot numbers of the car; the garage when the car is gone.
    case 'spot_alert':
      return notification.vehicle ? ownerSpotsRoute(notification.vehicle.id) : '/garage';
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
    // M4.12: EVT-02 of the event; a review outcome opens EVT-05 Organisiert when the event is gone.
    case 'event_review':
      return notification.event ? `/events/${notification.event.slug}` : { pathname: '/profile/events', params: { tab: 'organised' } };
    case 'event_promoted':
    case 'event_reminder':
    case 'event_update':
    case 'event_cancelled':
      return notification.event ? `/events/${notification.event.slug}` : '/profile/events';
    // M4.14: BIZ-03 for the business's review; a tag the business must answer (or hears back about) opens BIZ-04, the build owner's
    // opens VEH-02 of the mod, where "Eingebaut von" is confirmed or declined.
    case 'business_review':
      return '/business';
    // SEC-414-01: an invitation (or a removal) opens the member's invitations; the business's side opens BIZ-03 Team.
    case 'business_invite': {
      const state = stringIn(data, 'state');
      return state && INVITE_MEMBER_STATES.has(state) ? '/business/invites' : '/business';
    }
    case 'business_tag': {
      if (stringIn(data, 'side') === 'business') return '/business/requests';
      const modId = stringIn(data, 'mod_id');
      if (!notification.vehicle) return null;
      return modId && TAG_MOD_ID.test(modId)
        ? { pathname: '/v/[slug]/mods/[modId]', params: { slug: notification.vehicle.slug, modId } }
        : `/v/${notification.vehicle.slug}`;
    }
    // M5.8: FOR-03 at the reply (`?post=`); nothing when the reader may no longer see the thread (`forum_thread` null).
    case 'forum_reply':
    case 'forum_mention':
    case 'forum_solved': {
      const thread = notification.forum_thread;
      if (!thread) return null;
      const threadId = thread.id || stringIn(data, 'thread_id');
      if (!threadId || !FORUM_ID.test(threadId)) return null;
      const postId = stringIn(data, 'post_id');
      return postId && FORUM_ID.test(postId)
        ? { pathname: '/forum/[id]', params: { id: threadId, post: postId } }
        : (`/forum/${threadId}` as Href);
    }
    case 'crew':
      return crewTarget(data);
    default:
      return null;
  }
}
