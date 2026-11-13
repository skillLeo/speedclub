/**
 * Pure helpers of the vehicle screens: what each block of FS-3 shows, derived from `PublicVehicleResource` the way the
 * Blade page WEB-01 derives it (web/resources/views/public/vehicle.blade.php), so both read the same.
 */
import type { BuildUpdate, PublicModRow, PublicVehicle, SpecGroup, VehicleOwner } from '@/api/queries/vehicles';
import { keepNameTogether, keepValuesTogether } from '@/lib/format';
import type { IconName, SpecStripItem } from '@/ui';

import { visiblePhotos } from './media';

export const PROFILE_TABS = ['overview', 'specs', 'mods', 'history'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(value: unknown): value is ProfileTab {
  return typeof value === 'string' && (PROFILE_TABS as readonly string[]).includes(value);
}

/** The glyphs a category may name (§6 map). Anything else, and a missing icon, is Phosphor `wrench` (Sonstiges). */
const CATEGORY_GLYPHS: ReadonlySet<string> = new Set([
  'wheel',
  'tyre',
  'coilover',
  'air-suspension',
  'exhaust',
  'turbo',
  'intake',
  'engine',
  'ecu-chip',
  'brake-disc',
  'wing',
  'seat',
  'light',
  'audio',
  'gearbox',
  'drivetrain',
  'wrench',
]);

export function categoryIcon(icon: string | null | undefined): IconName {
  return icon && CATEGORY_GLYPHS.has(icon) ? (icon as IconName) : 'wrench';
}

/** The glyph of a modification category by its key (database/data/mod_categories.json, stable seed keys). */
const CATEGORY_KEY_GLYPHS: Readonly<Record<string, IconName>> = {
  wheels_tires: 'wheel',
  suspension: 'coilover',
  exhaust: 'exhaust',
  engine_performance: 'turbo',
  brakes: 'brake-disc',
  aero_body: 'wing',
  interior: 'seat',
  electronics: 'light',
  drivetrain: 'gearbox',
  other: 'wrench',
};

/** DQ-1093: the glyph of an update's first change (its system), or null for a note, a post or an unknown category. */
export function updateGlyph(update: Pick<BuildUpdate, 'changes'>): IconName | null {
  const key = update.changes[0]?.category;
  return key ? (CATEGORY_KEY_GLYPHS[key] ?? null) : null;
}

const VALUE_SEPARATOR = ' · ';

/** The key values of a mod row: its summary line without the title in front ("18″ × 9,5J ET22 · 265/35 R18"). */
export function modValues(mod: Pick<PublicModRow, 'title' | 'summary_line'>): string | undefined {
  const summary = mod.summary_line.trim();
  if (summary === '' || summary === mod.title) return undefined;
  return summary.startsWith(`${mod.title}${VALUE_SEPARATOR}`) ? summary.slice(mod.title.length + VALUE_SEPARATOR.length) : summary;
}

/** "Lukas Scholz", or "@lukas.sc" without a display name. */
export function ownerName(owner: Pick<VehicleOwner, 'display_name' | 'username'>): string {
  return owner.display_name?.trim() || `@${owner.username ?? ''}`;
}

/** "@lukas.sc · Stuttgart" */
export function ownerMeta(owner: Pick<VehicleOwner, 'username' | 'city'>): string {
  return [`@${owner.username ?? ''}`, owner.city?.trim()].filter(Boolean).join(VALUE_SEPARATOR);
}

/** "2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue" */
export function sublineOf(vehicle: Pick<PublicVehicle, 'subline_parts'>): string {
  return vehicle.subline_parts.filter((part) => part.trim() !== '').join(VALUE_SEPARATOR);
}

/** A part longer than this may wrap at its spaces: a member's engine text holds up to 100 characters, wider than a phone's line. */
const SUBLINE_WHOLE_PART_CHARS = 32;
/**
 * Above this font scale a part may wrap at its spaces too: at 200 % "2,6 l R6 Biturbo (RB26DETT)" is wider than a phone's line, and a
 * part held whole would break inside the engine code instead (m4.10 VEH-01 "DET / T"). The skeleton (IdentityBars) uses the same.
 */
export const SUBLINE_WHOLE_FONT_SCALE = 1.2;

/**
 * The sub-line as the page sets it (§4 "never break key data", DQ-167): each part stays on one line ("Bayside Blue", never
 * "Bayside" / "Blue") and a line never starts with the separator. `wholeValues` false is for a font so large that a part no
 * longer fits one line.
 */
export function keptSubline(vehicle: Pick<PublicVehicle, 'subline_parts'>, wholeValues: boolean = true): string {
  return vehicle.subline_parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => keepValuesTogether(part, wholeValues && part.length <= SUBLINE_WHOLE_PART_CHARS))
    .join('\u00A0· ');
}

