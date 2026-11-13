/**
 * Design QA M4.9 (docs/reports/design-qa/phase-4/2026-11-13-M4.9.md), the pure rules behind the fixes: the hero box and the
 * identity's overlap (DQ-1047/1048), the kind printed once (DQ-1059), distinct similar builds (DQ-1063) and the owner capsule's fit
 * (DQ-1049).
 */
import type { FeedVehicle } from '@/api/queries/home';
import { distinctSimilar, SIMILAR_SAMPLE_MAX } from '@/features/vehicle/components/SimilarBuilds';
import { HERO_TEXT_SAFE, heroBox, heroIdentityOverlap, heroIdentityWidth, summaryTitlePlacement } from '@/features/vehicle/layout';
import { updateHeadline } from '@/features/vehicle/model';
import { layout, scrimSafe, size, space } from '@/theme';
import { ownerCapsuleOf } from '@/features/garage/components/OwnerToolbar';
import { OWNER_CAPSULE_MAX_ACTIONS, ownerCapsuleFit, splitByPriority } from '@/ui/OwnerCapsule';

import { R34 } from './fixtures';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));

describe('DQ-1047/1048: the hero and its identity', () => {
  it('is 4:5 edge to edge on a phone and 16:9 across the content from 768, at most fullBleedMax wide', () => {
    expect(heroBox('phone', 393)).toEqual({ width: 393, ratio: 4 / 5 });
    expect(heroBox('tablet', 748)).toEqual({ width: 748, ratio: 16 / 9 });
    expect(heroBox('desktop', 1600)).toEqual({ width: layout.fullBleedMax, ratio: 16 / 9 });
  });

  it('starts the identity at the strictest text-safe line of the three themes (ADR-421 b)', () => {
    expect(HERO_TEXT_SAFE).toBe(Math.max(scrimSafe.carbon.text, scrimSafe.black.text, scrimSafe.light.text));
    // WEB-01 uses the same numbers in public.css: −22 % of the width at 4:5, −9.9 % at 16:9.
    expect(heroIdentityOverlap(390, 4 / 5) / 390).toBeCloseTo(0.22, 3);
    expect(heroIdentityOverlap(1200, 16 / 9) / 1200).toBeCloseTo(0.099, 3);
    expect(heroIdentityWidth('phone', 393, 20)).toBe(353);
  });

  it('sets the title by the page rule at every width', () => {
    expect(summaryTitlePlacement('phone')).toBe('page');
    expect(summaryTitlePlacement('desktop')).toBe('page');
  });
});

describe('DQ-1059: the kind once', () => {
  const t = (key: string, values: { name: string; before?: string }) => (key === 'replaced' ? `${values.name} statt ${values.before}` : `${values.name} ${key}`);

  it('titles a single mod change by the change and puts its system in the meta', () => {
    const update = R34.updates[1]!;
    const head = updateHeadline(update, t);
    expect(head.namesChange).toBe(true);
    expect(head.system).toBe(update.changes[0]!.label);
    expect(head.title).not.toBe(update.type_label);
  });

  it('keeps the type label as the title, with no system, for an entry that does not name one change', () => {
    const note = { ...R34.updates[1]!, changes: [], changes_count: 0 };
    expect(updateHeadline(note, t)).toEqual({ title: note.type_label, system: null, namesChange: false });
  });
});

describe('DQ-1063: distinct similar builds', () => {
  const base = { is_sample: false, full_title: 'Nissan Skyline GT-R R34', spec_strip: [{ key: 'power', value: '280', unit: 'PS', label: 'PS' }] };
  const make = (id: string, extra: Partial<FeedVehicle>) => ({ ...base, id, ...extra }) as unknown as FeedVehicle;

  it('keeps every real build, drops samples that look like a card already kept, and caps the samples', () => {
    const real = make('real', {});
    const same = make('s1', { is_sample: true });
    const other = (n: number) => make(`s${n}`, { is_sample: true, full_title: `Toyota Supra ${n}` });
    const result = distinctSimilar([same, real, other(2), other(3), other(4)]);
    expect(result.map((vehicle) => vehicle.id)).toEqual(['real', 's2', 's3']);
    expect(result.filter((vehicle) => vehicle.is_sample)).toHaveLength(SIMILAR_SAMPLE_MAX);
  });
});

describe('DQ-1049: the owner capsule never wraps its primary', () => {
  it('drops glyphs before the primary wraps', () => {
    const slot = size.touchMin + space[2];
    // 393 − 40 gutters, "Update posten" about 120 wide: three glyphs and "Mehr".
    expect(ownerCapsuleFit(353, 120, true)).toBe(3);
    // A primary at 200 % (about 200 wide) leaves room for one.
    expect(ownerCapsuleFit(353, 200, true)).toBe(Math.floor((353 - 16 - 200 - slot) / slot));
    expect(ownerCapsuleFit(0, 120, true)).toBe(OWNER_CAPSULE_MAX_ACTIONS);
  });
});

describe('GAR-02 capsule (DQ-1062, f2 at 1280)', () => {
  it('keeps "Bearbeiten" where only one glyph fits, as the desktop side card does', () => {
    const t = ((key: string) => key) as never;
    const { actions, more } = ownerCapsuleOf(R34, 'GAR-02', { t, go: jest.fn(), onEdit: jest.fn(), onShare: jest.fn() });
    expect(splitByPriority(actions, 1).visible.map((action) => action.testID)).toEqual(['GAR-02.tool.edit']);
    // At 390 three fit: the QR code, Bearbeiten and Mods (f3 taps Mods), in the toolbar's order.
    expect(splitByPriority(actions, 3).visible.map((action) => action.key)).toEqual(R34.qr ? ['qr', 'edit', 'mods'] : ['edit', 'mods', 'photos']);
    expect(more.map((item) => item.key)).toContain('visibility');
  });
});
