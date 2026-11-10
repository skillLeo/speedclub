/**
 * DISC-02 filter model (02_PRODUCT_SPEC §3.7, m2.3 contract §1). The URL is the state: every filter, the sort and the view
 * live in the query string under the API's own names, so a result list can be shared on web, reloaded, and restored with
 * back. Lists travel as one comma-separated value ("drivetrain=awd,rwd"), which survives every router and copy-paste.
 *
 * Pure functions only: the screen reads `parseSearchParams(useLocalSearchParams())` and writes `paramsPatch(next)`.
 */
import type { components } from '@/api/schema';
import { now } from '@/lib/clock';

export const SORTS = ['relevance', 'newest', 'updated', 'power'] as const;
export type SearchSort = (typeof SORTS)[number];

export const VIEWS = ['list', 'grid'] as const;
export type ResultView = (typeof VIEWS)[number];

/** Many values each, in the order of the filter sheet. */
export const MULTI_KEYS = [
  'drivetrain',
  'gearbox',
  'fuel',
  'wheel_diameter',
  'wheel_brand',
  'suspension_type',
  'suspension_brand',
  'exhaust_brand',
  'mod_category',
] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];

/** One catalogue slug each; a model needs its make, a generation its model. */
export const SINGLE_KEYS = ['make', 'model', 'generation'] as const;
export type SingleKey = (typeof SINGLE_KEYS)[number];

export const RANGE_KEYS = ['year', 'power'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export type FilterRange = { readonly min: number | null; readonly max: number | null };

export type SearchFilters = { readonly [K in SingleKey]: string | null } & { readonly [K in RangeKey]: FilterRange } & {
  readonly [K in MultiKey]: readonly string[];
};

export type SearchState = {
  readonly q: string;
  readonly filters: SearchFilters;
  /** Null: the default, relevance with a text and newest without (contract §1). */
  readonly sort: SearchSort | null;
  /** Null: the device's default, the list on a phone and the 3-column grid beside the filter panel from 1280. */
  readonly view: ResultView | null;
};

/** §3.7: power slider 50–1500 PS, step 10. */
export const POWER_LIMITS = { min: 50, max: 1500, step: 10 } as const;
/** Model years the API accepts: 1900 to next year (m2.3 handover §2). */
export const YEAR_MIN = 1900;
/** Wheel diameters of the mod schema: 13–24 inch in half-inch steps (§3.3). */
export const WHEEL_LIMITS = { min: 13, max: 24, step: 0.5 } as const;
/** What the API accepts for `q`. */
const Q_MAX = 100;
/** A catalogue or brand slug as the server writes it. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A value of an enum facet (drivetrain, fuel, suspension type, mod category). */
const ENUM_VALUE = /^[a-z0-9_]+$/;

type Schemas = components['schemas'];
/** The API's enums (m2.3 handover §2). A value an old link carries that the API no longer knows is dropped, not sent into a 422. */
export const DRIVETRAINS = ['front', 'rear', 'all'] as const satisfies readonly Schemas['Drivetrain'][];
export const GEARBOXES = ['manual', 'automatic', 'dual_clutch', 'sequential', 'cvt', 'single_speed'] as const satisfies readonly Schemas['Gearbox'][];
export const FUELS = ['petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'cng', 'ethanol', 'other'] as const satisfies readonly Schemas['Fuel'][];
// A value the schema gains and these lists lack fails the type check here, so they stay the schema's lists.
type Missing = Exclude<Schemas['Drivetrain'], (typeof DRIVETRAINS)[number]> | Exclude<Schemas['Gearbox'], (typeof GEARBOXES)[number]> | Exclude<Schemas['Fuel'], (typeof FUELS)[number]>;
export const ENUMS_COMPLETE: [Missing] extends [never] ? true : never = true;
const ENUM_LISTS: Partial<Record<string, readonly string[]>> = { drivetrain: DRIVETRAINS, gearbox: GEARBOXES, fuel: FUELS };
/** No list in the sheet comes near this; it caps what a hand-edited URL can send. */
const MULTI_MAX = 30;

const EMPTY_RANGE: FilterRange = { min: null, max: null };

export const EMPTY_FILTERS: SearchFilters = {
  make: null,
  model: null,
  generation: null,
  year: EMPTY_RANGE,
  power: EMPTY_RANGE,
  drivetrain: [],
  gearbox: [],
  fuel: [],
  wheel_diameter: [],
  wheel_brand: [],
  suspension_type: [],
  suspension_brand: [],
  exhaust_brand: [],
  mod_category: [],
};

export const EMPTY_STATE: SearchState = { q: '', filters: EMPTY_FILTERS, sort: null, view: null };

type RawParams = Readonly<Record<string, string | readonly string[] | number | null | undefined>>;

function first(value: RawParams[string]): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return value.join(',');
}

/** Trimmed, inner runs of space as one, at most 100 characters (as `normalizeQuery`). */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, Q_MAX).trim();
}

