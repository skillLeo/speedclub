/**
 * Pure helpers of the vehicle screens: what each block of FS-3 shows, derived from `PublicVehicleResource` the way the
 * Blade page WEB-01 derives it (web/resources/views/public/vehicle.blade.php), so both read the same.
 */
import type { BuildUpdate, PublicModRow, PublicVehicle, SpecGroup, VehicleOwner } from '@/api/queries/vehicles';
import { keepValuesTogether } from '@/lib/format';
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

/** Always four columns: a value not entered yet is "–", as on WEB-01. Already in the viewer's power setting. */
export function specStripItems(vehicle: Pick<PublicVehicle, 'spec_strip'>): SpecStripItem[] {
  return vehicle.spec_strip.map((item) => ({ value: item.value ?? NOT_ENTERED, label: item.label }));
}

/** §8 spec row: the provenance shows under every value that is not the factory figure. */
export function provenanceOf(row: SpecGroup['rows'][number]): string | undefined {
  return row.source && row.source !== 'factory' ? (row.source_label ?? undefined) : undefined;
}

/** Spec groups with at least one row. */
export function specGroupsOf(vehicle: Pick<PublicVehicle, 'spec_groups'>): SpecGroup[] {
  return vehicle.spec_groups.filter((group) => group.rows.length > 0);
}

/** FS-3 "photo preview 2×2": the photos after the first, which the hero already shows (WEB-01 does the same). */
export function previewPhotos(vehicle: Pick<PublicVehicle, 'photos'>) {
  return visiblePhotos(vehicle.photos).slice(1, 5);
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
  const diff = change.after ? (change.before ? `${change.before} → ${change.after}` : change.after) : change.text.trim() || undefined;
  return { key: `${change.modification_id ?? change.kind}-${index}`, label, ...(diff && diff !== label ? { diff } : {}) };
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
