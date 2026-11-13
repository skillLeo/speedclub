/**
 * EVT-03 form (09 §7.10, §8.7): the values of the five steps, their Zod rules (the server's limits, config/speedclub.php `events.*`),
 * the request bodies and the 422 map. Times are typed as the organiser reads a clock in Germany (TT.MM.JJJJ, HH:MM) and sent as
 * instants for Europe/Berlin.
 */
import type { FieldError, Path } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import {
  EVENT_LIMITS,
  EVENT_RULES,
  EVENT_TYPES,
  type EventDetail,
  type EventLocationVisibility,
  type EventRule,
  type EventType,
  type EventVisibility,
  type StoreEventBody,
  type UpdateEventBody,
} from '@/api/queries/events';

import { berlinParts, berlinToDate, parseInstant, textOf } from './model';

export const STEPS = ['basics', 'place', 'time', 'details', 'preview'] as const;
export type Step = (typeof STEPS)[number];

export type EventFormValues = {
  title: string;
  type: EventType;
  visibility: EventVisibility;
  venue: string;
  street: string;
  postcode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  locationVisibility: EventLocationVisibility;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  description: string;
  capacity: string;
  rules: EventRule[];
  organiserRules: string;
  acceptRules: boolean;
};

/** The fields each step checks before "Weiter". */
export const STEP_FIELDS: Readonly<Record<Step, readonly Path<EventFormValues>[]>> = {
  basics: ['title', 'type', 'visibility'],
  place: ['venue', 'street', 'postcode', 'city', 'lat', 'locationVisibility'],
  time: ['startDate', 'startTime', 'endDate', 'endTime'],
  details: ['description', 'capacity', 'rules', 'organiserRules', 'acceptRules'],
  preview: [],
};