/** The last model year a build can have: next year's models are on sale from autumn. */
export function currentYear(): number {
  return now().getFullYear() + 1;
}

function wheelValue(text: string): string | null {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < WHEEL_LIMITS.min || value > WHEEL_LIMITS.max) return null;
  if (Math.round(value / WHEEL_LIMITS.step) * WHEEL_LIMITS.step !== value) return null;
  return String(value);
}

function listOf(key: MultiKey, raw: RawParams[string]): string[] {
  const values = first(raw)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (key === 'wheel_diameter') return wheelValue(part);
      if (key === 'wheel_brand' || key === 'suspension_brand' || key === 'exhaust_brand') return SLUG.test(part) ? part : null;
      const known = ENUM_LISTS[key];
      if (known) return known.includes(part) ? part : null;
      return ENUM_VALUE.test(part) ? part : null;
    })
    .filter((part): part is string => part !== null);
  const unique = [...new Set(values)].slice(0, MULTI_MAX);
  return key === 'wheel_diameter' ? unique.sort((a, b) => Number(a) - Number(b)) : unique;
}

/** A list from the app's own form ("wheel_diameter=19,20") or the API's ("wheel_diameter[]=19&wheel_diameter[]=20"). */
function listParam(params: RawParams, key: MultiKey): RawParams[string] {
  const plain = first(params[key]);
  const bracketed = first(params[`${key}[]`]);
  return [plain, bracketed].filter(Boolean).join(',');
}

function slugOf(raw: RawParams[string]): string | null {
  const value = first(raw).trim().toLowerCase();
  return SLUG.test(value) ? value : null;
}

function integerOf(raw: RawParams[string], key: RangeKey): number | null {
  const text = first(raw).trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const value = Number(text);
  const [lower, upper] = key === 'power' ? [POWER_LIMITS.min, POWER_LIMITS.max] : [YEAR_MIN, currentYear()];
  return value >= lower && value <= upper ? value : null;
}

/**
 * Inside the limits, whole numbers, low never above high (they swap). Values stay exact: "ab 333 PS" from a link or the
 * interpreter is 333, and 50 is a filter like any other; only the slider snaps to its step (`sliderRange`).
 */
export function normalizeRange(range: FilterRange, key: RangeKey): FilterRange {
  const lower = key === 'power' ? POWER_LIMITS.min : YEAR_MIN;
  const upper = key === 'power' ? POWER_LIMITS.max : currentYear();
  const clean = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return null;
    return Math.min(upper, Math.max(lower, Math.round(value)));
  };
  let min = clean(range.min);
  let max = clean(range.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max };
}

/** What the slider set: thumbs on the step, and a thumb at its end is no limit on that side (the full span is no filter). */
export function sliderRange([low, high]: readonly [number, number]): FilterRange {
  const snap = (value: number) => Math.round(value / POWER_LIMITS.step) * POWER_LIMITS.step;
  const min = snap(low);
  const max = snap(high);
  return { min: min <= POWER_LIMITS.min ? null : min, max: max >= POWER_LIMITS.max ? null : max };
}

/** The state a URL (or any record of API-named values) describes. Unknown or malformed values are dropped, never guessed. */
export function parseSearchParams(params: RawParams): SearchState {
  const make = slugOf(params.make);
  const model = make ? slugOf(params.model) : null;
  const generation = model ? slugOf(params.generation) : null;
  const filters: SearchFilters = {
    make,
    model,
    generation,
    year: normalizeRange({ min: integerOf(params.year_min, 'year'), max: integerOf(params.year_max, 'year') }, 'year'),
    power: normalizeRange({ min: integerOf(params.power_min, 'power'), max: integerOf(params.power_max, 'power') }, 'power'),
    drivetrain: listOf('drivetrain', listParam(params, 'drivetrain')),
    gearbox: listOf('gearbox', listParam(params, 'gearbox')),
    fuel: listOf('fuel', listParam(params, 'fuel')),
    wheel_diameter: listOf('wheel_diameter', listParam(params, 'wheel_diameter')),
    wheel_brand: listOf('wheel_brand', listParam(params, 'wheel_brand')),
    suspension_type: listOf('suspension_type', listParam(params, 'suspension_type')),
    suspension_brand: listOf('suspension_brand', listParam(params, 'suspension_brand')),
    exhaust_brand: listOf('exhaust_brand', listParam(params, 'exhaust_brand')),
    mod_category: listOf('mod_category', listParam(params, 'mod_category')),
  };
  const sortText = first(params.sort);
  const sort = (SORTS as readonly string[]).includes(sortText) ? (sortText as SearchSort) : null;
  const viewText = first(params.view);
  const view: ResultView | null = viewText === 'grid' || viewText === 'list' ? viewText : null;
  return { q: normalizeText(first(params.q)), filters, sort, view };
}

