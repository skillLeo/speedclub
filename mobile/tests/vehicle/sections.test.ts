import { buildProgressOf, builtGroupsOf, installedLocally, plansOf, reorderedLocally, restoredLocally, savedLocally, type PlanRow } from '@/api/queries/plans';
import { newestFirst } from '@/features/vehicle/screens/FullHistoryScreen';
import { pinnedTopFor } from '@/features/vehicle/components/Pinned';
import type { PublicVehicle } from '@/api/queries/vehicles';
import {
  activeSectionAt,
  keySpecsOf,
  pinnedShift,
  sectionScrollTarget,
  sectionsFor,
  type SpyGeometry,
} from '@/features/vehicle/sections';

import { R34 } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const GEOMETRY: SpyGeometry = { pinnedTop: 100, indexHeight: 53, gap: 16 };
// Überblick at 1000, Daten at 2000, Mods at 3000, Pläne (not laid out yet), Verlauf at 5000, Galerie at 6000.
const ANCHORS = [1000, 2000, 3000, Number.NaN, 5000, 6000];

describe('VEH-01 section index: scroll-to (10 §5.5)', () => {
  it('puts a section heading right under the pinned index, within the list', () => {
    expect(sectionScrollTarget(3000, GEOMETRY, 10_000)).toBe(3000 - 100 - 53 - 16);
    // Never past the end, never above the top.
    expect(sectionScrollTarget(9800, GEOMETRY, 9000)).toBe(9000);
    expect(sectionScrollTarget(50, GEOMETRY, 9000)).toBe(0);
  });
});

describe('VEH-01 scroll-spy', () => {
  const at = (scrollY: number, max = 10_000) => activeSectionAt(scrollY, ANCHORS, GEOMETRY, 800, max);

  it('marks the first section from scroll 0 (DQ-P5-038) and then the section whose heading reached the line under the index', () => {
    expect(at(0)).toBe(0);
    // Nothing laid out yet: nothing is current.
    expect(activeSectionAt(0, [Number.NaN, Number.NaN], GEOMETRY, 800, 10_000)).toBe(-1);
    // A jump lands on the section it aimed at.
    expect(at(sectionScrollTarget(2000, GEOMETRY, 10_000))).toBe(1);
    expect(at(sectionScrollTarget(3000, GEOMETRY, 10_000))).toBe(2);
    // Just before Mods' heading reaches the line, Daten is still the one in view.
    expect(at(3000 - 100 - 53 - 16 - 20)).toBe(1);
  });

  it('skips a section that is not laid out yet', () => {
    expect(at(4500)).toBe(2);
    expect(at(5000)).toBe(4);
  });

  it('at the end of the list marks the last section whose heading is on screen', () => {
    // Galerie (6000) can never reach the line when the list ends at 5600; at the end it is still the one the reader sees.
    expect(at(5600, 5600)).toBe(5);
    expect(at(5599, 5600)).toBe(4);
  });

  it('pins a block once its place reaches the pinned line', () => {
    expect(pinnedShift(0, 900, 100)).toBe(900);
    expect(pinnedShift(800, 900, 100)).toBe(100);
    expect(pinnedShift(2000, 900, 100)).toBe(100);
  });
});

