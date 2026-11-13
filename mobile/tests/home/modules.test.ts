import { memberItemWidth } from '@/features/home/components/ActiveMembersStrip';
import { chipsThatFit } from '@/features/home/components/PopularModsChips';
import { memberMetaText } from '@/ui/MemberRow';
import { handleText } from '@/ui/textBreaks';
import { forYouRows, MODULE_EVERY, streamRows, weeklyBuild, type HomeRow } from '@/features/home/screens/HomeScreen';
import type { FeedVehicle } from '@/api/queries/home';

import { activeMember, buildUpdate, feedVehicle, GTI, M4, MODS, R34, updateItem, vehicleItem } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('09 §7.3 rows of Für dich', () => {
  const base = { hero: undefined, newBuilds: [], members: [], mods: [], stream: [] };
  const many = (count: number) => Array.from({ length: count }, (_, index) => vehicleItem(feedVehicle({ id: `01stream${index}`, slug: `s-${index}` })));
  const shape = (rows: HomeRow[]) => rows.map((row) => (row.kind === 'section' ? `§${row.section}` : row.kind));

  it('keeps the blueprint order: lead, Neu in der Garage, the stream with a module after every 6 items', () => {
    const weekly = feedVehicle({ id: '01weekly', slug: 'weekly' });
    const rows = forYouRows({ ...base, hero: GTI, newBuilds: [R34, M4], weekly, members: [activeMember()], mods: MODS, stream: many(14) });
    expect(shape(rows)).toEqual([
      'hero',
      '§newBuilds',
      'rail',
      ...Array(MODULE_EVERY).fill('card'),
      '§weekly',
      'weekly',
      ...Array(MODULE_EVERY).fill('card'),
      '§members',
      'members',
      'card',
      'card',
      '§mods',
      'mods',
    ]);
    expect(forYouRows({ ...base, stream: [vehicleItem(R34)] }).map((row) => row.kind)).toEqual(['card']);
  });

  it('leaves out every module without content, and appends the modules a short stream has no room for', () => {
    const rows = forYouRows({ ...base, mods: MODS, stream: many(2) });
    expect(shape(rows)).toEqual(['card', 'card', '§mods', 'mods']);
    expect(forYouRows(base)).toEqual([]);
  });

  it('fills the rail with up to 8 builds without the lead, and never repeats a build drawn above in the stream', () => {
    const rail = Array.from({ length: 10 }, (_, index) => feedVehicle({ id: `01rail${index}` }));
    const rows = forYouRows({ ...base, hero: rail[0], newBuilds: rail, stream: [vehicleItem(rail[1] as FeedVehicle), vehicleItem(R34), updateItem(buildUpdate())] });
    const railRow = rows.find((row) => row.kind === 'rail');
    expect(railRow?.kind === 'rail' && railRow.vehicles.map((vehicle) => vehicle.id)).toEqual(rail.slice(1, 9).map((vehicle) => vehicle.id));
    expect(rows.filter((row) => row.kind === 'card').map((row) => row.kind === 'card' && row.vehicle.id)).toEqual([R34.id]);
    expect(rows.at(-1)?.kind).toBe('update');
  });

  it('calls only an editorial pick other than the lead "Build der Woche"', () => {
    expect(weeklyBuild([{ source: 'editorial', vehicle: GTI, quote: null }, { source: 'editorial', vehicle: R34, quote: null }])?.id).toBe(R34.id);
    expect(weeklyBuild([{ source: 'editorial', vehicle: GTI, quote: null }, { source: 'completeness', vehicle: R34, quote: null }])).toBeUndefined();
    expect(weeklyBuild(undefined)).toBeUndefined();
  });

  // M2.2 review 2: the server leaves only the lead out of the stream. The other featured builds are not drawn above, so they belong in it.
  it('keeps a featured build that is not the lead in the stream', () => {
    const featuredSecond = { ...GTI, id: '01featured2' };
    const rows = forYouRows({ ...base, hero: R34, newBuilds: [M4], stream: [vehicleItem(featuredSecond), vehicleItem(R34)] });
    expect(rows.filter((row) => row.kind === 'card').map((row) => row.kind === 'card' && row.vehicle.id)).toEqual([featuredSecond.id]);
  });

  it('turns a Folge ich page into build and update cards, in the server’s order, and skips an item without its body', () => {
    const rows = streamRows([updateItem(buildUpdate()), vehicleItem(R34), { type: 'vehicle', key: 'broken', vehicle: null, update: null }]);
    expect(rows.map((row) => row.kind)).toEqual(['update', 'card']);
  });

  it('does not repeat a card’s latest change that has a card of its own in the stream (DQ-289)', () => {
    const latest = { id: 'u-brakes', type_label: 'Modifikation hinzugefügt', summary: 'Bremsen: Serie → Endless MX72', created_at: '2026-11-07T18:00:00+00:00' };
    const ae86 = { ...R34, id: '01ae86', latest_update: latest };
    const rows = streamRows([updateItem(buildUpdate({ id: 'u-brakes', vehicle: ae86 })), vehicleItem(ae86), vehicleItem(R34)]);
    expect(rows[1]).toMatchObject({ kind: 'card', showLatest: false });
    expect(rows[2]).not.toHaveProperty('showLatest');
  });
});

