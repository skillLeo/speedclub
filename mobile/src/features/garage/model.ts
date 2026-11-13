/**
 * Pure rules of the garage screens, kept apart from React so Jest can pin them: how GAR-01 splits the list, the reorder
 * moves (drag and keyboard), the wizard's steps, and the mapping between the forms and the API (02_PRODUCT_SPEC §3.2, §3.9).
 */
import type { GarageVehicle, SpecsRequest, VehicleAttributes, Visibility } from '@/api/queries/garage';
import type { VehicleCardData } from '@/api/queries/profile';
import type { components } from '@/api/schema';
import { formatNumber, parseNumber, roundInt, type FormatLocale } from '@/lib/format';
import { convertPower, type PowerUnit } from '@/lib/units';

export type Fuel = components['schemas']['Fuel'];
export type Aspiration = components['schemas']['Aspiration'];
export type Drivetrain = components['schemas']['Drivetrain'];
export type Gearbox = components['schemas']['Gearbox'];
export type PowerSource = components['schemas']['PowerSource'];

export const FUELS: readonly Fuel[] = ['petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'cng', 'ethanol', 'other'];
export const ASPIRATIONS: readonly Aspiration[] = ['naturally_aspirated', 'turbo', 'biturbo', 'supercharged', 'twincharged', 'none'];
export const DRIVETRAINS = ['front', 'rear', 'all'] as const satisfies readonly Drivetrain[];
export const GEARBOXES: readonly Gearbox[] = ['manual', 'automatic', 'dual_clutch', 'sequential', 'cvt', 'single_speed'];
export const POWER_UNITS = ['ps', 'kw', 'hp'] as const satisfies readonly PowerUnit[];
// DQ-1071: the order of the SpecStrip captions (ADR-431 c): Herstellerangabe · Prüfstand · Geschätzt.
export const SOURCES = ['factory', 'measured', 'claimed'] as const satisfies readonly PowerSource[];
export const VISIBILITIES = ['public', 'unlisted', 'private'] as const satisfies readonly Visibility[];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// -- GAR-01

/** FS-4: published vehicles in the server's order (main first), then the drafts. */
export function splitGarage(cards: readonly VehicleCardData[] | undefined): { vehicles: VehicleCardData[]; drafts: VehicleCardData[] } {
  const all = cards ?? [];
  return { vehicles: all.filter((card) => card.status !== 'draft'), drafts: all.filter((card) => card.status === 'draft') };
}

/** "Build zu 70 % vollständig" and its share for the 2-px bar. */
export function completenessBar(card: Pick<VehicleCardData, 'completeness'>): { label: string; value: number } | undefined {
  const completeness = card.completeness;
  if (!completeness) return undefined;
  return { label: completeness.line, value: Math.min(1, Math.max(0, completeness.percent / 100)) };
}

// -- Reorder (GAR-01, GAR-07, GAR-09)

/** A copy with the entry at `from` moved to `to`; indexes outside the list are clamped. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [entry] = next.splice(from, 1);
  if (entry !== undefined) next.splice(target, 0, entry);
  return next;
}

/** The keyboard move: one place up (−1) or down (+1). Null at the ends, where nothing moves. */
export function moveByKey<T>(list: readonly T[], keyOf: (item: T) => string, key: string, delta: number): { list: T[]; index: number } | null {
  const from = list.findIndex((item) => keyOf(item) === key);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return null;
  return { list: moveItem(list, from, to), index: to };
}

/**
 * The ids an order PUT sends: the member's order, reconciled with what the server lists now. The API wants every entry
 * exactly once, so one that arrived while sorting (an upload finishing) goes to the end, and one that is gone is left out.
 */
export function completeOrder(sorted: readonly string[], current: readonly string[]): string[] {
  const known = new Set(current);
  const kept = sorted.filter((id, index) => known.has(id) && sorted.indexOf(id) === index);
  const placed = new Set(kept);
  return [...kept, ...current.filter((id) => !placed.has(id))];
}

/** The keys an arrow moves by, in a list of `columns` per row. */
export function deltaForKey(key: string | undefined, columns: number): number | null {
  if (key === 'ArrowUp') return -columns;
  if (key === 'ArrowDown') return columns;
  if (columns > 1 && key === 'ArrowLeft') return -1;
  if (columns > 1 && key === 'ArrowRight') return 1;
  return null;
}

/** Equal cells of a sortable list (one column) or grid. */
export type SlotCell = { width: number; height: number; gap: number; columns: number };

/** Top-left corner of a slot. */
export function slotPosition(slot: number, cell: SlotCell): { x: number; y: number } {
  'worklet';
  const column = slot % cell.columns;
  const row = Math.floor(slot / cell.columns);
  return { x: column * (cell.width + cell.gap), y: row * (cell.height + cell.gap) };
}

/** The slot a dragged cell is over, from its top-left corner: the nearest slot by its centre. */
export function slotAt(x: number, y: number, cell: SlotCell, count: number): number {
  'worklet';
  const column = Math.max(0, Math.min(cell.columns - 1, Math.round(x / (cell.width + cell.gap))));
  const row = Math.max(0, Math.round(y / (cell.height + cell.gap)));
  return Math.max(0, Math.min(count - 1, row * cell.columns + column));
}

// -- Wizard (GAR-03)

export const WIZARD_STEPS = ['vehicle', 'specs', 'photos', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function isWizardStep(value: unknown): value is WizardStep {
  return isOneOf(WIZARD_STEPS, value);
}

/** 1-based, as the API's `wizard_step` and the caption "Schritt 2 von 4". */
export function stepNumber(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step) + 1;
}

export function stepAt(number: number): WizardStep {
  return WIZARD_STEPS[Math.max(0, Math.min(WIZARD_STEPS.length - 1, Math.round(number) - 1))] ?? 'vehicle';
}

export function nextStep(step: WizardStep): WizardStep | null {
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1] ?? null;
}