/** Every key the state owns in the URL, each set or `undefined`, so `router.setParams` also clears what was removed. */
export function paramsPatch(state: SearchState): Record<string, string | undefined> {
  const { filters } = state;
  const patch: Record<string, string | undefined> = {
    q: state.q || undefined,
    make: filters.make ?? undefined,
    model: filters.model ?? undefined,
    generation: filters.generation ?? undefined,
    year_min: filters.year.min === null ? undefined : String(filters.year.min),
    year_max: filters.year.max === null ? undefined : String(filters.year.max),
    power_min: filters.power.min === null ? undefined : String(filters.power.min),
    power_max: filters.power.max === null ? undefined : String(filters.power.max),
    sort: state.sort ?? undefined,
    view: state.view ?? undefined,
  };
  for (const key of MULTI_KEYS) {
    patch[key] = filters[key].length > 0 ? filters[key].join(',') : undefined;
    // A link in the API's form is rewritten into the app's own.
    patch[`${key}[]`] = undefined;
  }
  return patch;
}

/** Only the keys that are set: a link's params, in a stable order. */
export function searchParamsOf(state: SearchState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(paramsPatch(state))) if (value !== undefined) out[key] = value;
  return out;
}

/** The sort the server applies: relevance with a text, newest without (contract §1). */
export function effectiveSort(state: Pick<SearchState, 'q' | 'sort'>): SearchSort {
  if (state.sort === 'relevance' && !state.q) return 'newest';
  return state.sort ?? (state.q ? 'relevance' : 'newest');
}

/** The sorts the sheet offers: relevance only makes sense with a text. */
export function availableSorts(q: string): readonly SearchSort[] {
  return q ? SORTS : SORTS.filter((sort) => sort !== 'relevance');
}

// ---------- chips ----------

export type ChipField = SingleKey | RangeKey | MultiKey;

/** One active filter as the chip row shows it ("BMW ×", "M4 ×", "19″ ×", "ab 500 PS ×"). */
export type FilterChip = { readonly field: ChipField; readonly value: string; readonly id: string };

/** The chips in the row's order: make, model, generation, year, power, then the lists in the sheet's order. */
export function activeChips(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const field of SINGLE_KEYS) {
    const value = filters[field];
    if (value) chips.push({ field, value, id: `${field}:${value}` });
  }
  for (const field of RANGE_KEYS) {
    const range = filters[field];
    if (range.min !== null || range.max !== null) {
      const value = `${range.min ?? ''}-${range.max ?? ''}`;
      chips.push({ field, value, id: `${field}:${value}` });
    }
  }
  for (const field of MULTI_KEYS) for (const value of filters[field]) chips.push({ field, value, id: `${field}:${value}` });
  return chips;
}

/** The number on the "Filter" chip and the desktop panel. */
export function activeFilterCount(filters: SearchFilters): number {
  return activeChips(filters).length;
}

