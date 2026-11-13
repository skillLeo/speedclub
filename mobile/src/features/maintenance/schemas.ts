/**
 * MNT-02 checks (React Hook Form + Zod) with the bounds of the server's MaintenanceRules, and the request bodies built from the
 * checked values. The server decides; a 422 lands on the same fields (ITEM_SERVER_FIELDS / LOG_SERVER_FIELDS). Messages are keys
 * of the garage namespace, read with `fieldMessage` (features/garage/schemas.ts).
 */
import { z } from 'zod';

import type { ItemInput, ItemPatch, LogInput, LogPatch, MaintenanceType } from '@/api/queries/maintenance';
import type { FormatLocale } from '@/lib/format';
import { issue } from '@/features/garage/schemas';

import {
  fromUnit,
  INTERVAL_BOUNDS,
  ITEM_FIELDS,
  LOG_NOTES_MAX,
  MAX_LEADS,
  NOTES_MAX,
  parseDueMonth,
  parseEuros,
  parseGermanDay,
  parseWhole,
  TITLE_MAX,
  WORKSHOP_MAX,
  type DistanceUnit,
  type ItemField,
  type ItemFormValues,
  type LogFormValues,
} from './model';

/** The API's field names → the form's. */
export const ITEM_SERVER_FIELDS = {
  title: 'title',
  next_due_at: 'nextDate',
  next_due_km: 'nextKm',
  interval_months: 'intervalMonths',
  interval_km: 'intervalKm',
  last_done_at: 'lastDate',
  last_done_km: 'lastKm',
  lead_days: 'lead',
  'lead_days.0': 'lead',
  'lead_days.1': 'lead',
  'lead_days.2': 'lead',
  notes: 'notes',
} as const;

export const LOG_SERVER_FIELDS = {
  title: 'title',
  type: 'type',
  item_id: 'type',
  done_at: 'date',
  mileage_km: 'km',
  cost_cents: 'cost',
  workshop: 'workshop',
  notes: 'notes',
} as const;

function shows(type: MaintenanceType, field: ItemField): boolean {
  return ITEM_FIELDS[type].includes(field);
}

