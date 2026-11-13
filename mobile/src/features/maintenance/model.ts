/**
 * MNT-01…03 (09 §7.12, §8.8, ADR-441): what an item says on its card, the order of the cards, the editor's fields per type and
 * the conversions between what the member types (de-DE dates, km or mi, euros) and what the API takes (YYYY-MM-DD, km, cents).
 */
import type { TFunction } from 'i18next';

import type { MaintenanceDueState, MaintenanceItem, MaintenanceType, MaintenanceUpcoming } from '@/api/queries/maintenance';
import { numberOrNull } from '@/lib/numbers';
import { formatLongDate, formatMonthYear, formatNumber, type FormatLocale } from '@/lib/format';
import type { IconName } from '@/ui/icons/Icon';

export const MAINTENANCE_TYPES: readonly MaintenanceType[] = ['hu_au', 'service', 'oil_change', 'brake_fluid', 'tyre_change', 'insurance', 'custom'];

/** Every type but custom exists once per vehicle. */
export const SINGLETON_TYPES: readonly MaintenanceType[] = MAINTENANCE_TYPES.filter((type) => type !== 'custom');

/** The custom auto glyphs of the domain (App. C): HU plakette, service wrench, oil, brake, tyre season, insurance. */
export const TYPE_GLYPH: Readonly<Record<MaintenanceType, IconName>> = {
  hu_au: 'hu-plakette',
  service: 'service-wrench',
  oil_change: 'oil',
  brake_fluid: 'brake-caliper',
  tyre_change: 'tyre-season',
  insurance: 'insurance',
  custom: 'wrench',
};

/** The lead times the editor offers (days before the due date); the API takes at most three, 0–90. */
export const LEAD_OPTIONS = [90, 60, 30, 14, 7, 1, 0] as const;
export const MAX_LEADS = 3;
/** < 30 days to go is the warning tone (09 §5 MaintenanceCard). */
export const WARNING_DAYS = 30;
/** 1 mile in km, for SET-11 "Entfernung: mi". The server keeps km. */
export const KM_PER_MILE = 1.609344;
const MAX_KM = 2_000_000;
const MAX_INTERVAL_MONTHS = 120;
const MIN_INTERVAL_KM = 100;
const MAX_INTERVAL_KM = 500_000;
export const TITLE_MAX = 80;
export const NOTES_MAX = 500;
export const LOG_NOTES_MAX = 1000;
export const WORKSHOP_MAX = 120;

export type DistanceUnit = 'km' | 'mi';
export type DueTone = 'ok' | 'soon' | 'overdue' | 'unknown';

/** A field of MNT-02 and the types that show it. */
export type ItemField = 'title' | 'dueMonth' | 'intervalMonths' | 'intervalKm' | 'lastDate' | 'lastKm' | 'nextDate' | 'nextKm' | 'lead' | 'notes';

const INTERVAL_FIELDS: readonly ItemField[] = ['intervalMonths', 'intervalKm', 'lastDate', 'lastKm', 'nextDate', 'nextKm', 'lead', 'notes'];

export const ITEM_FIELDS: Readonly<Record<MaintenanceType, readonly ItemField[]>> = {
  // HU/AU: the month on the plakette (ADR-441: mirrored to the vehicle).
  hu_au: ['dueMonth', 'lead', 'notes'],
  service: INTERVAL_FIELDS,
  oil_change: INTERVAL_FIELDS,
  brake_fluid: ['intervalMonths', 'lastDate', 'nextDate', 'lead', 'notes'],
  // "O bis O" and the Stichtag are fixed dates: only the reminder and a note are the member's.
  tyre_change: ['lead', 'notes'],
  insurance: ['lead', 'notes'],
  custom: ['title', ...INTERVAL_FIELDS],
};

export function itemTitle(t: TFunction<'garage'>, item: Pick<MaintenanceItem, 'type' | 'title'>): string {
  if (item.type === 'custom') return item.title?.trim() || t('maintenance.type.custom');
  return t(`maintenance.type.${item.type}`);
}