export function previousStep(step: WizardStep): WizardStep | null {
  const index = WIZARD_STEPS.indexOf(step);
  return index > 0 ? (WIZARD_STEPS[index - 1] ?? null) : null;
}

/** Where "Fortsetzen" opens a draft: the step it was saved at, never past the last one. */
export function resumeStep(card: Pick<VehicleCardData, 'wizard'>): WizardStep {
  return stepAt(card.wizard?.step ?? 1);
}

/** The step a later save may record: the wizard never moves the draft's mark backwards. */
export function laterStep(current: number | undefined, reached: WizardStep): number {
  return Math.max(current ?? 1, stepNumber(reached));
}

/** §3.2: drafts count too. The server decides; the wizard only says so early. */
export const VEHICLE_LIMIT = 20;

export type PublishRequirement = 'make' | 'model' | 'model_year' | 'photo';

/** §3.2: make, model, model year and at least one finished photo. The server decides; this is the review's checklist. */
export function missingForPublish(vehicle: Pick<GarageVehicle, 'make' | 'model' | 'model_year' | 'photos'>): PublishRequirement[] {
  const missing: PublishRequirement[] = [];
  // A draft may lack both: its make and model are null until they are chosen (and after a new make cleared the model).
  if (!vehicle.make?.trim()) missing.push('make');
  if (!vehicle.model?.trim()) missing.push('model');
  if (!vehicle.model_year) missing.push('model_year');
  if (!vehicle.photos.some((photo) => photo.status === 'ready')) missing.push('photo');
  return missing;
}

/** The step that fixes a missing item. */
export function stepFor(requirement: string): WizardStep {
  return requirement === 'photo' ? 'photos' : 'vehicle';
}

// -- Basics (GAR-03 step 1, GAR-05)

/** A catalogue entry, or free text after "Nicht gefunden?" (id null). */
export type CatalogChoice = { id: number | null; name: string };

