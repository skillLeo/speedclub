/**
 * BIZ-02 Bewerbung and the profile edit (09 §7.11, §8.10): the form values, the Zod rules of each step (BusinessDetailsRules and
 * BusinessHours on the server, so a 422 is rare), the server field map for 422s, and the bodies of POST and PATCH me/business.
 */
import type { TFunction } from 'i18next';
import type { FieldError, Path } from 'react-hook-form';
import { z } from 'zod';

import {
  BUSINESS_KINDS,
  BUSINESS_LIMITS,
  COUNTRIES,
  LEGAL_FORMS,
  LEGAL_FORMS_WITHOUT_REGISTER,
  type BusinessCountry,
  type BusinessKind,
  type BusinessLegalForm,
  type MyBusiness,
  type StoreBusinessBody,
  type UpdateBusinessBody,
} from '@/api/queries/businesses';

import { DAY_KEYS, type DayKey } from './model';

export const STEPS = ['business', 'impressum', 'contact', 'hours', 'finish'] as const;
export type Step = (typeof STEPS)[number];

export type DayHours = { open: boolean; opens: string; closes: string; split: boolean; opens2: string; closes2: string };

export type BusinessFormValues = {
  name: string;
  kind: BusinessKind;
  about: string;
  services: string[];
  legalName: string;
  legalForm: BusinessLegalForm;
  representative: string;
  registerCourt: string;
  registerNumber: string;
  vatId: string;
  street: string;
  postcode: string;
  city: string;
  country: BusinessCountry;
  email: string;
  phone: string;
  website: string;
  hours: Record<DayKey, DayHours>;
  documentNote: string;
  acceptTerms: boolean;
};

/** The fields each step checks before "Weiter". */
export const STEP_FIELDS: Readonly<Record<Step, readonly Path<BusinessFormValues>[]>> = {
  business: ['name', 'kind', 'about', 'services'],
  impressum: ['legalName', 'legalForm', 'representative', 'registerCourt', 'registerNumber', 'vatId'],
  contact: ['street', 'postcode', 'city', 'country', 'email', 'phone', 'website'],
  hours: ['hours'],
  finish: ['documentNote', 'acceptTerms'],
};

/** The step a field lives on, for a 422 or a failed check of the whole form. */
export function stepOf(field: string): Step {
  const root = field.split('.')[0] ?? field;
  return STEPS.find((step) => STEP_FIELDS[step].some((name) => name === root || name.split('.')[0] === root)) ?? 'business';
}

/** A 422's field names (snake case, `opening_hours.mon.0.0`) on the form's fields. */
export function serverField(name: string): Path<BusinessFormValues> | null {
  const direct: Readonly<Record<string, Path<BusinessFormValues>>> = {
    name: 'name',
    kind: 'kind',
    about: 'about',
    services: 'services',
    legal_name: 'legalName',
    legal_form: 'legalForm',
    representative: 'representative',
    register_court: 'registerCourt',
    register_number: 'registerNumber',
    vat_id: 'vatId',
    street: 'street',
    postcode: 'postcode',
    city: 'city',
    country: 'country',
    email: 'email',
    phone: 'phone',
    website: 'website',
    opening_hours: 'hours',
    document_note: 'documentNote',
    accept_terms: 'acceptTerms',
  };
  if (direct[name]) return direct[name];
  if (name.startsWith('services.')) return 'services';
  const day = /^opening_hours\.(mon|tue|wed|thu|fri|sat|sun)\b/.exec(name)?.[1] as DayKey | undefined;
  if (day) return `hours.${day}.opens`;
  if (name.startsWith('opening_hours')) return 'hours';
  return null;
}

/** Every server name a 422 can carry, mapped (for applyServerErrors). */
export function serverFieldMap(errors: Readonly<Record<string, readonly string[]>>): Record<string, Path<BusinessFormValues>> {
  const map: Record<string, Path<BusinessFormValues>> = {};
  for (const name of Object.keys(errors)) {
    const field = serverField(name);
    if (field) map[name] = field;
  }
  return map;
}

/** A Zod message: an i18n key of the parts namespace, with values after a "|" (as events/schemas.ts does). */
const issue = (key: string, values?: Record<string, string | number>) => (values ? `${key}|${JSON.stringify(values)}` : key);