/** "2027-03-01" as a calendar day at noon UTC, so no time zone moves it to the day before. */
export function dayDate(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

export function monthDate(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12)) : null;
}

export function toneOf(state: MaintenanceDueState, daysLeft: number | null): DueTone {
  if (state === 'overdue') return 'overdue';
  if (state === 'unknown') return 'unknown';
  if (state === 'soon' || (daysLeft !== null && daysLeft < WARNING_DAYS)) return 'soon';
  return 'ok';
}

/** km → the member's unit, rounded to whole units. */
export function toUnit(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? Math.round(km / KM_PER_MILE) : Math.round(km);
}

/** The member's unit → km for the API. */
export function fromUnit(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? Math.round(value * KM_PER_MILE) : Math.round(value);
}

/** "45.000 km" / "28,000 mi", the number and its unit bound by a no-break space. */
export function distanceText(km: number, unit: DistanceUnit, locale: FormatLocale): string {
  return `${formatNumber(toUnit(km, unit), locale)} ${unit}`;
}

/** Euro cents as "189,00 €" / "€189.00" in the member's language. */
export function euroText(cents: number, locale: FormatLocale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(cents / 100)
    .replace(/\s/g, ' ');
}

export type DueModel = {
  title: string;
  glyph: IconName;
  /** "Fällig im März 2027", "Fällig am 15. Oktober 2026 oder bei 45.000 km". Null: no due date known. */
  due: string | null;
  /** "in 132 Tagen", "seit 12 Tagen überfällig", "noch 1.200 km". */
  countdown: string | null;
  /** The countdown as a figure for the hero (days, or km when only those are known). */
  figure: { value: number; unit: string } | null;
  /**
   * DQ-1097: the line under the hero's figure. The figure's unit already says "Tage überfällig", so an overdue hero has none;
   * one still due reads "53 Tage / bis zur Fälligkeit"; today and tomorrow keep their words.
   */
  heroCountdown: string | null;
  /** "Zuletzt am 14. Juni 2025 · 41.200 km" */
  last: string | null;
  /** Tyres: "Winterreifen" / "Sommerreifen" next. */
  season: string | null;
  tone: DueTone;
  progress: number | null;
  enabled: boolean;
};

type ItemLike = Pick<MaintenanceItem, 'type' | 'title' | 'next_due' | 'last_done' | 'state' | 'days_left' | 'km_left' | 'progress' | 'season' | 'enabled'>;

function countdownText(t: TFunction<'garage'>, days: number | null, kmLeft: number | null, unit: DistanceUnit, locale: FormatLocale): string | null {
  if (days !== null) {
    if (days < 0) return t('maintenance.countdown.overdue', { count: -days });
    if (days === 0) return t('maintenance.countdown.today');
    if (days === 1) return t('maintenance.countdown.tomorrow');
    return t('maintenance.countdown.days', { count: days, days: formatNumber(days, locale) });
  }
  if (kmLeft !== null) {
    if (kmLeft < 0) return t('maintenance.countdown.overKm', { distance: distanceText(-kmLeft, unit, locale) });
    return t('maintenance.countdown.km', { distance: distanceText(kmLeft, unit, locale) });
  }
  return null;
}