/** The step a field lives on, for a 422 that names it. */
export function stepOf(field: string): Step {
  for (const step of STEPS) if ((STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  return 'preview';
}

/** API field → form field (applyServerErrors). */
export const SERVER_FIELDS: Readonly<Record<string, Path<EventFormValues>>> = {
  title: 'title',
  type: 'type',
  visibility: 'visibility',
  venue_name: 'venue',
  street: 'street',
  postcode: 'postcode',
  city: 'city',
  lat: 'lat',
  lng: 'lat',
  location_visibility: 'locationVisibility',
  starts_at: 'startDate',
  ends_at: 'endDate',
  description: 'description',
  organiser_rules: 'organiserRules',
  rules: 'rules',
  capacity: 'capacity',
  accept_rules: 'acceptRules',
};

const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;
const POSTCODE = /^[0-9A-Za-z \-]{3,10}$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "14.06.2026" → its parts, or null when it is no real day. */
export function parseDay(text: string): { year: number; month: number; day: number } | null {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return null;
  return { year, month, day };
}

export function parseClock(text: string): { hour: number; minute: number } | null {
  const match = TIME.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The instant of a typed date and time in Berlin, or null. */
export function instantOf(date: string, time: string): Date | null {
  const day = parseDay(date);
  const clock = parseClock(time);
  return day && clock ? berlinToDate({ ...day, ...clock }) : null;
}

/** "1406" → "14.06", "14062026" → "14.06.2026": digits only, the dots set while typing. */
export function maskDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** "1830" → "18:30". */
export function maskTime(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function dayText(date: Date): string {
  const p = berlinParts(date);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

export function clockText(date: Date): string {
  const p = berlinParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** A Zod message: an i18n key of the events namespace, with values after a "|" (as garage/schemas.ts does). */
const issue = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}|${JSON.stringify(values)}` : key;

/** The text of a field's error: the server's own sentence, or our key translated. */
export function fieldText(t: TFunction, error: FieldError | undefined): string | undefined {
  if (!error?.message) return undefined;
  if (error.type === 'server') return error.message;
  const [key = '', json] = error.message.split(/\|(.*)/s);
  const values = json ? (JSON.parse(json) as Record<string, string | number>) : undefined;
  return (t as unknown as (name: string, options?: Record<string, string | number>) => string)(
    `events:${key}`,
    values,
  );
}

const longText = (max: number) => z.string().max(max, issue('validation.textLong', { max }));

/**
 * The rules of every step. `now` is passed in, so the past/future checks follow `qaNow` and stay testable; `create` asks for the
 * accepted rules (only a new event sends `accept_rules`).
 */
export function eventSchema(now: Date, create: boolean) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(EVENT_LIMITS.titleMin, issue('validation.titleShort'))
        .max(EVENT_LIMITS.titleMax, issue('validation.titleLong')),
      type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
      visibility: z.enum(['public', 'followers', 'unlisted']),
      venue: longText(EVENT_LIMITS.venueMax),
      street: longText(EVENT_LIMITS.streetMax),
      postcode: z
        .string()
        .refine((value) => value.trim() === '' || POSTCODE.test(value.trim()), issue('validation.postcode')),
      city: z
        .string()
        .trim()
        .min(1, issue('validation.required'))
        .max(EVENT_LIMITS.cityMax, issue('validation.textLong', { max: EVENT_LIMITS.cityMax })),
      lat: z
        .number()
        .nullable()
        .refine((value) => value !== null, issue('validation.pin')),
      lng: z.number().nullable(),
      locationVisibility: z.enum(['public', 'after_rsvp']),
      startDate: z.string().refine((value) => parseDay(value) !== null, issue('validation.date')),
      startTime: z.string().refine((value) => parseClock(value) !== null, issue('validation.time')),
      endDate: z
        .string()
        .refine((value) => value.trim() === '' || parseDay(value) !== null, issue('validation.date')),
      endTime: z.string().refine((value) => parseClock(value) !== null, issue('validation.time')),
      description: longText(EVENT_LIMITS.descriptionMax),
      capacity: z.string().refine((value) => {
        if (value.trim() === '') return true;
        const n = Number(value.replace(/\./g, ''));
        return Number.isInteger(n) && n >= 1 && n <= EVENT_LIMITS.capacityMax;
      }, issue('validation.capacity')),
      rules: z
        .array(z.enum(EVENT_RULES as [EventRule, ...EventRule[]]))
        .refine((value) => value.includes('legal_only'), issue('editor.legalRequired')),
      organiserRules: longText(EVENT_LIMITS.rulesMax),
      acceptRules: z.boolean(),
    })
    .superRefine((values, context) => {
      if (create && !values.acceptRules)
        context.addIssue({
          code: 'custom',
          path: ['acceptRules'],
          message: issue('editor.acceptRulesRequired'),
        });
      const start = instantOf(values.startDate, values.startTime);
      if (!start) return;
      if (start.getTime() <= now.getTime())
        context.addIssue({ code: 'custom', path: ['startDate'], message: issue('validation.past') });
      else if (start.getTime() > now.getTime() + EVENT_LIMITS.maxDaysAhead * DAY_MS) {
        context.addIssue({ code: 'custom', path: ['startDate'], message: issue('validation.tooFar') });
      }
      const end = endInstant(values);
      if (!end) return;
      if (end.getTime() <= start.getTime())
        context.addIssue({ code: 'custom', path: ['endTime'], message: issue('validation.endBeforeStart') });
      else if (end.getTime() - start.getTime() > EVENT_LIMITS.maxDurationHours * HOUR_MS) {
        context.addIssue({ code: 'custom', path: ['endTime'], message: issue('validation.tooLong') });
      }
    });
}

/** The end: on the end date when one is typed, else on the start date. */
export function endInstant(values: Pick<EventFormValues, 'startDate' | 'endDate' | 'endTime'>): Date | null {
  return instantOf(values.endDate.trim() === '' ? values.startDate : values.endDate, values.endTime);
}

export function emptyValues(): EventFormValues {
  return {
    title: '',
    type: 'meet',
    visibility: 'public',
    venue: '',
    street: '',
    postcode: '',
    city: '',
    lat: null,
    lng: null,
    locationVisibility: 'public',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    description: '',
    capacity: '',
    rules: ['legal_only'],
    organiserRules: '',
    acceptRules: false,
  };
}

/** An event as the form shows it (EVT-03 edit). An after_rsvp place is exact here: the organiser reads it. */
export function valuesFrom(event: EventDetail): EventFormValues {
  const start = parseInstant(event.starts_at);
  const end = parseInstant(event.ends_at);
  const sameDay = start && end ? dayText(start) === dayText(end) : true;
  return {
    title: event.title,
    type: event.type,
    visibility: event.visibility,
    venue: event.location.venue_name ?? '',
    street: event.location.street ?? '',
    postcode: event.location.postcode ?? '',
    city: event.location.city ?? '',
    lat: event.location.lat,
    lng: event.location.lng,
    locationVisibility: event.location.visibility,
    startDate: start ? dayText(start) : '',
    startTime: start ? clockText(start) : '',
    endDate: end && !sameDay ? dayText(end) : '',
    endTime: end ? clockText(end) : '',
    description: textOf(event.description) ?? '',
    capacity: event.capacity !== null ? String(event.capacity) : '',
    rules: EVENT_RULES.filter((rule) => event.rules.includes(rule)),
    organiserRules: textOf(event.organiser_rules) ?? '',
    acceptRules: true,
  };
}

const nullable = (value: string) => (value.trim() === '' ? null : value.trim());

function detailsBody(values: EventFormValues): UpdateEventBody {
  const start = instantOf(values.startDate, values.startTime);
  const end = endInstant(values);
  return {
    title: values.title.trim(),
    type: values.type,
    visibility: values.visibility,
    location_visibility: values.locationVisibility,
    starts_at: start ? start.toISOString() : null,
    ends_at: end ? end.toISOString() : null,
    venue_name: nullable(values.venue),
    street: nullable(values.street),
    postcode: nullable(values.postcode),
    city: nullable(values.city),
    country: 'DE',
    lat: values.lat,
    lng: values.lng,
    description: nullable(values.description),
    organiser_rules: nullable(values.organiserRules),
    rules: EVENT_RULES.filter((rule) => values.rules.includes(rule)),
    capacity: values.capacity.trim() === '' ? null : Number(values.capacity.replace(/\./g, '')),
  };
}

/** POST events: always a draft first (the cover follows), then submit (ADR-437 wizard order). */
export function createBody(values: EventFormValues): StoreEventBody {
  const body = detailsBody(values);
  return {
    ...body,
    title: body.title ?? values.title.trim(),
    type: body.type ?? values.type,
    accept_rules: true,
    submit: false,
  };
}

/**
 * PATCH events/{slug}: only what changed, so a pre-moderated event goes back to review only for a field staff approved (ADR-439),
 * and `location_visibility` is left out once it is fixed.
 */
export function updateBody(
  values: EventFormValues,
  before: EventFormValues,
  locationLocked: boolean,
): UpdateEventBody {
  const next = detailsBody(values);
  const previous = detailsBody(before);
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === 'location_visibility' && locationLocked) continue;
    if (JSON.stringify(value) !== JSON.stringify((previous as Record<string, unknown>)[key]))
      body[key] = value;
  }
  return body as UpdateEventBody;
}

/** ADR-439: what a change of a published event triggers — attendees are told (time, place), or the event goes back to review. */
export function changeEffects(body: UpdateEventBody): { notifies: boolean; reviewFields: boolean } {
  const keys = Object.keys(body);
  const material = ['starts_at', 'ends_at', 'venue_name', 'street', 'postcode', 'city', 'lat', 'lng'];
  const reviewed = ['title', 'description', 'venue_name', 'street', 'postcode', 'city', 'lat', 'lng'];
  return {
    notifies: keys.some((key) => material.includes(key)),
    reviewFields: keys.some((key) => reviewed.includes(key)),
  };
}