/** The text of a field's error: the server's own sentence, or our key translated. */
export function fieldText(t: TFunction, error: FieldError | undefined): string | undefined {
  if (!error?.message) return undefined;
  if (error.type === 'server') return error.message;
  const [key = '', json] = error.message.split(/\|(.*)/s);
  const values = json ? (JSON.parse(json) as Record<string, string | number>) : undefined;
  return (t as unknown as (name: string, options?: Record<string, string | number>) => string)(`parts:${key}`, values);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const POSTCODE = /^[0-9A-Za-z -]{3,10}$/;
const PHONE = /^\+?[0-9 ()/-]{6,40}$/;
const VAT_ID = /^[A-Z]{2}[0-9A-Z]{2,13}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "0930" → "09:30" as it is typed. */
export function maskTime(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** A website as the server takes it (`url:https`): an address without a scheme gets https://. */
export function normalisedWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/^http:\/\//i, 'https://') : `https://${trimmed}`;
}

function validWebsite(value: string): boolean {
  const url = normalisedWebsite(value);
  if (url === null) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') && url.length <= BUSINESS_LIMITS.websiteMax;
  } catch {
    return false;
  }
}

const text = (min: number, max: number, required: boolean) =>
  z
    .string()
    .trim()
    .refine((value) => !required || value.length > 0, issue('validation.required'))
    .refine((value) => value.length === 0 || value.length >= min, issue('validation.tooShort', { min }))
    .refine((value) => value.length <= max, issue('validation.tooLong', { max }));

const dayHours = z
  .object({
    open: z.boolean(),
    opens: z.string(),
    closes: z.string(),
    split: z.boolean(),
    opens2: z.string(),
    closes2: z.string(),
  })
  .superRefine((day, context) => {
    if (!day.open) return;
    if (!TIME.test(day.opens)) context.addIssue({ code: 'custom', path: ['opens'], message: issue('validation.time') });
    if (!TIME.test(day.closes)) context.addIssue({ code: 'custom', path: ['closes'], message: issue('validation.time') });
    else if (TIME.test(day.opens) && day.closes <= day.opens) context.addIssue({ code: 'custom', path: ['closes'], message: issue('validation.closesBeforeOpens') });
    if (!day.split) return;
    if (!TIME.test(day.opens2)) context.addIssue({ code: 'custom', path: ['opens2'], message: issue('validation.time') });
    else if (TIME.test(day.closes) && day.opens2 < day.closes) context.addIssue({ code: 'custom', path: ['opens2'], message: issue('validation.secondRange') });
    if (!TIME.test(day.closes2)) context.addIssue({ code: 'custom', path: ['closes2'], message: issue('validation.time') });
    else if (TIME.test(day.opens2) && day.closes2 <= day.opens2) context.addIssue({ code: 'custom', path: ['closes2'], message: issue('validation.closesBeforeOpens') });
  });

/**
 * The rules of every step. `creating` asks for the accepted declaration (only POST sends `accept_terms`); `locked` (a verified
 * business, ADR-455) leaves name, legal form, representative, address and register details to support.
 */