export type BasicsValues = {
  make: CatalogChoice | null;
  model: CatalogChoice | null;
  generation: CatalogChoice | null;
  year: string;
  nickname: string;
  color: string;
  description: string;
};

function choice(id: number | null, text: string | null, name: string | null): CatalogChoice | null {
  if (id !== null && name) return { id, name };
  const free = (text ?? '').trim();
  return free ? { id: null, name: free } : null;
}

export function basicsValues(vehicle: GarageVehicle | undefined): BasicsValues {
  if (!vehicle) return { make: null, model: null, generation: null, year: '', nickname: '', color: '', description: '' };
  return {
    make: choice(vehicle.make_id, vehicle.make_text, vehicle.make),
    model: choice(vehicle.model_id, vehicle.model_text, vehicle.model),
    generation: vehicle.generation_id !== null && vehicle.generation ? { id: vehicle.generation_id, name: vehicle.generation } : null,
    year: vehicle.model_year === null ? '' : String(vehicle.model_year),
    nickname: vehicle.nickname ?? '',
    color: vehicle.color ?? '',
    description: vehicle.description ?? '',
  };
}

type BasicsKey = keyof BasicsValues;

/**
 * Only what changed: a catalogue id or its free text per level (never both, the API refuses that), null to clear. A new make
 * sends its model in the same PATCH, because the server clears the model with the make (handover, GAR-05).
 */
export function basicsPatch(values: BasicsValues, dirty: Partial<Record<BasicsKey, unknown>> | 'all'): VehicleAttributes {
  const changed = (key: BasicsKey) => dirty === 'all' || Boolean(dirty[key]);
  const patch: VehicleAttributes = {};
  if (changed('make')) {
    patch.make_id = values.make?.id ?? null;
    patch.make_text = values.make && values.make.id === null ? values.make.name : null;
  }
  if (changed('make') || changed('model')) {
    patch.model_id = values.model?.id ?? null;
    patch.model_text = values.model && values.model.id === null ? values.model.name : null;
  }
  if (changed('make') || changed('model') || changed('generation')) patch.generation_id = values.generation?.id ?? null;
  if (changed('year')) {
    const year = Number.parseInt(values.year, 10);
    patch.model_year = Number.isFinite(year) ? year : null;
  }
  if (changed('nickname')) patch.nickname = values.nickname.trim() || null;
  if (changed('color')) patch.color = values.color.trim() || null;
  if (changed('description')) patch.description = values.description.trim() || null;
  // The id of a level and its free text are exclusive: send only the one that holds the value.
  for (const [idKey, textKey] of [['make_id', 'make_text'], ['model_id', 'model_text']] as const) {
    if (patch[idKey] !== undefined && patch[idKey] !== null) delete patch[textKey];
    else if (patch[textKey] !== undefined && patch[textKey] !== null) delete patch[idKey];
  }
  return patch;
}

/** Keys that change together: the catalogue levels with their free texts, then one key each. */
const BASICS_GROUPS: readonly (readonly (keyof VehicleAttributes)[])[] = [
  ['make_id', 'make_text', 'model_id', 'model_text', 'generation_id'],
  ['model_year'],
  ['nickname'],
  ['color'],
  ['description'],
];

/**
 * What to PATCH onto a draft that holds `stored`, the body a lost attempt sent and its replay created (BH-03/BH-12): every
 * value the form shows differently, a field emptied since then included. The form's own dirty state is measured against the
 * values it opened with, which for a new draft are empty, so it cannot tell that the replay brought back a value the member
 * has removed since. A catalogue level goes with its neighbours, because an id and its free text exclude each other.
 */
export function basicsPatchOver(values: BasicsValues, stored: VehicleAttributes): VehicleAttributes {
  const full = basicsPatch(values, 'all');
  const patch: VehicleAttributes = {};
  for (const group of BASICS_GROUPS) {
    if (!group.some((key) => (full[key] ?? null) !== (stored[key] ?? null))) continue;
    for (const key of group) if (key in full) Object.assign(patch, { [key]: full[key] });
  }
  return patch;
}