export function dueModel(t: TFunction<'garage'>, item: ItemLike, unit: DistanceUnit, locale: FormatLocale): DueModel {
  const days = numberOrNull(item.days_left);
  const kmLeft = numberOrNull(item.km_left);
  const progressValue = numberOrNull(item.progress);
  const dateText = item.next_due.date ? dayDate(item.next_due.date) : null;
  const monthText = item.next_due.month ? monthDate(item.next_due.month) : null;
  const kmText = item.next_due.km !== null ? distanceText(item.next_due.km, unit, locale) : null;

  let due: string | null = null;
  if (item.type === 'hu_au' && monthText) due = t('maintenance.due.month', { month: formatMonthYear(monthText, locale) });
  else if (item.type === 'insurance' && dateText) due = t('maintenance.due.deadline', { date: formatLongDate(dateText, locale) });
  else if (dateText && kmText) due = t('maintenance.due.dateOrKm', { date: formatLongDate(dateText, locale), distance: kmText });
  else if (dateText) due = t('maintenance.due.date', { date: formatLongDate(dateText, locale) });
  else if (kmText) due = t('maintenance.due.km', { distance: kmText });

  const lastDate = item.last_done.date ? dayDate(item.last_done.date) : null;
  const lastParts = [lastDate ? formatLongDate(lastDate, locale) : null, item.last_done.km !== null ? distanceText(item.last_done.km, unit, locale) : null].filter(
    (part): part is string => part !== null,
  );
  const last = lastParts.length > 0 ? t('maintenance.last', { when: lastParts.join(' · ') }) : null;

  // DQ-1097: an overdue figure says so in its unit ("53 Tage überfällig"); alone, "53 Tage" reads as "in 53 days".
  let figure: DueModel['figure'] = null;
  let heroCountdown: string | null = null;
  if (days !== null) {
    figure = { value: Math.abs(days), unit: t(days < 0 ? 'maintenance.unit.daysOverdue' : 'maintenance.unit.days', { count: Math.abs(days) }) };
    heroCountdown = days < 0 ? null : days <= 1 ? countdownText(t, days, kmLeft, unit, locale) : t('maintenance.countdown.untilDue');
  } else if (kmLeft !== null) {
    figure = { value: toUnit(Math.abs(kmLeft), unit), unit: kmLeft < 0 ? t('maintenance.unit.over', { unit }) : unit };
    heroCountdown = kmLeft < 0 ? null : t('maintenance.countdown.untilDue');
  }

  return {
    title: itemTitle(t, item),
    glyph: TYPE_GLYPH[item.type],
    due,
    countdown: countdownText(t, days, kmLeft, unit, locale),
    figure,
    heroCountdown,
    last,
    season: item.type === 'tyre_change' && item.season ? t(`maintenance.season.${item.season === 'winter' ? 'winter' : 'summer'}`) : null,
    tone: item.enabled ? toneOf(item.state, days) : 'unknown',
    progress: progressValue === null ? null : Math.min(1, Math.max(0, progressValue)),
    enabled: item.enabled,
  };
}

const STATE_ORDER: Readonly<Record<MaintenanceDueState, number>> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

/** Overdue first, then the nearest due date, then the rest by type: the server's order, kept when the cache changes. */
export function sortItems<T extends Pick<MaintenanceItem, 'state' | 'days_left' | 'type' | 'enabled'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const state = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (state !== 0) return state;
    const da = numberOrNull(a.days_left);
    const db = numberOrNull(b.days_left);
    if (da !== null && db !== null && da !== db) return da - db;
    if (da === null !== (db === null)) return da === null ? 1 : -1;
    return MAINTENANCE_TYPES.indexOf(a.type) - MAINTENANCE_TYPES.indexOf(b.type);
  });
}

/** The types still free for a new item on this vehicle (custom always). */
export function freeTypes(items: readonly Pick<MaintenanceItem, 'type'>[]): MaintenanceType[] {
  const taken = new Set(items.map((item) => item.type));
  return MAINTENANCE_TYPES.filter((type) => type === 'custom' || !taken.has(type));
}

/** The item the hero shows: the first enabled one with a due date or mileage. */
export function heroItem<T extends ItemLike>(items: readonly T[]): T | null {
  return items.find((item) => item.enabled && (item.next_due.date !== null || item.next_due.km !== null)) ?? null;
}

/** GAR-01: the upcoming rows, each with its vehicle. */
export function upcomingTitle(t: TFunction<'garage'>, item: MaintenanceUpcoming): string {
  return itemTitle(t, item);
}

// -- Editor values

export type ItemFormValues = {
  type: MaintenanceType;
  title: string;
  dueMonth: string;
  intervalMonths: string;
  intervalKm: string;
  lastDate: string;
  lastKm: string;
  nextDate: string;
  nextKm: string;
  lead: number[];
  notes: string;
  enabled: boolean;
};

export type LogFormValues = {
  itemId: string | null;
  type: MaintenanceType;
  title: string;
  date: string;
  km: string;
  cost: string;
  workshop: string;
  notes: string;
};

