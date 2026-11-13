/**
 * Client checks of the garage forms. The server decides (422 lands on the same fields); these say early what it would say
 * anyway, with the bounds of its rules (VehicleAttributesRequest, UpdateSpecsRequest, ModificationRequest, ModFields).
 *
 * A message is a key of the garage namespace, with its values after a "|" as JSON, so a range can name its bounds.
 */
import type { TFunction } from 'i18next';
import type { FieldError } from 'react-hook-form';
import { z } from 'zod';

import type { ModCategoryField } from '@/api/queries/catalog';
import { parseNumber, type FormatLocale } from '@/lib/format';

import { BRAND_MAX_LENGTH, NOTES_MAX_LENGTH, parseCost, parseMonth, PART_NUMBER_MAX_LENGTH, TEXT_MAX_LENGTH, TITLE_MAX_LENGTH, type FieldValue, type ModFormValues } from './modForm';
import { LEGAL_STATUSES } from './legalStatus';
import type { BasicsValues, SpecsValues } from './model';

export const FIRST_MODEL_YEAR = 1886;
export const NICKNAME_MAX_LENGTH = 60;
export const COLOR_MAX_LENGTH = 60;
export const DESCRIPTION_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 500;
export const ALT_MAX_LENGTH = 500;
export const ENGINE_CODE_MAX_LENGTH = 40;
export const ENGINE_TEXT_MAX_LENGTH = 100;
const DISPLACEMENT_MAX = 20000;
const POWER_MAX = 9999;
const TORQUE_MAX = 9999;

export function issue(key: string, values?: Record<string, string | number>): string {
  return values ? `${key}|${JSON.stringify(values)}` : key;
}

/** The text of a field error: a server message is already translated, a client one is a key with its values. */
export function fieldMessage(t: TFunction<'garage'>, error: FieldError | undefined): string | undefined {
  if (!error?.message) return undefined;
  if (error.type === 'server') return error.message;
  const [key = '', json] = error.message.split(/\|(.*)/s);
  const values = json ? (JSON.parse(json) as Record<string, string | number>) : undefined;
  // The key is built at run time, which i18next's typed keys cannot follow.
  const translate = t as unknown as (name: string, options?: Record<string, string | number>) => string;
  return translate(key, values);
}

const choice = z.object({ id: z.number().nullable(), name: z.string() }).nullable();

/** GAR-03 step 1 and GAR-05: make, model and year are what makes a vehicle publishable (§3.2) and cannot go once it is. */
export function basicsSchema(maxYear: number) {
  return z.object({
    make: choice.refine((value) => value !== null && value.name.trim() !== '', issue('validation.makeRequired')),
    model: choice.refine((value) => value !== null && value.name.trim() !== '', issue('validation.modelRequired')),
    generation: choice,
    year: z.string().superRefine((value, context) => {
      if (value.trim() === '') {
        context.addIssue({ code: 'custom', message: issue('validation.yearRequired') });
        return;
      }
      const message = yearIssue(value, maxYear);
      if (message) context.addIssue({ code: 'custom', message });
    }),
    nickname: z.string().max(NICKNAME_MAX_LENGTH, issue('validation.tooLong', { max: NICKNAME_MAX_LENGTH })),
    color: z.string().max(COLOR_MAX_LENGTH, issue('validation.tooLong', { max: COLOR_MAX_LENGTH })),
    description: z.string().max(DESCRIPTION_MAX_LENGTH, issue('validation.tooLong', { max: DESCRIPTION_MAX_LENGTH })),
  }) satisfies z.ZodType<BasicsValues>;
}

/** The next model year is allowed, as on the server, counted in Europe/Berlin like `currentMonth`. */
export function maxModelYear(now: Date): number {
  return Number(currentMonth(now).slice(0, 4)) + 1;
}