const NOT_ENTERED = '–';

/** The strip's columns whose data label is the spec's name rather than the API's label (which is their unit there). */
export const STRIP_NAMED_KEYS = ['power', 'torque'] as const;
export type StripNamedKey = (typeof STRIP_NAMED_KEYS)[number];

function isNamedKey(key: string): key is StripNamedKey {
  return (STRIP_NAMED_KEYS as readonly string[]).includes(key);
}

/**
 * Always four columns: a value not entered yet is "–", as on WEB-01. Already in the viewer's power setting. SpecStrip 2.0
 * (09 §5): power and torque take their names as data label ("Leistung", "Drehmoment") and their unit beside the numeral; the
 * provenance is the source of the same value in the spec tables ("Herstellerangabe"), as `x-public.spec-strip` derives it.
 */
export function specStripItems(
  vehicle: Pick<PublicVehicle, 'spec_strip' | 'spec_groups'>,
  names: Readonly<Record<StripNamedKey, string>>,
): SpecStripItem[] {
  const sources = new Map<string, string>();
  for (const group of vehicle.spec_groups) {
    for (const row of group.rows) if (row.source_label) sources.set(row.key, row.source_label);
  }
  return vehicle.spec_strip.map((item) => {
    const value = item.value ?? NOT_ENTERED;
    if (!isNamedKey(item.key)) return { value, label: item.label };
    return { value, unit: item.unit, label: names[item.key], provenance: item.value === null ? null : (sources.get(item.key) ?? null) };
  });
}

/** §8 spec row: the provenance shows under every value that is not the factory figure. */
export function provenanceOf(row: SpecGroup['rows'][number]): string | undefined {
  return row.source && row.source !== 'factory' ? (row.source_label ?? undefined) : undefined;
}

/** Spec groups with at least one row. */
export function specGroupsOf(vehicle: Pick<PublicVehicle, 'spec_groups'>): SpecGroup[] {
  return vehicle.spec_groups.filter((group) => group.rows.length > 0);
}

/**
 * DQ-1078: the Übersicht photo preview is one 3-up row. The photos after the first, which the hero already shows; a build with
 * fewer than four photos fills the row from the first one, so the row is never two tiles and a hole (WEB-01 does the same).
 */
export function previewPhotos(vehicle: Pick<PublicVehicle, 'photos'>) {
  const photos = visiblePhotos(vehicle.photos);
  return photos.length >= 4 ? photos.slice(1, 4) : photos.slice(0, 3);
}

export type MonthGroup = { label: string; updates: BuildUpdate[] };

/** Verlauf by month, newest first, in the order the API sends. Entries without a month label share the last group. */
export function groupByMonth(updates: readonly BuildUpdate[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const update of updates) {
    const label = update.month_label ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.updates.push(update);
    else groups.push({ label, updates: [update] });
  }
  return groups;
}

/** The page's latest entries followed by the pages loaded later, each entry once. */
export function mergeUpdates(base: readonly BuildUpdate[], loaded: readonly BuildUpdate[]): BuildUpdate[] {
  const seen = new Set<string>();
  const merged: BuildUpdate[] = [];
  for (const update of [...base, ...loaded]) {
    if (seen.has(update.id)) continue;
    seen.add(update.id);
    merged.push(update);
  }
  return merged;
}

export type ChangeLine = { key: string; label: string; diff?: string };

/** One change as Verlauf shows it: the label, then "before → after", or the API's sentence when there is no after. */
export function changeLine(change: BuildUpdate['changes'][number], fallbackLabel: string, index: number): ChangeLine {
  const label = change.label.trim() || fallbackLabel;
  // DQ-977 (a): each side keeps its short last word with the one before ("Legalis R →", never "Legalis / R →").
  const bind = (value: string) => value.replace(/ (\S{1,4})(?= · |$)/gu, '\u00A0$1');
  const diff = change.after ? (change.before ? `${bind(change.before)} → ${bind(change.after)}` : bind(change.after)) : change.text.trim() || undefined;
  return { key: `${change.modification_id ?? change.kind}-${index}`, label, ...(diff && diff !== label ? { diff } : {}) };
}

export type HistoryTitleKey = 'added' | 'replaced' | 'changed' | 'removed';

/**
 * DQ-977: a change's value split into the product and what describes it. "AP Racing Radi-CAL · 356 mm" → AP Racing Radi-CAL / 356
 * mm; "Volk Racing TE37 Saga 18″ × 9,5J ET22" → Volk Racing TE37 Saga / 18″ × 9,5J ET22 (a wheel's size starts at its inch figure);
 * "KW V3" → KW V3 / nothing.
 */
