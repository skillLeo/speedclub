/**
 * VEH-06 [SIG `sig.compare`] (02_PRODUCT_SPEC §5): two builds side by side, the spec tables grouped as on Technik and the mods
 * per category, from `GET compare?a=&b=` (m2.7-api-handover §3). The server merges both builds' tables and says which rows
 * differ (case and spacing ignored); the app lays the answer out as one list with the pair of cars on top.
 */
import type { components } from '@/api/schema';
import { publicIdOf, type PublicModRow, type VehicleMedia } from '@/api/queries/vehicles';

export const COMPARE_FLAG = 'sig.compare';

export type CompareResource = components['schemas']['CompareResource'];

export type CompareSide = 'a' | 'b';

export type CompareVehicle = {
  slug: string;
  /** "Nissan Skyline GT-R R34" */
  title: string;
  /** "2002 · 2,6 l R6 Biturbo" */
  subline: string;
  cover: VehicleMedia | null;
};

export type CompareSpecRow = { key: string; label: string; a: string | null; b: string | null; differs: boolean };
export type CompareSpecGroup = { key: string; label: string; rows: CompareSpecRow[] };

export type CompareModRow = { id: string; title: string; summary: string; status: string };
export type CompareModCategory = { key: string; label: string; icon: string | null; a: CompareModRow[]; b: CompareModRow[] };

export type CompareData = { a: CompareVehicle; b: CompareVehicle; specs: CompareSpecGroup[]; mods: CompareModCategory[] };

function present(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function modRow(mod: PublicModRow): CompareModRow {
  return { id: mod.id, title: mod.title, summary: mod.summary_line, status: mod.status_label };
}

function vehicleOf(card: CompareResource['a']): CompareVehicle {
  return { slug: card.slug, title: card.full_title, subline: card.subline_parts.slice(0, 2).join(' · '), cover: card.cover };
}

/** The answer in the screen's shape. A row both sides leave empty never reaches the list. */
export function compareFromApi(resource: CompareResource): CompareData {
  return {
    a: vehicleOf(resource.a),
    b: vehicleOf(resource.b),
    specs: resource.specs
      .map((group) => ({
        key: group.key,
        label: group.label,
        rows: group.rows
          .map((row) => ({ key: row.key, label: row.label, a: present(row.a), b: present(row.b), differs: row.differs }))
          .filter((row) => row.a !== null || row.b !== null),
      }))
      .filter((group) => group.rows.length > 0),
    mods: resource.mods.map((category) => ({
      key: category.key,
      label: category.label,
      icon: category.icon,
      a: category.a.map(modRow),
      b: category.b.map(modRow),
    })),
  };
}

export type CompareSummary = { rows: number; differences: number };

export function compareSummary(data: Pick<CompareData, 'specs'>): CompareSummary {
  const rows = data.specs.flatMap((group) => group.rows);
  return { rows: rows.length, differences: rows.filter((row) => row.differs).length };
}

/** The flat list VEH-06 renders: the sticky pair of cars, then group headers, spec rows, mod categories. */
export type CompareItem =
  | { kind: 'header' }
  | { kind: 'section'; key: string; title: string }
  | { kind: 'group'; key: string; title: string }
  | { kind: 'spec'; key: string; row: CompareSpecRow; differs: boolean; last: boolean }
  | { kind: 'mods'; key: string; category: CompareModCategory }
  | { kind: 'noMods'; key: string };

export function compareItems(data: CompareData): CompareItem[] {
  const items: CompareItem[] = [{ kind: 'header' }];
  if (data.specs.length > 0) items.push({ kind: 'section', key: 'section.specs', title: 'specs' });
  for (const group of data.specs) {
    items.push({ kind: 'group', key: `group.${group.key}`, title: group.label });
    group.rows.forEach((row, index) =>
      items.push({ kind: 'spec', key: `spec.${group.key}.${row.key}`, row, differs: row.differs, last: index === group.rows.length - 1 }),
    );
  }
  items.push({ kind: 'section', key: 'section.mods', title: 'mods' });
  if (data.mods.length === 0) items.push({ kind: 'noMods', key: 'mods.none' });
  for (const category of data.mods) items.push({ kind: 'mods', key: `mods.${category.key}`, category });
  return items;
}

/** The second build may not be the first one. */
export function isSameBuild(a: string, b: string): boolean {
  return publicIdOf(a) !== '' && publicIdOf(a) === publicIdOf(b);
}