/** The issue of a year that is entered but out of range; null when it fits. A draft may save without one (§3.2). */
export function yearIssue(value: string, maxYear: number): string | null {
  const year = Number(value.trim());
  return Number.isInteger(year) && year >= FIRST_MODEL_YEAR && year <= maxYear ? null : issue('validation.yearRange', { min: FIRST_MODEL_YEAR, max: maxYear });
}

function optionalNumber(locale: FormatLocale, bounds: { min: number; max: number; integer?: boolean; exclusiveMin?: boolean }) {
  return z.string().superRefine((value, context) => {
    if (value.trim() === '') return;
    const number = parseNumber(value, locale);
    if (!Number.isFinite(number)) {
      // A field of whole numbers has no decimal mark to advise: "use a comma" would only lead to "enter a whole number".
      context.addIssue({ code: 'custom', message: issue(bounds.integer ? 'validation.integer' : 'validation.number') });
      return;
    }
    const low = bounds.exclusiveMin ? number <= bounds.min : number < bounds.min;
    if (low || number > bounds.max) {
      context.addIssue({ code: 'custom', message: issue('validation.range', { min: bounds.exclusiveMin ? 1 : bounds.min, max: bounds.max }) });
    } else if (bounds.integer && !Number.isInteger(number)) {
      context.addIssue({ code: 'custom', message: issue('validation.integer') });
    }
  });
}