export function businessSchema(creating: boolean) {
  return z
    .object({
      name: text(BUSINESS_LIMITS.nameMin, BUSINESS_LIMITS.nameMax, true),
      kind: z.enum(BUSINESS_KINDS as [BusinessKind, ...BusinessKind[]]),
      about: text(0, BUSINESS_LIMITS.aboutMax, false),
      services: z
        .array(z.string())
        .max(BUSINESS_LIMITS.servicesMax, issue('validation.servicesMax', { max: BUSINESS_LIMITS.servicesMax })),
      legalName: text(BUSINESS_LIMITS.legalNameMin, BUSINESS_LIMITS.legalNameMax, true),
      legalForm: z.enum(LEGAL_FORMS as [BusinessLegalForm, ...BusinessLegalForm[]]),
      representative: text(BUSINESS_LIMITS.representativeMin, BUSINESS_LIMITS.representativeMax, true),
      registerCourt: text(0, BUSINESS_LIMITS.registerCourtMax, false),
      registerNumber: text(0, BUSINESS_LIMITS.registerNumberMax, false),
      vatId: z
        .string()
        .trim()
        .refine((value) => value === '' || VAT_ID.test(value.toUpperCase().replace(/\s/g, '')), issue('validation.vatId')),
      street: text(BUSINESS_LIMITS.streetMin, BUSINESS_LIMITS.streetMax, true),
      postcode: z
        .string()
        .trim()
        .refine((value) => value.length > 0, issue('validation.required'))
        .refine((value) => value.length === 0 || POSTCODE.test(value), issue('validation.postcode')),
      city: text(BUSINESS_LIMITS.cityMin, BUSINESS_LIMITS.cityMax, true),
      country: z.enum(COUNTRIES),
      email: z
        .string()
        .trim()
        .refine((value) => value.length > 0, issue('validation.required'))
        .refine((value) => value.length === 0 || (EMAIL.test(value) && value.length <= BUSINESS_LIMITS.emailMax), issue('validation.email')),
      phone: z
        .string()
        .trim()
        .refine((value) => value === '' || PHONE.test(value), issue('validation.phone')),
      website: z.string().trim().refine(validWebsite, issue('validation.website')),
      hours: z.object(Object.fromEntries(DAY_KEYS.map((day) => [day, dayHours])) as Record<DayKey, typeof dayHours>),
      documentNote: text(0, BUSINESS_LIMITS.documentNoteMax, false),
      acceptTerms: z.boolean(),
    })
    .superRefine((values, context) => {
      if (creating && !values.acceptTerms) context.addIssue({ code: 'custom', path: ['acceptTerms'], message: issue('validation.acceptTerms') });
      if (!LEGAL_FORMS_WITHOUT_REGISTER.has(values.legalForm)) {
        if (!values.registerCourt.trim()) context.addIssue({ code: 'custom', path: ['registerCourt'], message: issue('validation.registerRequired') });
        if (!values.registerNumber.trim()) context.addIssue({ code: 'custom', path: ['registerNumber'], message: issue('validation.registerRequired') });
      }
      const seen = new Set<string>();
      values.services.forEach((service) => {
        const key = service.trim().toLowerCase();
        if (key.length < BUSINESS_LIMITS.serviceMin || key.length > BUSINESS_LIMITS.serviceMax || seen.has(key)) {
          context.addIssue({ code: 'custom', path: ['services'], message: issue('validation.service', { min: BUSINESS_LIMITS.serviceMin, max: BUSINESS_LIMITS.serviceMax }) });
        }
        seen.add(key);
      });
    }) satisfies z.ZodType<BusinessFormValues>;
}

const closedDay = (): DayHours => ({ open: false, opens: '', closes: '', split: false, opens2: '', closes2: '' });

/** A new application: Monday to Friday 09:00–18:00 as a starting point the member changes, weekend closed. */
export function emptyValues(): BusinessFormValues {
  const weekday = (): DayHours => ({ open: true, opens: '09:00', closes: '18:00', split: false, opens2: '', closes2: '' });
  return {
    name: '',
    kind: 'workshop',
    about: '',
    services: [],
    legalName: '',
    legalForm: 'gmbh',
    representative: '',
    registerCourt: '',
    registerNumber: '',
    vatId: '',
    street: '',
    postcode: '',
    city: '',
    country: 'DE',
    email: '',
    phone: '',
    website: '',
    hours: { mon: weekday(), tue: weekday(), wed: weekday(), thu: weekday(), fri: weekday(), sat: closedDay(), sun: closedDay() },
    documentNote: '',
    acceptTerms: false,
  };
}