// -- Specs (GAR-03 step 2, GAR-06)

export type SpecsValues = {
  engineCode: string;
  engineText: string;
  displacement: string;
  fuel: Fuel | '';
  aspiration: Aspiration | '';
  powerValue: string;
  powerUnit: PowerUnit;
  powerSource: PowerSource | '';
  torque: string;
  torqueSource: PowerSource | '';
  drivetrain: Drivetrain | '';
  gearbox: Gearbox | '';
};

/** What the field shows for a stored power: '368,5', '73,55', '1.500'. Two decimals as the column, decimal(7,2); parseNumber reads it back. */
function numberText(value: number | null | undefined, locale: FormatLocale): string {
  return value === null || value === undefined ? '' : formatNumber(value, locale, { maxFractionDigits: 2 });
}

export function specsValues(specs: GarageVehicle['specs'] | undefined, locale: FormatLocale): SpecsValues {
  return {
    engineCode: specs?.engine_code ?? '',
    engineText: specs?.engine_text ?? '',
    displacement: specs?.displacement_cc ? String(specs.displacement_cc) : '',
    fuel: isOneOf(FUELS, specs?.fuel) ? specs.fuel : '',
    aspiration: isOneOf(ASPIRATIONS, specs?.aspiration) ? specs.aspiration : '',
    powerValue: numberText(specs?.power_value, locale),
    powerUnit: isOneOf(POWER_UNITS, specs?.power_unit) ? specs.power_unit : 'ps',
    powerSource: isOneOf(SOURCES, specs?.power_source) ? specs.power_source : '',
    torque: specs?.torque_nm ? String(specs.torque_nm) : '',
    torqueSource: isOneOf(SOURCES, specs?.torque_source) ? specs.torque_source : '',
    drivetrain: isOneOf(DRIVETRAINS, specs?.drivetrain) ? specs.drivetrain : '',
    gearbox: isOneOf(GEARBOXES, specs?.gearbox) ? specs.gearbox : '',
  };
}

function numberOrNull(text: string, locale: FormatLocale): number | null {
  const value = parseNumber(text, locale);
  return Number.isFinite(value) ? value : null;
}

/** The whole set for PUT specs: what is empty is sent as null and cleared. A power without a value sends no unit. */
export function specsRequest(values: SpecsValues, locale: FormatLocale): SpecsRequest {
  const power = numberOrNull(values.powerValue, locale);
  const torque = numberOrNull(values.torque, locale);
  const displacement = numberOrNull(values.displacement, locale);
  return {
    engine_code: values.engineCode.trim() || null,
    engine_text: values.engineText.trim() || null,
    displacement_cc: displacement === null ? null : roundInt(displacement),
    fuel: values.fuel || null,
    aspiration: values.aspiration || null,
    power_value: power,
    power_unit: power === null ? null : values.powerUnit,
    power_source: power === null ? null : values.powerSource || null,
    torque_nm: torque === null ? null : roundInt(torque),
    torque_source: torque === null ? null : values.torqueSource || null,
    drivetrain: values.drivetrain || null,
    gearbox: values.gearbox || null,
  };
}

/** FS-5's live helper: the entered power in the other unit, "≈ 368 kW". Hp shows PS, as the default display does. */
/** Keeps a unit on the line of its number (§3.9). */
const NBSP = '\u00A0';

export function powerCounterpart(text: string, unit: PowerUnit, locale: FormatLocale): string | null {
  const value = parseNumber(text, locale);
  if (!Number.isFinite(value) || value <= 0) return null;
  const other: PowerUnit = unit === 'ps' ? 'kw' : 'ps';
  const label = other === 'kw' ? 'kW' : 'PS';
  return `≈ ${formatNumber(roundInt(convertPower(value, unit, other)), locale)}${NBSP}${label}`;
}

// -- Visibility (GAR-12)

export function isVisibility(value: unknown): value is Visibility {
  return isOneOf(VISIBILITIES, value);
}