const fuel = z.enum(['petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'cng', 'ethanol', 'other']).or(z.literal(''));
const aspiration = z.enum(['naturally_aspirated', 'turbo', 'biturbo', 'supercharged', 'twincharged', 'none']).or(z.literal(''));
const source = z.enum(['factory', 'claimed', 'measured']).or(z.literal(''));

/** FS-5 Technik and GAR-06. */
export function specsSchema(locale: FormatLocale) {
  return z.object({
    engineCode: z.string().max(ENGINE_CODE_MAX_LENGTH, issue('validation.tooLong', { max: ENGINE_CODE_MAX_LENGTH })),
    engineText: z.string().max(ENGINE_TEXT_MAX_LENGTH, issue('validation.tooLong', { max: ENGINE_TEXT_MAX_LENGTH })),
    displacement: optionalNumber(locale, { min: 1, max: DISPLACEMENT_MAX, integer: true }),
    fuel,
    aspiration,
    powerValue: optionalNumber(locale, { min: 0, max: POWER_MAX, exclusiveMin: true }),
    powerUnit: z.enum(['ps', 'kw', 'hp']),
    powerSource: source,
    torque: optionalNumber(locale, { min: 1, max: TORQUE_MAX, integer: true }),
    torqueSource: source,
    drivetrain: z.enum(['front', 'rear', 'all']).or(z.literal('')),
    gearbox: z.enum(['manual', 'automatic', 'dual_clutch', 'sequential', 'cvt', 'single_speed']).or(z.literal('')),
  }) satisfies z.ZodType<SpecsValues>;
}

export const descriptionSchema = z.object({
  description: z.string().max(DESCRIPTION_MAX_LENGTH, issue('validation.tooLong', { max: DESCRIPTION_MAX_LENGTH })),
});

export const noteSchema = z.object({
  note: z
    .string()
    .refine((value) => value.trim() !== '', issue('validation.noteRequired'))
    .refine((value) => value.length <= NOTE_MAX_LENGTH, issue('validation.tooLong', { max: NOTE_MAX_LENGTH })),
});

/** GAR-08: alt text, category and the focal point as shares of width and height. */
export const photoDetailsSchema = z.object({
  alt: z.string().max(ALT_MAX_LENGTH, issue('validation.tooLong', { max: ALT_MAX_LENGTH })),
  category: z.enum(['exterior', 'interior', 'engine', 'wheels', 'detail', 'other']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** A number field whose step allows whole numbers only (step 1 from a whole minimum, say): it takes no decimal mark. */
function wholeNumbersOnly(field: Pick<ModCategoryField, 'min' | 'step'>): boolean {
  return field.step !== null && field.step >= 1 && Number.isInteger(field.step) && Number.isInteger(field.min ?? 0);
}

/** One field of a category, as ModFields checks it: numbers within bounds and on the step, text within length and pattern. */
export function fieldIssue(field: ModCategoryField, value: FieldValue | undefined, locale: FormatLocale): string | null {
  if (field.type === 'boolean') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return field.required ? issue('validation.fieldRequired', { field: field.label }) : null;
  if (field.type === 'number') {
    const number = parseNumber(text, locale);
    if (!Number.isFinite(number)) return issue(wholeNumbersOnly(field) ? 'validation.integer' : 'validation.number');
    if ((field.min !== null && number < field.min) || (field.max !== null && number > field.max)) {
      return issue('validation.range', { min: field.min ?? 0, max: field.max ?? number });
    }
    if (field.step !== null && field.step > 0) {
      const steps = (number - (field.min ?? 0)) / field.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) return issue('validation.step', { step: String(field.step).replace('.', locale === 'de' ? ',' : '.') });
    }
    return null;
  }
  const max = field.type === 'brand' ? BRAND_MAX_LENGTH : TEXT_MAX_LENGTH;
  if (text.length > max) return issue('validation.tooLong', { max });
  if (field.type === 'select' && field.options && !field.options.some((option) => option.value === text)) return issue('validation.option');
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(text)) return issue('validation.pattern', { example: field.example ?? '' });
    } catch {
      // A pattern this engine cannot read is left to the server.
    }
  }
  return null;
}

/** GAR-10: the category's fields plus the common ones. `month` is the current "YYYY-MM": an installation is never ahead. */
export function modSchema(fields: readonly ModCategoryField[], locale: FormatLocale, month: string) {
  return z
    .object({
      status: z.enum(['installed', 'planned', 'removed']),
      title: z.string().max(TITLE_MAX_LENGTH, issue('validation.tooLong', { max: TITLE_MAX_LENGTH })),
      partNumber: z.string().max(PART_NUMBER_MAX_LENGTH, issue('validation.tooLong', { max: PART_NUMBER_MAX_LENGTH })),
      installedOn: z.string(),
      cost: z.string(),
      legalStatus: z.enum(LEGAL_STATUSES).or(z.literal('')),
      notes: z.string().max(NOTES_MAX_LENGTH, issue('validation.tooLong', { max: NOTES_MAX_LENGTH })),
      fields: z.record(z.string(), z.union([z.string(), z.boolean()])),
      product: z.object({ id: z.string(), label: z.string() }).nullable(),
    })
    .superRefine((values, context) => {
      for (const field of fields) {
        // The rear diameter exists only with Mischbereifung (modLayout, modPayload): hidden, it cannot hold a save back.
        if (field.key === 'diameter_rear' && values.fields.staggered !== true) continue;
        const message = fieldIssue(field, values.fields[field.key], locale);
        if (message) context.addIssue({ code: 'custom', message, path: ['fields', field.key] });
      }
      if (values.installedOn.trim() !== '' && values.status !== 'planned') {
        const parsed = parseMonth(values.installedOn);
        if (!parsed) context.addIssue({ code: 'custom', message: issue('validation.month'), path: ['installedOn'] });
        else if (parsed > month) context.addIssue({ code: 'custom', message: issue('validation.monthFuture'), path: ['installedOn'] });
      }
      if (values.cost.trim() !== '' && Number.isNaN(parseCost(values.cost, locale))) {
        context.addIssue({ code: 'custom', message: issue('validation.cost'), path: ['cost'] });
      }
    }) satisfies z.ZodType<ModFormValues>;
}

/** "2026-11" in Europe/Berlin. */
export function currentMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(now.getFullYear());
  const monthPart = parts.find((part) => part.type === 'month')?.value ?? String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${monthPart}`;
}
