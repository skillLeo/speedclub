/**
 * GAR-10 between the category schema of the API and the form (02_PRODUCT_SPEC §3.3, FS-6). The schema is data an admin can
 * edit (ADM-15), so the form is laid out from it: Räder & Reifen follows FS-6 exactly, every other category lists its fields
 * in the schema's order with front/rear pairs side by side.
 */
import type { ModCategoryField } from '@/api/queries/catalog';
import type { ModFieldValues, ModPayload, ModStatus, OwnerMod } from '@/api/queries/mods';
import { formatNumber, parseNumber, roundInt, type FormatLocale } from '@/lib/format';

import { legalStatusOf, type LegalStatus } from './legalStatus';

export const MOD_STATUSES = ['installed', 'planned', 'removed'] as const satisfies readonly ModStatus[];
export const WHEELS = 'wheels_tires';
export const NOTES_MAX_LENGTH = 500;
export const TITLE_MAX_LENGTH = 160;
export const PART_NUMBER_MAX_LENGTH = 80;
/** ModFields: brand fields hold 120 characters, other text 160. */
export const BRAND_MAX_LENGTH = 120;
export const TEXT_MAX_LENGTH = 160;
const MAX_COST_EUROS = 1_000_000;

export type FieldValue = string | boolean;

export type ModFormValues = {
  status: ModStatus;
  /** Empty means the automatic title from brand and model. */
  title: string;
  partNumber: string;
  /** "03/2023" as typed. */
  installedOn: string;
  /** "1.234,50" as typed. */
  cost: string;
  /** [SIG `sig.mod_legal_status`]: empty until the owner chooses one. */
  legalStatus: LegalStatus | '';
  notes: string;
  fields: Record<string, FieldValue>;
  /** M4.14 [`parts_catalogue`]: the linked catalogue product ("KW Variante 3"), or none (free text stays possible). */
  product: { id: string; label: string } | null;
};

export type LayoutRow =
  | { kind: 'single'; field: ModCategoryField }
  | { kind: 'pair'; fields: readonly [ModCategoryField, ModCategoryField] }
  | { kind: 'switch'; field: ModCategoryField };

export type LayoutGroup = { key: 'rims' | 'tyres' | 'details'; rows: LayoutRow[] };

const FRONT = /_front$/;

/** The rear partner of a front field ("width_front" → "width_rear"). */
function rearOf(key: string): string | null {
  return FRONT.test(key) ? key.replace(FRONT, '_rear') : null;
}

function rowsOf(fields: readonly ModCategoryField[]): LayoutRow[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const taken = new Set<string>();
  const rows: LayoutRow[] = [];
  for (const field of fields) {
    if (taken.has(field.key)) continue;
    taken.add(field.key);
    if (field.type === 'boolean') {
      rows.push({ kind: 'switch', field });
      continue;
    }
    const rear = rearOf(field.key);
    const partner = rear ? byKey.get(rear) : undefined;
    if (partner && !taken.has(partner.key)) {
      taken.add(partner.key);
      rows.push({ kind: 'pair', fields: [field, partner] });
    } else {
      rows.push({ kind: 'single', field });
    }
  }
  return rows;
}

const RIM_ORDER = ['wheel_brand', 'wheel_model', 'diameter', 'width_front', 'et_front', 'bolt_pattern', 'spacer_front', 'finish', 'staggered'];
const TYRE_KEYS = new Set(['tyre_brand', 'tyre_model', 'tyre_size_front', 'tyre_size_rear']);

/**
 * FS-6: FELGEN (Marke, Modell, Durchmesser, Breite vorne/hinten, ET vorne/hinten, Lochkreis, Mischbereifung) and REIFEN
 * (Marke, Modell, Größe vorne/hinten). The rear diameter only exists when it differs (ADR-112), so it joins the diameter
 * once Mischbereifung is on. Fields an admin adds later land at the end of their group.
 */
/**
 * The fields GAR-10 offers (M3.3 catalogue, ADM-15): an archived field takes no new entries, so a new modification never shows it;
 * an existing one keeps it while it holds a value, so nothing stored disappears from the form or from the next PATCH.
 */
export function formFields(fields: readonly ModCategoryField[], mod: Pick<OwnerMod, 'fields'> | undefined): ModCategoryField[] {
  const stored = mod?.fields ?? {};
  return fields.filter((field) => {
    if (!field.archived) return true;
    const value = stored[field.key];
    return value !== undefined && value !== null && value !== '';
  });
}

