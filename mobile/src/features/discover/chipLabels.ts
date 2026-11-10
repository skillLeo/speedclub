/**
 * The words on the active-filter chips (FS-11: "BMW ×" "M4 ×" "19″ ×"). Catalogue names come from the facets or the query
 * interpreter, which both answer `{value, label}`; until one of them has answered, a shared link shows the slug's words.
 */
import type { ChipField, FilterChip, MultiKey, SingleKey } from './filters';

export type LabelField = SingleKey | MultiKey;

/** Names learned this session, so a chip keeps its catalogue name while the next facets load. */
const learned = new Map<string, string>();

const keyOf = (field: LabelField, value: string) => `${field}:${value}`;

export function rememberLabel(field: string, value: string | number, label: string) {
  if (label.trim()) learned.set(`${field}:${String(value)}`, label);
}

export function knownLabel(field: LabelField, value: string): string | undefined {
  return learned.get(keyOf(field, value));
}

export function forgetLabelsForTests() {
  learned.clear();
}

/** "m-performance" → "M Performance": the slug's own words until the name is known, never an empty chip. */
export function slugWords(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 && /\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

type Translate = (key: string, options?: Record<string, unknown>) => string;
type FormatNumber = (value: number, options?: { maxFractionDigits?: number }) => string;

function rangeParts(value: string): [number | null, number | null] {
  const [low = '', high = ''] = value.split('-');
  return [low === '' ? null : Number(low), high === '' ? null : Number(high)];
}

/** Years read as years: never "2.018". */
const yearText = (year: number) => String(year);

/** A name the current facets give for a value, before anything learned earlier. */
export type LabelLookup = (field: LabelField, value: string) => string | undefined;

/** The chip's text in the viewer's language and number format. */
export function chipLabel(chip: Pick<FilterChip, 'field' | 'value'>, t: Translate, formatNumber: FormatNumber, lookup?: LabelLookup): string {
  const field: ChipField = chip.field;
  if (field === 'power' || field === 'year') {
    const [min, max] = rangeParts(chip.value);
    const show = field === 'power' ? (value: number) => formatNumber(value) : yearText;
    if (min !== null && max !== null) {
      if (min === max) return t(`chips.${field}Exact`, { value: show(min) });
      return t(`chips.${field}Between`, { min: show(min), max: show(max) });
    }
    if (min !== null) return t(`chips.${field}From`, { value: show(min) });
    return t(`chips.${field}To`, { value: show(max ?? 0) });
  }
  if (field === 'wheel_diameter') return t('chips.wheelDiameter', { value: formatNumber(Number(chip.value), { maxFractionDigits: 1 }) });
  return lookup?.(field, chip.value) ?? knownLabel(field, chip.value) ?? slugWords(chip.value);
}

/** What a screen reader hears for the × of a chip: "BMW entfernen". */
export function chipRemoveLabel(label: string, t: Translate): string {
  return t('chips.remove', { label });
}
