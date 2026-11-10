import { memberItemWidth } from '@/features/home/components/ActiveMembersStrip';
import { chipsThatFit } from '@/features/home/components/PopularModsChips';
import { memberMetaText } from '@/ui/MemberRow';
import { handleText } from '@/ui/textBreaks';
import { forYouRows, streamRows } from '@/features/home/screens/HomeScreen';

import { activeMember, buildUpdate, GTI, M4, MODS, R34, updateItem, vehicleItem } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('FS-2 rows of Für dich', () => {
  const base = { hero: undefined, newBuilds: [], updates: [], members: [], mods: [], stream: [] };

  it('keeps the blueprint order and leaves out every module without content', () => {
    const rows = forYouRows({ ...base, hero: GTI, newBuilds: [R34, M4], updates: [buildUpdate()], members: [activeMember()], mods: MODS, stream: [updateItem(buildUpdate({ id: 's' }))] });
    expect(rows.map((row) => (row.kind === 'section' ? `§${row.section}` : row.kind))).toEqual([
      'hero',
      '§newBuilds',
      'card',
      'card',
      '§updates',
      'updates',
      '§members',
      'members',
      '§mods',
      'mods',
      'streamUpdates',
    ]);
    expect(forYouRows({ ...base, stream: [vehicleItem(R34)] }).map((row) => row.kind)).toEqual(['card']);
  });

  it('shows two Neue Builds without the featured one, and none of the builds above again in the stream', () => {
    const rows = forYouRows({ ...base, hero: R34, newBuilds: [R34, M4, GTI], stream: [vehicleItem(M4), vehicleItem(R34), updateItem(buildUpdate())] });
    const cards = rows.filter((row) => row.kind === 'card');
    expect(cards.map((row) => row.kind === 'card' && row.vehicle.id)).toEqual([M4.id, GTI.id]);
    expect(cards.at(-1)).toMatchObject({ last: true });
    expect(rows.at(-1)?.kind).toBe('streamUpdates');
  });

  // M2.2 review 2: the server leaves only the hero out of the stream. The other featured builds are not drawn above, so they belong in it.
  it('keeps a featured build that is not the hero in the stream', () => {
    const featuredSecond = { ...GTI, id: '01featured2' };
    const rows = forYouRows({ ...base, hero: R34, newBuilds: [M4], stream: [vehicleItem(featuredSecond), vehicleItem(R34)] });
    const streamCards = rows.filter((row) => row.kind === 'card' && row.key.startsWith('stream.'));
    expect(streamCards.map((row) => row.kind === 'card' && row.vehicle.id)).toEqual([featuredSecond.id]);
  });

  it('marks the first section when there is no featured build, for the space under the segments', () => {
    expect(forYouRows({ ...base, updates: [buildUpdate()] })[0]).toEqual({ kind: 'section', section: 'updates', first: true });
    expect(forYouRows({ ...base, hero: GTI, updates: [buildUpdate()] })[1]).toEqual({ kind: 'section', section: 'updates', first: false });
  });

  it('turns a Folge ich page into cards and update rows, in the server’s order, and skips an item without its body', () => {
    const rows = streamRows([updateItem(buildUpdate()), vehicleItem(R34), { type: 'vehicle', key: 'broken', vehicle: null, update: null }]);
    expect(rows.map((row) => row.kind)).toEqual(['streamUpdates', 'card']);
  });

  it('puts consecutive update rows into one block, so they share the hairlines of §8 (DQ-288)', () => {
    const rows = streamRows([updateItem(buildUpdate({ id: 'u1' })), updateItem(buildUpdate({ id: 'u2' })), vehicleItem(M4), updateItem(buildUpdate({ id: 'u3' }))]);
    expect(rows.map((row) => (row.kind === 'streamUpdates' ? row.updates.map((update) => update.id).join('+') : row.kind))).toEqual(['u1+u2', 'card', 'u3']);
  });

  it('does not repeat a card’s latest change that is an update row of the stream (DQ-289)', () => {
    const latest = { id: 'u-brakes', type_label: 'Modifikation hinzugefügt', summary: 'Bremsen: Serie → Endless MX72', created_at: '2026-11-07T18:00:00+00:00' };
    const ae86 = { ...R34, id: '01ae86', latest_update: latest };
    const rows = streamRows([updateItem(buildUpdate({ id: 'u-brakes', vehicle: ae86 })), vehicleItem(ae86), vehicleItem(R34)]);
    expect(rows[1]).toMatchObject({ kind: 'card', showLatest: false });
    expect(rows[2]).not.toHaveProperty('showLatest');
  });

  it('does not repeat a change that Build-Updates lists, on a Neue Builds card or a stream card (DQ-308)', () => {
    const latest = { id: 'u-golf', type_label: 'Modifikation hinzugefügt', summary: 'Fahrwerk: Serie → KW V3', created_at: '2026-11-07T18:00:00+00:00' };
    const golf = { ...GTI, latest_update: latest };
    const ae86 = { ...R34, id: '01ae86', latest_update: { ...latest, id: 'u-ae86' } };
    const rows = forYouRows({
      ...base,
      newBuilds: [golf, M4],
      updates: [buildUpdate({ id: 'u-golf' }), buildUpdate({ id: 'u-ae86' })],
      stream: [vehicleItem(ae86), vehicleItem(R34)],
    });
    const cards = rows.filter((row) => row.kind === 'card');
    expect(cards.map((row) => (row.kind === 'card' ? [row.vehicle.id, row.showLatest ?? true] : null))).toEqual([
      [golf.id, false],
      [M4.id, true],
      [ae86.id, false],
      [R34.id, true],
    ]);
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