/** The form from the business as it is stored. */
export function valuesFrom(business: MyBusiness): BusinessFormValues {
  const hours = Object.fromEntries(DAY_KEYS.map((day) => [day, closedDay()])) as Record<DayKey, DayHours>;
  for (const entry of business.opening_hours) {
    if (!(DAY_KEYS as readonly string[]).includes(entry.day)) continue;
    const [first, second] = entry.ranges;
    hours[entry.day as DayKey] = {
      open: Boolean(first),
      opens: first?.opens ?? '',
      closes: first?.closes ?? '',
      split: Boolean(second),
      opens2: second?.opens ?? '',
      closes2: second?.closes ?? '',
    };
  }
  const country = (COUNTRIES as readonly string[]).includes(business.address.country) ? (business.address.country as BusinessCountry) : 'DE';
  return {
    name: business.name,
    kind: business.kind,
    about: business.about ?? '',
    services: [...business.services],
    legalName: business.impressum.legal_name,
    legalForm: business.impressum.legal_form,
    representative: business.impressum.representative ?? '',
    registerCourt: business.impressum.register_court ?? '',
    registerNumber: business.impressum.register_number ?? '',
    vatId: business.impressum.vat_id ?? '',
    street: business.address.street,
    postcode: business.address.postcode,
    city: business.address.city,
    country,
    email: business.contact.email,
    phone: business.contact.phone ?? '',
    website: business.contact.website ?? '',
    hours,
    documentNote: business.document_note ?? '',
    acceptTerms: true,
  };
}

/** {"mon": [["09:00","18:00"]], …}: closed days are left out. */
export function openingHoursBody(hours: Record<DayKey, DayHours>): Record<string, string[][]> {
  const body: Record<string, string[][]> = {};
  for (const day of DAY_KEYS) {
    const value = hours[day];
    if (!value.open) continue;
    body[day] = value.split ? [[value.opens, value.closes], [value.opens2, value.closes2]] : [[value.opens, value.closes]];
  }
  return body;
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** The fields the server stores, as POST and PATCH name them. */
function fullBody(values: BusinessFormValues): UpdateBusinessBody & StoreBusinessBody {
  const register = !LEGAL_FORMS_WITHOUT_REGISTER.has(values.legalForm);
  return {
    name: values.name.trim(),
    kind: values.kind,
    about: orNull(values.about),
    services: values.services.map((service) => service.trim()).filter(Boolean),
    legal_name: values.legalName.trim(),
    legal_form: values.legalForm,
    representative: values.representative.trim(),
    register_court: register ? orNull(values.registerCourt) : null,
    register_number: register ? orNull(values.registerNumber) : null,
    vat_id: orNull(values.vatId.toUpperCase().replace(/\s/g, '')),
    street: values.street.trim(),
    postcode: values.postcode.trim(),
    city: values.city.trim(),
    country: values.country,
    email: values.email.trim(),
    phone: orNull(values.phone),
    website: normalisedWebsite(values.website),
    opening_hours: openingHoursBody(values.hours),
    document_note: orNull(values.documentNote),
    accept_terms: true,
  };
}

/** POST me/business. */
export function applyBody(values: BusinessFormValues): StoreBusinessBody {
  return fullBody(values);
}

/** The Impressum fields a verified business no longer changes in the app (ADR-455: they go back through review via support). */
export const LOCKED_KEYS = ['name', 'legal_name', 'legal_form', 'representative', 'street', 'postcode', 'city', 'country', 'register_court', 'register_number'] as const;

/** PATCH me/business: only what changed since `saved`, and never a locked field of a verified business. */
export function updateBody(values: BusinessFormValues, saved: BusinessFormValues, locked: boolean): UpdateBusinessBody {
  const next = fullBody(values) as Record<string, unknown>;
  const before = fullBody(saved) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === 'accept_terms') continue;
    if (locked && (LOCKED_KEYS as readonly string[]).includes(key)) continue;
    if (JSON.stringify(value) !== JSON.stringify(before[key])) body[key] = value;
  }
  return body as UpdateBusinessBody;
}

/** Whether a field is locked for a verified business (shown read-only with the support hint). */
export function isLockedField(field: Path<BusinessFormValues>, locked: boolean): boolean {
  if (!locked) return false;
  const map: Partial<Record<Path<BusinessFormValues>, (typeof LOCKED_KEYS)[number]>> = {
    name: 'name',
    legalName: 'legal_name',
    legalForm: 'legal_form',
    representative: 'representative',
    street: 'street',
    postcode: 'postcode',
    city: 'city',
    country: 'country',
    registerCourt: 'register_court',
    registerNumber: 'register_number',
  };
  return map[field] !== undefined;
}