/** Today in Berlin as YYYY-MM-DD; a done date may be at most one day ahead (time zones), as on the server. */
export function berlinDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function dayAfter(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function itemSchema(today: string) {
  return z
    .object({
      type: z.string(),
      title: z.string(),
      dueMonth: z.string(),
      intervalMonths: z.string(),
      intervalKm: z.string(),
      lastDate: z.string(),
      lastKm: z.string(),
      nextDate: z.string(),
      nextKm: z.string(),
      lead: z.array(z.number()),
      notes: z.string(),
      enabled: z.boolean(),
    })
    .superRefine((values, context) => {
      const type = values.type as MaintenanceType;
      const add = (path: keyof ItemFormValues, message: string) => context.addIssue({ code: 'custom', path: [path], message });
      if (shows(type, 'title')) {
        if (values.title.trim() === '') add('title', issue('maintenance.validation.titleRequired'));
        else if (values.title.trim().length > TITLE_MAX) add('title', issue('maintenance.validation.tooLong', { max: TITLE_MAX }));
      }
      if (shows(type, 'dueMonth')) {
        const month = parseDueMonth(values.dueMonth);
        if (month === null) add('dueMonth', issue('maintenance.validation.monthRequired'));
        else if (month === undefined) add('dueMonth', issue('maintenance.validation.month'));
      }
      if (shows(type, 'intervalMonths')) {
        const months = parseWhole(values.intervalMonths, INTERVAL_BOUNDS.maxMonths);
        if (months === undefined || months === 0) add('intervalMonths', issue('maintenance.validation.months', { max: INTERVAL_BOUNDS.maxMonths }));
      }
      if (shows(type, 'intervalKm')) {
        const km = parseWhole(values.intervalKm, INTERVAL_BOUNDS.maxKm);
        if (km === undefined || (km !== null && km < INTERVAL_BOUNDS.minKm)) add('intervalKm', issue('maintenance.validation.distance'));
      }
      if (shows(type, 'lastDate')) {
        const day = parseGermanDay(values.lastDate);
        if (day === undefined) add('lastDate', issue('maintenance.validation.date'));
        else if (day !== null && day > dayAfter(today)) add('lastDate', issue('maintenance.validation.future'));
      }
      if (shows(type, 'nextDate') && parseGermanDay(values.nextDate) === undefined) add('nextDate', issue('maintenance.validation.date'));
      for (const field of ['lastKm', 'nextKm'] as const) {
        if (shows(type, field) && parseWhole(values[field]) === undefined) add(field, issue('maintenance.validation.distance'));
      }
      if (values.lead.length > MAX_LEADS) add('lead', issue('maintenance.validation.leads', { max: MAX_LEADS }));
      if (values.notes.trim().length > NOTES_MAX) add('notes', issue('maintenance.validation.tooLong', { max: NOTES_MAX }));
    });
}

function kmOf(raw: string, unit: DistanceUnit): number | null {
  const value = parseWhole(raw);
  return value === null || value === undefined ? null : fromUnit(value, unit);
}

/** The checked values as the fields the API takes; the types that do not show a field leave it out. */
function itemFields(values: ItemFormValues, unit: DistanceUnit): ItemPatch {
  const type = values.type;
  const body: ItemPatch = { lead_days: [...values.lead].sort((a, b) => b - a), notes: values.notes.trim() || null, enabled: values.enabled };
  if (shows(type, 'title')) body.title = values.title.trim();
  if (shows(type, 'dueMonth')) body.next_due_at = parseDueMonth(values.dueMonth) ?? null;
  if (shows(type, 'intervalMonths')) body.interval_months = parseWhole(values.intervalMonths, INTERVAL_BOUNDS.maxMonths) ?? null;
  if (shows(type, 'intervalKm')) body.interval_km = kmOf(values.intervalKm, unit);
  if (shows(type, 'lastDate')) body.last_done_at = parseGermanDay(values.lastDate) ?? null;
  if (shows(type, 'lastKm')) body.last_done_km = kmOf(values.lastKm, unit);
  if (shows(type, 'nextDate')) body.next_due_at = parseGermanDay(values.nextDate) ?? null;
  if (shows(type, 'nextKm')) body.next_due_km = kmOf(values.nextKm, unit);
  return body;
}

export function itemCreateBody(values: ItemFormValues, unit: DistanceUnit, id: string): ItemInput & { id: string } {
  return { id, type: values.type, ...itemFields(values, unit) };
}

export function itemPatchBody(values: ItemFormValues, unit: DistanceUnit, version: number): ItemPatch {
  return { version, ...itemFields(values, unit) };
}

export function logSchema(today: string, locale: FormatLocale) {
  return z
    .object({
      itemId: z.string().nullable(),
      type: z.string(),
      title: z.string(),
      date: z.string(),
      km: z.string(),
      cost: z.string(),
      workshop: z.string(),
      notes: z.string(),
    })
    .superRefine((values, context) => {
      const add = (path: keyof LogFormValues, message: string) => context.addIssue({ code: 'custom', path: [path], message });
      const day = parseGermanDay(values.date);
      if (day === null) add('date', issue('maintenance.validation.dateRequired'));
      else if (day === undefined) add('date', issue('maintenance.validation.date'));
      else if (day > dayAfter(today)) add('date', issue('maintenance.validation.future'));
      if (parseWhole(values.km) === undefined) add('km', issue('maintenance.validation.distance'));
      if (parseEuros(values.cost, locale) === undefined) add('cost', issue('maintenance.validation.cost'));
      if (values.itemId === null && values.type === 'custom' && values.title.trim() === '') add('title', issue('maintenance.validation.titleRequired'));
      if (values.title.trim().length > TITLE_MAX) add('title', issue('maintenance.validation.tooLong', { max: TITLE_MAX }));
      if (values.workshop.trim().length > WORKSHOP_MAX) add('workshop', issue('maintenance.validation.tooLong', { max: WORKSHOP_MAX }));
      if (values.notes.trim().length > LOG_NOTES_MAX) add('notes', issue('maintenance.validation.tooLong', { max: LOG_NOTES_MAX }));
    });
}

function logFields(values: LogFormValues, unit: DistanceUnit, locale: FormatLocale): LogPatch {
  return {
    item_id: values.itemId,
    type: values.itemId ? null : values.type,
    title: values.itemId === null && values.type === 'custom' ? values.title.trim() : null,
    done_at: parseGermanDay(values.date) ?? undefined,
    mileage_km: kmOf(values.km, unit),
    cost_cents: parseEuros(values.cost, locale) ?? null,
    workshop: values.workshop.trim() || null,
    notes: values.notes.trim() || null,
  };
}

export function logCreateBody(values: LogFormValues, unit: DistanceUnit, locale: FormatLocale, id: string): LogInput & { id: string } {
  const fields = logFields(values, unit, locale);
  return { id, ...fields, done_at: fields.done_at ?? '' };
}

export function logPatchBody(values: LogFormValues, unit: DistanceUnit, locale: FormatLocale, version: number): LogPatch {
  return { version, ...logFields(values, unit, locale) };
}
