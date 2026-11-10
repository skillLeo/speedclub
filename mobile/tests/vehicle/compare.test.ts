import type { PublicModRow } from '@/api/queries/vehicles';
import { compareFromApi, compareItems, compareSummary, isSameBuild, type CompareResource } from '@/features/vehicle/compare';

import { R34 } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const card = (slug: string, full_title: string): CompareResource['a'] =>
  ({ ...R34, slug, full_title, subline_parts: ['2002', '2,6 l R6 Biturbo', 'Bayside Blue'] }) as unknown as CompareResource['a'];
const mod = (id: string, title: string): PublicModRow => ({ ...R34.highlights[0]!, id, title, summary_line: `${title} · 19″`, status_label: 'Verbaut' });

const ANSWER: CompareResource = {
  a: card('nissan-skyline-gt-r-r34-5tf974vj', 'Nissan Skyline GT-R R34'),
  b: card('bmw-m4-g82-ab12cd34', 'BMW M4 G82'),
  specs: [
    {
      key: 'engine',
      label: 'Motor',
      rows: [
        { key: 'code', label: 'Motorcode', a: 'RB26DETT', b: 'S58', differs: true },
        { key: 'fuel', label: 'Kraftstoff', a: 'Benzin', b: 'benzin', differs: false },
        { key: 'empty', label: 'Leer', a: ' ', b: null, differs: false },
      ],
    },
    { key: 'none', label: 'Nichts', rows: [{ key: 'x', label: 'X', a: null, b: null, differs: false }] },
  ],
  mods: [
    { key: 'wheels_tires', label: 'Räder & Reifen', icon: 'wheel', a: [mod('1', 'BBS LM')], b: [mod('3', 'Rays TE37')] },
    { key: 'exhaust', label: 'Abgasanlage', icon: 'exhaust', a: [], b: [mod('2', 'HKS')] },
  ],
};

describe('VEH-06 compare model (sig.compare, GET compare)', () => {
  it('takes the pair of cars from the cards', () => {
    const data = compareFromApi(ANSWER);
    expect(data.a).toEqual({ slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: 'Nissan Skyline GT-R R34', subline: '2002 · 2,6 l R6 Biturbo', cover: R34.cover });
    expect(data.b.title).toBe('BMW M4 G82');
  });

  it('keeps the server’s differs and drops rows and groups both sides leave empty', () => {
    const data = compareFromApi(ANSWER);
    expect(data.specs).toEqual([
      {
        key: 'engine',
        label: 'Motor',
        rows: [
          { key: 'code', label: 'Motorcode', a: 'RB26DETT', b: 'S58', differs: true },
          { key: 'fuel', label: 'Kraftstoff', a: 'Benzin', b: 'benzin', differs: false },
        ],
      },
    ]);
    expect(compareSummary(data)).toEqual({ rows: 2, differences: 1 });
  });

  it('puts the mods of each category side by side, a category of one build only too', () => {
    const data = compareFromApi(ANSWER);
    expect(data.mods.map((category) => [category.key, category.a.map((entry) => entry.title), category.b.map((entry) => entry.title)])).toEqual([
      ['wheels_tires', ['BBS LM'], ['Rays TE37']],
      ['exhaust', [], ['HKS']],
    ]);
    expect(data.mods[0]!.a[0]).toEqual({ id: '1', title: 'BBS LM', summary: 'BBS LM · 19″', status: 'Verbaut' });
  });

  it('lays it out with the sticky pair first and the differences marked', () => {
    const items = compareItems(compareFromApi(ANSWER));
    expect(items[0]).toEqual({ kind: 'header' });
    expect(items.filter((item) => item.kind === 'spec').map((item) => item.kind === 'spec' && [item.row.key, item.differs, item.last])).toEqual([
      ['code', true, false],
      ['fuel', false, true],
    ]);
    expect(items.filter((item) => item.kind === 'mods')).toHaveLength(2);
  });

  it('says when there are no mods at all', () => {
    expect(compareItems(compareFromApi({ ...ANSWER, mods: [] })).at(-1)).toEqual({ kind: 'noMods', key: 'mods.none' });
  });

  it('knows the same build by its public id, whatever the text part of the slug', () => {
    expect(isSameBuild('nissan-skyline-5tf974vj', 'old-name-5TF974VJ')).toBe(true);
    expect(isSameBuild('nissan-skyline-5tf974vj', 'bmw-m4-ab12cd34')).toBe(false);
  });
});