describe('VEH-01 sections and their content', () => {
  const plan = (id: string, sort: number, extra: Partial<PlanRow> = {}): PlanRow => {
    const base = R34.mods.groups[1]!.items[0]!;
    return { ...base, id, title: `Plan ${id}`, status: 'planned', status_label: 'Geplant', installed_on: null, installed_label: null, plan_sort: sort, ...extra };
  };

  it('shows a visitor no Pläne without a plan and no Galerie without a photo; the owner always gets Pläne', () => {
    const bare: PublicVehicle = { ...R34, photos: [], photo_count: 0, mods: { ...R34.mods, groups: builtGroupsOf(R34) }, plans: { count: 0, items: [] } };
    expect(sectionsFor(bare, false)).toEqual(['overview', 'specs', 'mods', 'history']);
    expect(sectionsFor(bare, true)).toEqual(['overview', 'specs', 'mods', 'plans', 'history']);
    expect(sectionsFor(R34, false)).toEqual(['overview', 'specs', 'mods', 'plans', 'history', 'gallery']);
  });

  it('takes the page\'s plans in the owner\'s order, or the planned rows of the groups of a page cached before M5.3', () => {
    expect(plansOf(R34).map((mod) => mod.title)).toEqual(['Tomei Expreme Ti']);
    const { plans: _plans, ...cached } = R34;
    expect(plansOf(cached as PublicVehicle).map((mod) => mod.title)).toEqual(['Tomei Expreme Ti']);
    const withPlans = { ...R34, plans: { count: 2, items: [plan('b', 0), plan('a', 1)] } } as unknown as PublicVehicle;
    expect(plansOf(withPlans).map((mod) => mod.id)).toEqual(['b', 'a']);
  });

  it('counts Build-Fortschritt as built ÷ (built + planned), the server\'s numbers first, null without any mod', () => {
    expect(buildProgressOf({ ...R34, build_progress: { built: 4, planned: 3, total: 7, percent: 57 } })).toEqual({ built: 4, planned: 3, total: 7, percent: 57 });
    expect(buildProgressOf({ ...R34, build_progress: null })).toBeNull();
    // A page cached before M5.3 counts its rows: R34 has 12 installed, 1 planned, 1 removed (not part of the build).
    const { build_progress: _progress, ...cached } = R34;
    expect(buildProgressOf(cached as PublicVehicle)).toEqual({ built: 12, planned: 1, total: 13, percent: 92 });
    const { build_progress: _none, ...bare } = { ...R34, mods: { count: 0, groups: [] } };
    expect(buildProgressOf(bare as unknown as PublicVehicle)).toBeNull();
  });

  it('moves a plan to Mods dated this month, and reorders plans, ahead of the server', () => {
    const page = { ...R34, plans: { count: 2, items: [plan('b', 0), plan('a', 1)] }, build_progress: { built: 4, planned: 2, total: 6, percent: 66 } } as unknown as PublicVehicle;
    const tomei = plansOf(R34)[0]!;
    const built = installedLocally({ ...page, mods: R34.mods }, tomei.id, { month: '2026-11', monthLabel: 'November 2026', statusLabel: 'Verbaut' }) as PublicVehicle & { build_progress: unknown };
    const row = built.mods.groups.flatMap((group) => group.items).find((mod) => mod.id === tomei.id)!;
    // Review SF-3: labelled as built at once (pill and accessible name), not "Geplant".
    expect(row).toMatchObject({ status: 'installed', status_label: 'Verbaut', installed_on: '2026-11', installed_label: 'November 2026', plan_sort: null });
    expect(built.build_progress).toEqual({ built: 5, planned: 1, total: 6, percent: 83 });
    expect(plansOf(reorderedLocally(page, ['a', 'b'])).map((mod) => mod.id)).toEqual(['a', 'b']);
  });

  it('picks six key specs for Daten in the order that says most about a build', () => {
    expect(keySpecsOf(R34).map((row) => row.key)).toEqual(['engine_text', 'engine_code', 'displacement_cc', 'aspiration', 'gearbox', 'drivetrain']);
  });

  it('puts back only the failed plan and its counts, and takes the server\'s words for a saved one (review SF-3, N4)', () => {
    const tomei = plansOf(R34)[0]!;
    const moved = installedLocally(R34, tomei.id, { month: '2026-11', monthLabel: 'November 2026', statusLabel: 'Verbaut' });
    const back = restoredLocally(moved, tomei);
    expect(plansOf(back).map((mod) => mod.id)).toEqual([tomei.id]);
    expect(back.build_progress).toEqual(R34.build_progress);
    expect(back.mods.groups.flatMap((group) => group.items).find((mod) => mod.id === tomei.id)?.status).toBe('planned');
    // A page read anew meanwhile already shows the plan: nothing to undo twice.
    expect(restoredLocally(R34, tomei)).toBe(R34);
    const saved = savedLocally(moved, { id: tomei.id, status: 'installed', status_label: 'Verbaut', installed_on: '2026-10', installed_label: 'Oktober 2026' });
    expect(saved.mods.groups.flatMap((group) => group.items).find((mod) => mod.id === tomei.id)).toMatchObject({ installed_on: '2026-10', installed_label: 'Oktober 2026' });
  });
});

describe('VEH-08 order (review N1)', () => {
  it('sorts merged entries newest first, whatever page they came from', () => {
    const [a, b, c] = R34.updates;
    const older = { ...a!, id: 'older', created_at: '2020-01-01T10:00:00Z' };
    const newest = { ...b!, id: 'newest', created_at: '2030-01-01T10:00:00Z' };
    expect(newestFirst([older, c!, newest]).map((update) => update.id)).toEqual(['newest', c!.id, 'older']);
  });
});

describe('pinned desktop card taller than the window (DQ-M53R2-02)', () => {
  it('pins at its top while it fits, and by its bottom edge, 24 above the end, once it does not', () => {
    expect(pinnedTopFor(24, 600, 856, 24)).toBe(24);
    // 1000 tall in an 856 window: its bottom stays 24 above the end, so Speichern, Teilen and Nachricht are reachable.
    expect(pinnedTopFor(24, 1000, 856, 24)).toBe(856 - 1000 - 24);
    // Not measured yet: the plain pin.
    expect(pinnedTopFor(24, 0, 856, 24)).toBe(24);
    expect(pinnedTopFor(24, 1000, 0, 24)).toBe(24);
  });
});