export function hasFilters(filters: SearchFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Something to search for: a text, a filter, or an explicit sort ("Alle" from Home is `sort=updated` alone). */
export function hasCriteria(state: SearchState): boolean {
  return state.q !== '' || hasFilters(state.filters) || state.sort !== null;
}

/** Sets a make, model or generation; a new make clears model and generation, a new model the generation. */
export function setSingle(filters: SearchFilters, field: SingleKey, value: string | null): SearchFilters {
  if (filters[field] === value) return filters;
  if (field === 'make') return { ...filters, make: value, model: null, generation: null };
  if (field === 'model') return filters.make ? { ...filters, model: value, generation: null } : filters;
  return filters.model ? { ...filters, generation: value } : filters;
}

export function setRange(filters: SearchFilters, field: RangeKey, range: FilterRange): SearchFilters {
  return { ...filters, [field]: normalizeRange(range, field) };
}

/** Adds the value when it is missing, removes it when it is there. */
export function toggleValue(filters: SearchFilters, field: MultiKey, value: string): SearchFilters {
  const list = filters[field];
  const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  return { ...filters, [field]: field === 'wheel_diameter' ? [...next].sort((a, b) => Number(a) - Number(b)) : next };
}

/** The filters without this chip. Removing a make removes its model and generation with it. */
export function removeChip(filters: SearchFilters, chip: Pick<FilterChip, 'field' | 'value'>): SearchFilters {
  const { field } = chip;
  if (field === 'make' || field === 'model' || field === 'generation') return setSingle(filters, field, null);
  if (field === 'year' || field === 'power') return { ...filters, [field]: EMPTY_RANGE };
  return { ...filters, [field]: filters[field].filter((value) => value !== chip.value) };
}

/** "Zurücksetzen": every filter off; the text and the view stay, a sort needing nothing else stays too. */
export function resetFilters(state: SearchState): SearchState {
  return { ...state, filters: EMPTY_FILTERS };
}

export function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
  return activeChips(a)
    .map((chip) => chip.id)
    .join('|') === activeChips(b)
    .map((chip) => chip.id)
    .join('|');
}

// ---------- query understanding (contract §3) ----------

/**
 * Applies what `search/interpret` understood: its filters become visible chips next to those already set, and the search
 * goes on with the words it did not use. Nothing is applied that the chip row does not show.
 */
export function applyInterpretation(state: SearchState, understood: Readonly<Record<string, unknown>>, remainingQ: string): SearchState {
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(understood)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) raw[key] = value.map(String).join(',');
    else if (typeof value === 'string' || typeof value === 'number') raw[key] = String(value);
  }
  const parsed = parseSearchParams(raw).filters;
  let filters = state.filters;
  if (parsed.make) filters = setSingle(filters, 'make', parsed.make);
  if (parsed.model) filters = setSingle(filters, 'model', parsed.model);
  if (parsed.generation) filters = setSingle(filters, 'generation', parsed.generation);
  for (const key of RANGE_KEYS) {
    const range = parsed[key];
    if (range.min !== null || range.max !== null) filters = { ...filters, [key]: range };
  }
  for (const key of MULTI_KEYS) {
    for (const value of parsed[key]) if (!filters[key].includes(value)) filters = toggleValue(filters, key, value);
  }
  return { ...state, q: normalizeText(remainingQ), filters };
}

// ---------- facets as the sheet shows them ----------

/** One value of a facet as the filter sheet lists it: "BMW (12)". Counts are disjunctive (contract §2). */
export type FacetOption = { readonly value: string; readonly label: string; readonly count: number };

/** The facet groups the sheet lists, under the filter they set. */
export type FacetKey = SingleKey | MultiKey;

export type FilterOptions = Partial<Record<FacetKey, readonly FacetOption[]>>;

// ---------- refused filters ----------

const RANGE_FIELDS: Readonly<Record<string, RangeKey>> = { year_min: 'year', year_max: 'year', power_min: 'power', power_max: 'power' };

/**
 * The filters without the ones a 422 refused, and the chips that went: an old link may carry a brand that was merged away
 * or a category that no longer exists. Error keys are the API's: `wheel_brand`, `drivetrain.0`, `year_max`, `model`. A list
 * key without an index drops the whole list, since the server does not say which value it refused.
 */
export function dropRefused(filters: SearchFilters, errorKeys: readonly string[]): { filters: SearchFilters; dropped: FilterChip[] } {
  let next = filters;
  for (const raw of errorKeys) {
    const [name = '', index] = raw.replace('[]', '').split('.');
    if (name === 'make' || name === 'model' || name === 'generation') next = setSingle(next, name, null);
    else if (name in RANGE_FIELDS) next = { ...next, [RANGE_FIELDS[name] as RangeKey]: EMPTY_RANGE };
    else if ((MULTI_KEYS as readonly string[]).includes(name)) {
      const key = name as MultiKey;
      const position = index === undefined ? Number.NaN : Number(index);
      const value = Number.isInteger(position) ? filters[key][position] : undefined;
      next = { ...next, [key]: value === undefined ? [] : next[key].filter((entry) => entry !== value) };
    }
  }
  const kept = new Set(activeChips(next).map((chip) => chip.id));
  return { filters: next, dropped: activeChips(filters).filter((chip) => !kept.has(chip.id)) };
}