export function modLayout(categoryKey: string, fields: readonly ModCategoryField[], staggered: boolean): LayoutGroup[] {
  if (categoryKey !== WHEELS) return [{ key: 'details', rows: rowsOf(fields) }];
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const rimFields = fields.filter((field) => !TYRE_KEYS.has(field.key));
  const known = RIM_ORDER.flatMap((key) => {
    const field = byKey.get(key);
    return field ? [field] : [];
  });
  // A rear field belongs to its front partner's row; one without a partner stands alone.
  const paired = new Set(rimFields.flatMap((field) => (rearOf(field.key) && byKey.has(rearOf(field.key) ?? '') ? [rearOf(field.key) ?? ''] : [])));
  paired.add('diameter_rear');
  const rest = rimFields.filter((field) => !RIM_ORDER.includes(field.key) && !paired.has(field.key));
  const rows: LayoutRow[] = [];
  for (const field of [...known, ...rest]) {
    const partner = field.key === 'diameter' ? (staggered ? byKey.get('diameter_rear') : undefined) : byKey.get(rearOf(field.key) ?? '');
    if (field.type === 'boolean') rows.push({ kind: 'switch', field });
    else rows.push(partner ? { kind: 'pair', fields: [field, partner] } : { kind: 'single', field });
  }
  const tyres = rowsOf(fields.filter((field) => TYRE_KEYS.has(field.key)));
  return [
    { key: 'rims', rows },
    ...(tyres.length > 0 ? [{ key: 'tyres' as const, rows: tyres }] : []),
  ];
}

/** The category fields a layout draws: what a failed check can mark and focus. */
export function renderedFieldKeys(groups: readonly LayoutGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.rows.flatMap((row) => (row.kind === 'pair' ? row.fields.map((field) => field.key) : [row.field.key]))));
}

/** The unit after the value: rim width in J, diameters in ″ (§3.9 "19″ × 9,5J"), everything else as the schema says. */
export function unitOf(field: Pick<ModCategoryField, 'key' | 'unit'>): string | undefined {
  if (field.unit === 'in') return field.key.startsWith('width') ? 'J' : '″';
  return field.unit ?? undefined;
}

/**
 * What the field shows for a stored value. A number has no precision limit on the server, and PATCH replaces `fields` as a
 * whole, so it stays exactly as stored, with the locale's decimal mark and no grouping: untouched values go back out unchanged.
 */
export function storedText(value: string | number | boolean | undefined, locale: FormatLocale): FieldValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return locale === 'de' ? String(value).replace('.', ',') : String(value);
  return value;
}

/** "2023-03" → "03/2023". */
export function monthText(installedOn: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(installedOn ?? '');
  return match ? `${match[2]}/${match[1]}` : '';
}

/** "3/2023", "03.2023", "03/2023" → "2023-03"; null when it is not a month. */
export function parseMonth(text: string): string | null {
  const match = /^\s*(\d{1,2})\s*[/.\-]\s*(\d{4})\s*$/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return null;
  return `${match[2]}-${String(month).padStart(2, '0')}`;
}

/** Typing "032023" or "03/2023" both end as "03/2023": the slash comes by itself after the month. */
export function maskMonth(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 6);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** "1.234,50" → 123450. NaN when it is not an amount. */
export function parseCost(text: string, locale: FormatLocale): number {
  const value = parseNumber(text.replace('€', ''), locale);
  return Number.isFinite(value) && value >= 0 && value <= MAX_COST_EUROS ? Math.round(value * 100) : Number.NaN;
}

export function costText(cents: number | null | undefined, locale: FormatLocale): string {
  if (cents === null || cents === undefined) return '';
  const fraction = cents % 100 === 0 ? 0 : 2;
  return formatNumber(cents / 100, locale, { minFractionDigits: fraction, maxFractionDigits: fraction });
}

export function modValuesFrom(mod: OwnerMod | undefined, fields: readonly ModCategoryField[], locale: FormatLocale): ModFormValues {
  const stored = mod?.fields ?? {};
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    const value = storedText(stored[field.key], locale);
    values[field.key] = value ?? (field.type === 'boolean' ? false : '');
  }
  return {
    status: mod?.status ?? 'installed',
    // A title the member wrote stays; the automatic one is brand + model and shows as the placeholder.
    title: mod && mod.title !== automaticTitle(values) ? mod.title : '',
    partNumber: mod?.part_number ?? '',
    installedOn: monthText(mod?.installed_on),
    cost: costText(mod?.cost?.cents, locale),
    legalStatus: legalStatusOf(mod?.legal_status) ?? '',
    notes: mod?.notes ?? '',
    fields: values,
    product: mod?.product ? { id: mod.product.id, label: mod.product.full_name } : null,
  };
}

const BRAND_KEYS = ['brand', 'wheel_brand', 'tuner'];
const MODEL_KEYS = ['model', 'wheel_model'];