export function splitPartValue(value: string | null | undefined): { name: string | null; spec: string | null } {
  const [head = '', ...rest] = (value ?? '').split(' · ');
  const size = /^(.*?\S)\s+(\d{2}(?:[,.]\d)?″.*)$/u.exec(head.trim());
  const name = (size?.[1] ?? head).trim();
  const spec = [size?.[2]?.trim(), ...rest.map((part) => part.trim())].filter((part): part is string => Boolean(part)).join(' · ');
  return { name: name || null, spec: spec || null };
}

/** DQ-977 (a): a part name breaks only between words that can stand alone: "Legalis R", "Meister S1 3P" keep their short tail. */
export function partNameText(name: string): string {
  return keepNameTogether(name.replace(/ (\S{1,4})$/u, '\u00A0$1'));
}

function partName(value: string | null | undefined): string | null {
  return splitPartValue(value).name;
}

/**
 * DQ-955, DQ-977: an entry with one change is titled by the change itself ("AP Racing Radi-CAL statt Brembo Serie", "KW V3 verbaut",
 * "Fujitsubo Legalis R ausgebaut"), with the product names only: "statt" when a part replaced one, "verbaut" for a new part,
 * "geändert"/"ausgebaut" by the update's type. Anything else (several changes, specs, photos, a note) keeps the type's own label.
 */
export function historyTitle(update: BuildUpdate, title: (key: HistoryTitleKey, values: { name: string; before?: string }) => string): string {
  const change = update.changes[0];
  if (update.changes_count !== 1 || !change) return update.type_label;
  const afterName = partName(change.after);
  const beforeName = partName(change.before);
  const after = afterName ? partNameText(afterName) : null;
  const before = beforeName ? partNameText(beforeName) : null;
  if (update.type === 'mod_removed') return before ?? after ? title('removed', { name: (before ?? after) as string }) : update.type_label;
  if (!after) return update.type_label;
  if (update.type === 'mod_added') return before ? title('replaced', { name: after, before }) : title('added', { name: after });
  if (update.type === 'mod_changed') return beforeName && beforeName !== afterName ? title('replaced', { name: after, before: before as string }) : title('changed', { name: after });
  return update.type_label;
}

/** Whether `historyTitle` names the change itself, so the line under it must not repeat it (DQ-977). */
export function titleNamesChange(update: BuildUpdate): boolean {
  const change = update.changes[0];
  if (update.changes_count !== 1 || !change) return false;
  if (update.type === 'mod_removed') return Boolean(partName(change.before) ?? partName(change.after));
  return (update.type === 'mod_added' || update.type === 'mod_changed') && Boolean(partName(change.after));
}

/**
 * DQ-977: the line under a title that already names the change carries only what the title does not: the system and the key value
 * ("Bremsen · 356 mm", "Fahrwerk · −35 mm", "Räder · 18″ × 9,5J ET22"). A removal names nothing more than its system.
 */
export function historyMetaLine(update: BuildUpdate): ChangeLine | null {
  const change = update.changes[0];
  if (!change || !titleNamesChange(update)) return null;
  const label = change.label.trim() || update.type_label;
  const spec = update.type === 'mod_removed' ? null : splitPartValue(change.after).spec;
  return { key: `${change.modification_id ?? change.kind}-0`, label, ...(spec ? { diff: spec } : {}) };
}

/** The first `limit` changes of an entry and how many more it holds, including those a list leaves out. */
export function changeLines(update: BuildUpdate, limit: number): { lines: ChangeLine[]; more: number } {
  const lines = update.changes.slice(0, limit).map((change, index) => changeLine(change, update.type_label, index));
  return { lines, more: Math.max(0, update.changes_count - lines.length) };
}

/**
 * `qaState=empty` for the visual matrix: the same vehicle without photos, description, mods and history, which shows
 * every designed empty part of FS-3 at once. Never used for real data.
 */
export function withoutContent(vehicle: PublicVehicle): PublicVehicle {
  return {
    ...vehicle,
    cover: null,
    photos: [],
    photo_count: 0,
    description: null,
    highlights: [],
    mods: { count: 0, groups: [] },
    mod_count: 0,
    updates: [],
    updates_count: 0,
  };
}

/**
 * DQ-1059 (the Home `changeCaption()` rule on every update surface): the kind is printed once. The title is the Timeline's
 * (`historyTitle`), the system label goes into the meta only when the title names the change ("Bremsen · 03.09.2024"); otherwise the
 * title is the type's label and the meta starts with the date.
 */
export function updateHeadline(
  update: BuildUpdate,
  title: (key: HistoryTitleKey, values: { name: string; before?: string }) => string,
): { title: string; system: string | null; namesChange: boolean } {
  const namesChange = titleNamesChange(update);
  const system = namesChange ? (historyMetaLine(update)?.label ?? null) : null;
  return { title: historyTitle(update, title), system, namesChange };
}