describe('Aktive Mitglieder strip', () => {
  it('shows four and a half members, never narrower than the 56 avatar, and two and a half at a large font', () => {
    // 390 phone, gutter 20: (390 − 20 − 4 × 12) / 4.5.
    expect(memberItemWidth(390, 20, 1)).toBe(71);
    expect(memberItemWidth(360, 16, 1)).toBeGreaterThanOrEqual(56);
    expect(memberItemWidth(390, 20, 2)).toBe(Math.floor((390 - 20 - 2 * 12) / 2.5));
    expect(memberItemWidth(100, 20, 1)).toBe(56);
  });
});

describe('Beliebte Mods chips', () => {
  it('keeps the chips of the first two lines, from their widths, and waits until the row and every chip were measured', () => {
    // Row 300, gap 8: [100, 100, 84] fill line 1 exactly, [150, 142] line 2, the rest would start line 3.
    expect(chipsThatFit([100, 100, 84, 150, 142, 60], 300)).toBe(5);
    expect(chipsThatFit([100, 100], 300)).toBe(2);
    // A chip wider than the row takes a line of its own.
    expect(chipsThatFit([400, 400, 50], 300)).toBe(2);
    expect(chipsThatFit([100, undefined], 300)).toBeUndefined();
    expect(chipsThatFit([100], undefined)).toBeUndefined();
    expect(chipsThatFit([], 300)).toBe(0);
  });
});

describe('member row meta (M2.2 test D1)', () => {
  it('wraps between words only: a car name keeps its spaces, a hyphenated name and the separator stay put', () => {
    expect(memberMetaText('@max.e46 · Subaru Impreza WRX STI GD')).toBe('@max.\u200Be46\u00A0· Subaru Impreza WRX STI GD');
    expect(memberMetaText('@kenji.r34 · Nissan Skyline GT-R R34')).toBe('@kenji.\u200Br34\u00A0· Nissan Skyline GT-\u2060R R34');
    expect(memberMetaText('Blockiert seit 14.06.2026')).toBe('Blockiert seit 14.06.2026');
    // A short part wraps at the "·" first and stays whole: never "Frankfurt am" / "Main" while it fits a line of its own.
    expect(memberMetaText('@marco.amg · Frankfurt am Main')).toBe('@marco.\u200Bamg\u00A0· Frankfurt\u00A0am\u00A0Main');
  });

  it('breaks a handle only after its "." or "_", never with a hyphen (DQ-282)', () => {
    expect(handleText('@paul.roadster')).toBe('@paul.\u200Broadster');
    expect(handleText('@smw74_cfew.sfb')).toBe('@smw74_\u200Bcfew.\u200Bsfb');
    expect(handleText('@nina')).toBe('@nina');
  });
});