/** "2026-06-14" → "14.06.2026", the field's own format. */
export function germanDay(day: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** A whole number as the field shows it (no grouping: the member edits it). */
export function plainNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function itemValuesFrom(item: MaintenanceItem | null, type: MaintenanceType, defaults: { huLeadDays: number[] }, unit: DistanceUnit): ItemFormValues {
  const km = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(toUnit(value, unit)));
  if (!item) {
    return {
      type,
      title: '',
      dueMonth: '',
      intervalMonths: '',
      intervalKm: '',
      lastDate: '',
      lastKm: '',
      nextDate: '',
      nextKm: '',
      lead: type === 'hu_au' ? [...defaults.huLeadDays] : [],
      notes: '',
      enabled: true,
    };
  }
  const month = item.next_due.month ?? (item.next_due.date ? item.next_due.date.slice(0, 7) : null);
  return {
    type: item.type,
    title: item.title ?? '',
    dueMonth: month ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : '',
    intervalMonths: plainNumber(item.interval.months),
    intervalKm: km(item.interval.km),
    lastDate: germanDay(item.last_done.date),
    lastKm: km(item.last_done.km),
    // Only a date the member set stands in the field; a computed one shows as the placeholder.
    nextDate: item.next_due.pinned ? germanDay(item.next_due.date) : '',
    nextKm: item.next_due.pinned ? km(item.next_due.km) : '',
    lead: [...item.lead_days],
    notes: item.notes ?? '',
    enabled: item.enabled,
  };
}

/** "45.000", "45000", "45 000" → 45000; empty → null; anything else → undefined. */
export function parseWhole(raw: string, max: number = MAX_KM): number | null | undefined {
  const compact = raw.replace(/[\s.,  ]/g, '');
  if (compact === '') return null;
  if (!/^\d+$/.test(compact)) return undefined;
  const value = Number(compact);
  return value <= max ? value : undefined;
}

/** "14.06.2026" or "2026-06-14" → "2026-06-14"; empty → null; anything else (31.02.) → undefined. */
export function parseGermanDay(raw: string): string | null | undefined {
  const value = raw.trim();
  if (value === '') return null;
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year, month, day] = german
    ? [Number(german[3]), Number(german[2]), Number(german[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [Number.NaN, Number.NaN, Number.NaN];
  if (!Number.isFinite(year)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "03/2027" → "2027-03-01" (the plakette's month, stored as its first day). */
export function parseDueMonth(raw: string): string | null | undefined {
  const value = raw.trim();
  if (value === '') return null;
  const match = /^(\d{1,2})\s*[/.\-]\s*(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return undefined;
  return `${match[2]}-${String(month).padStart(2, '0')}-01`;
}

/** Typing "032027" ends as "03/2027". */
export function maskDueMonth(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 6);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** Typing "14062026" ends as "14.06.2026". */
export function maskDay(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return digits;
}

/** "189,50", "189.50 €", "1.240" → cents; empty → null; anything else → undefined. */
export function parseEuros(raw: string, locale: FormatLocale): number | null | undefined {
  const value = raw.replace(/[€\s ]/g, '');
  if (value === '') return null;
  const normalised =
    locale === 'en'
      ? value.replace(/,/g, '')
      : // de: "1.240,50" → "1240.50"; a single dot with three digits after it is a thousands dot.
        value.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return undefined;
  const cents = Math.round(Number(normalised) * 100);
  return cents <= 10_000_000 ? cents : undefined;
}

export function centsText(cents: number | null | undefined, locale: FormatLocale): string {
  if (cents === null || cents === undefined) return '';
  const fraction = cents % 100 === 0 ? 0 : 2;
  return formatNumber(cents / 100, locale, { minFractionDigits: fraction, maxFractionDigits: fraction });
}

export const INTERVAL_BOUNDS = { maxMonths: MAX_INTERVAL_MONTHS, minKm: MIN_INTERVAL_KM, maxKm: MAX_INTERVAL_KM, maxOdometer: MAX_KM } as const;
