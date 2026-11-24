/**
 * VEH-01 one scroll (docs/10_CLIENT_ROUND_1.md §5, ADR-505): the sections of the page, the section index's targets and the pure
 * arithmetic of its scroll-to and scroll-spy, so both are tested without a list.
 */
import type { PublicVehicle } from '@/api/queries/vehicles';

import { plansOf } from '@/api/queries/plans';
import { visiblePhotos } from './media';

/** The sections in page order (10 §5: Überblick · Daten · Mods · Pläne · Verlauf · Galerie). */
export const PROFILE_SECTIONS = ['overview', 'specs', 'mods', 'plans', 'history', 'gallery'] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** A deep-link target: a section, or "Ähnliche Builds" near the end (`?section=similar`). */
export type ProfileAnchor = ProfileSection | 'similar';

export function isProfileAnchor(value: unknown): value is ProfileAnchor {
  return value === 'similar' || (typeof value === 'string' && (PROFILE_SECTIONS as readonly string[]).includes(value));
}

/**
 * The anchor a URL names: `?section=`, or the tab of a link from before 2.1 (`?tab=specs|mods|history`, ADR-505), which now
 * scrolls to that section.
 */
export function anchorFromParams(section: string | undefined, tab: string | undefined): ProfileAnchor | undefined {
  if (isProfileAnchor(section)) return section;
  return isProfileAnchor(tab) && tab !== 'similar' ? tab : undefined;
}

/**
 * The sections this reader gets. Galerie only with a photo (without one the hero is the empty stage, and the owner's "Fotos
 * hinzufügen" is on it); Pläne for a visitor only with a plan, for the owner always (empty, it invites the first plan). Überblick,
 * Daten, Mods and Verlauf always show.
 */
export function sectionsFor(vehicle: PublicVehicle, owner: boolean): ProfileSection[] {
  return PROFILE_SECTIONS.filter((section) => {
    if (section === 'gallery') return visiblePhotos(vehicle.photos).length > 0;
    if (section === 'plans') return owner || plansOf(vehicle).length > 0;
    return true;
  });
}

/** Where the content starts under the pinned index: the bar it sticks under, the index itself and the gap to the heading. */
export type SpyGeometry = {
  /** The index's top edge while it is pinned (the floating bar on a phone, 0 under a bar, 24 for the desktop's side list). */
  pinnedTop: number;
  /** The pinned chip row's height; 0 for the desktop's side list, which covers no content. */
  indexHeight: number;
  /** Air between the pinned index and a section's heading after a jump. */
  gap: number;
};

/** The scroll offset that puts a section's heading right under the pinned index, within the list's range. */
export function sectionScrollTarget(anchor: number, geometry: SpyGeometry, maxScroll: number): number {
  'worklet';
  const target = anchor - geometry.pinnedTop - geometry.indexHeight - geometry.gap;
  return Math.max(0, Math.min(Math.max(0, maxScroll), target));
}

/**
 * Scroll-spy: the index of the section in view. A section is current once its heading has reached the line under the pinned index
 * (the gap and half of it again as slack, so a jump lands on it). Above the first heading the first section is current (DQ-P5-038: at
 * scroll 0 "Überblick" is what the reader is in, and the desktop index shows it from the start); -1 only while no section is laid out.
 * At the end of the list, where the last sections can never reach that line, the last section whose heading is on screen is current.
 *
 * `anchors` are the sections' top offsets in page order (NaN for one not laid out yet, which is skipped).
 */
export function activeSectionAt(scrollY: number, anchors: readonly number[], geometry: SpyGeometry, viewport: number, maxScroll: number): number {
  'worklet';
  const line = scrollY + geometry.pinnedTop + geometry.indexHeight + geometry.gap * 1.5;
  let active = -1;
  let first = -1;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] ?? Number.NaN;
    if (!Number.isFinite(anchor)) continue;
    if (first < 0) first = index;
    if (anchor <= line) active = index;
  }
  if (active < 0) active = first;
  if (maxScroll > 0 && scrollY >= maxScroll - 0.5) {
    const bottom = scrollY + viewport;
    for (let index = anchors.length - 1; index > active; index -= 1) {
      const anchor = anchors[index] ?? Number.NaN;
      if (Number.isFinite(anchor) && anchor < bottom) return index;
    }
  }
  return active;
}

/** How far the pinned block sits below its place in the page: none until it reaches `pinnedTop`, then it follows the scroll. */
export function pinnedShift(scrollY: number, anchor: number, pinnedTop: number): number {
  'worklet';
  return Math.max(pinnedTop, anchor - scrollY);
}

/**
 * Daten's six key specs (10 §5.7): the rows that say most about a build, in this order, the first six the vehicle has. Make, model
 * and year are in the identity, power and torque in the strip above; the grid names what the strip cannot.
 */
export const KEY_SPEC_ORDER = [
  'engine_text',
  'engine_code',
  'displacement_cc',
  'aspiration',
  'gearbox',
  'drivetrain',
  'weight_kg',
  'acceleration',
  'fuel',
  'power',
  'torque',
  'generation',
  'color',
  'model_year',
] as const;

export const KEY_SPEC_COUNT = 6;

export type KeySpec = PublicVehicle['spec_groups'][number]['rows'][number];

export function keySpecsOf(vehicle: Pick<PublicVehicle, 'spec_groups'>): KeySpec[] {
  const rows = new Map<string, KeySpec>();
  for (const group of vehicle.spec_groups) for (const row of group.rows) rows.set(row.key, row);
  const picked: KeySpec[] = [];
  for (const key of KEY_SPEC_ORDER) {
    const row = rows.get(key);
    if (row && picked.length < KEY_SPEC_COUNT) picked.push(row);
  }
  // A build with few ordered keys fills the grid with any other rows it has, in the API's order.
  if (picked.length < KEY_SPEC_COUNT) {
    for (const row of rows.values()) {
      if (picked.length >= KEY_SPEC_COUNT) break;
      if (!picked.includes(row) && row.key !== 'make' && row.key !== 'model') picked.push(row);
    }
  }
  return picked;
}

/** Mods (10 §5.8): each system shows its first three; "+ N weitere" opens the rest in place. */
export const MODS_SHOWN_PER_GROUP = 3;
/** Verlauf (10 §5.10): the latest three entries; the rest on VEH-08. */
export const HISTORY_SHOWN = 3;