function firstText(values: Record<string, FieldValue>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** The server's automatic title: brand and model, or the title field of "Sonstiges". */
export function automaticTitle(values: Record<string, FieldValue>): string {
  return [firstText(values, BRAND_KEYS), firstText(values, MODEL_KEYS)].filter(Boolean).join(' ') || firstText(values, ['title']);
}

/** One stored value: a JSON number in the schema's unit, trimmed text, true, or nothing (ModFields refuses "19 cm"). */
function fieldValue(field: ModCategoryField, value: FieldValue | undefined, locale: FormatLocale): string | number | boolean | null {
  if (field.type === 'boolean') return value === true ? true : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (field.type === 'number') {
    const number = parseNumber(value, locale);
    return Number.isFinite(number) ? number : null;
  }
  return value.trim();
}

/**
 * The request of a save. On an edit, `fields` is replaced as a whole and the title only goes when it was touched: empty then
 * means "back to automatic" (`title: null`). A planned part has no installation month. The legal status goes only while
 * `sig.mod_legal_status` is on; none chosen is null, which the server stores as "Unbekannt".
 */
export function modPayload(
  values: ModFormValues,
  fields: readonly ModCategoryField[],
  locale: FormatLocale,
  options: { titleTouched: boolean; staggered: boolean; legalStatus?: boolean; product?: boolean },
): ModPayload {
  const stored: ModFieldValues = {};
  for (const field of fields) {
    if (field.key === 'diameter_rear' && !options.staggered) continue;
    const value = fieldValue(field, values.fields[field.key], locale);
    if (value !== null) stored[field.key] = value;
  }
  const cost = values.cost.trim() ? parseCost(values.cost, locale) : null;
  const payload: ModPayload = {
    status: values.status,
    part_number: values.partNumber.trim() || null,
    installed_on: values.status === 'planned' ? null : parseMonth(values.installedOn),
    cost_cents: cost === null || Number.isNaN(cost) ? null : cost,
    // DQ-1055: costs are never public (09 §7.6, §11). While the API still has the key, every save closes an old public cost.
    cost_public: false,
    notes: values.notes.trim() || null,
    fields: stored,
  };
  if (options.titleTouched) payload.title = values.title.trim() || null;
  // Only while the flag is on: the server ignores the key otherwise, and a form without the field must not send its default.
  if (options.legalStatus) payload.legal_status = values.legalStatus || null;
  // M4.14: only a changed link is sent, and only while parts_catalogue is on (the server ignores it otherwise); null unlinks it.
  if (options.product) payload.product_id = values.product?.id ?? null;
  return payload;
}

/** The label of a select value in the schema's language. */
function optionLabel(field: ModCategoryField, value: string): string {
  return field.options?.find((option) => option.value === value)?.label ?? value;
}

function numberPart(values: Record<string, FieldValue>, key: string, locale: FormatLocale): number | null {
  const value = values[key];
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = parseNumber(value, locale);
  return Number.isFinite(number) ? number : null;
}

function wheelSize(values: Record<string, FieldValue>, side: 'front' | 'rear', locale: FormatLocale): string {
  // A rear axle exists in the line only when one of its own values does; its diameter then falls back to the front's.
  if (side === 'rear' && ['diameter_rear', 'width_rear', 'et_rear'].every((key) => numberPart(values, key, locale) === null)) return '';
  const diameter = numberPart(values, side === 'rear' ? 'diameter_rear' : 'diameter', locale) ?? (side === 'rear' ? numberPart(values, 'diameter', locale) : null);
  const width = numberPart(values, `width_${side}`, locale);
  const offset = numberPart(values, `et_${side}`, locale);
  const size = [
    diameter === null ? null : `${formatNumber(diameter, locale, { maxFractionDigits: 1 })}″`,
    width === null ? null : `${formatNumber(width, locale, { maxFractionDigits: 1 })}J`,
  ]
    .filter(Boolean)
    .join(' × ');
  const et = offset === null ? null : `ET${formatNumber(roundInt(offset), locale)}`;
  return [size, et].filter(Boolean).join(' ');
}

/**
 * FS-6's live line: "BBS LM · 19″ × 9,5J ET35 · 255/35 R19". The rear axle joins with a slash when it differs. Other
 * categories show brand and model, then the first choices and figures with their units.
 */
export function previewLine(categoryKey: string, fields: readonly ModCategoryField[], values: Record<string, FieldValue>, locale: FormatLocale): string {
  const name = automaticTitle(values);
  if (categoryKey === WHEELS) {
    const front = wheelSize(values, 'front', locale);
    const rear = wheelSize(values, 'rear', locale);
    const wheels = rear && rear !== front ? `${front} / ${rear}` : front;
    const tyreFront = firstText(values, ['tyre_size_front']);
    const tyreRear = firstText(values, ['tyre_size_rear']);
    const tyres = tyreRear && tyreRear !== tyreFront ? `${tyreFront} / ${tyreRear}` : tyreFront;
    return [name, wheels, tyres].filter(Boolean).join(' · ');
  }
  const extras: string[] = [];
  for (const field of fields) {
    if (extras.length >= 3) break;
    if (BRAND_KEYS.includes(field.key) || MODEL_KEYS.includes(field.key) || field.key === 'title') continue;
    const value = values[field.key];
    if (field.type === 'select' && typeof value === 'string' && value) extras.push(optionLabel(field, value));
    if (field.type === 'number') {
      const number = numberPart(values, field.key, locale);
      const unit = unitOf(field);
      if (number !== null) extras.push(unit ? `${formatNumber(number, locale, { maxFractionDigits: 1 })} ${unit}` : formatNumber(number, locale));
    }
  }
  return [name, ...extras].filter(Boolean).join(' · ');
}
