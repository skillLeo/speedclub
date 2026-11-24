/**
 * Round-4 design fixes of the crews (R4DQ-04/05/30): the grid's columns per breakpoint, CREW-01's skeleton geometry from the cached
 * card, and the typed-name check of the danger zone.
 */
import { QueryClient } from '@tanstack/react-query';

import { crewKeys } from '@/api/queries/crews';
import { cachedCrewHasCover } from '@/features/crews/cache';
import { deleteNameMatches } from '@/features/crews/components/CrewDeleteZone';
import { crewMosaicTiles, MOSAIC_MAX } from '@/features/crews/components/CrewMosaic';
import { facts } from '@/features/crews/components/FactLine';
import { crewColumns } from '@/features/crews/layout';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const card = (slug: string, cover: unknown) => ({ id: slug, slug, name: slug, cover, logo: null });

describe('crewColumns (R4DQ-05)', () => {
  it('is one column on phones, two from 768 and three from 1280', () => {
    expect(crewColumns('phone')).toBe(1);
    expect(crewColumns('tablet')).toBe(2);
    expect(crewColumns('desktop')).toBe(3);
  });
});

describe('cachedCrewHasCover (R4DQ-04 skeleton)', () => {
  it('reads the tapped card from a cached list page, the own crews or an invitation', () => {
    const client = new QueryClient();
    client.setQueryData(crewKeys.list({ q: null, bundesland: null, sort: 'name' }), {
      pages: [{ data: [card('isar-stance-club', null), card('nordlicht-crew', { id: 'm1' })] }],
      pageParams: [null],
    });
    client.setQueryData(crewKeys.myInvites, { pages: [{ data: [{ id: 'inv', crew: card('sued-crew', { id: 'm2' }) }] }], pageParams: [null] });
    client.setQueryData(crewKeys.mine, [card('elb-crew', null)]);
    expect(cachedCrewHasCover(client, 'isar-stance-club')).toBe(false);
    expect(cachedCrewHasCover(client, 'nordlicht-crew')).toBe(true);
    expect(cachedCrewHasCover(client, 'sued-crew')).toBe(true);
    expect(cachedCrewHasCover(client, 'elb-crew')).toBe(false);
  });

  it('knows nothing of a deep link', () => {
    expect(cachedCrewHasCover(new QueryClient(), 'weg')).toBeNull();
    expect(cachedCrewHasCover(new QueryClient(), '')).toBeNull();
  });
});

describe('deleteNameMatches (R4DQ-30)', () => {
  it('takes the name in any case with outer spaces, nothing else', () => {
    expect(deleteNameMatches('  nordlicht crew ', 'Nordlicht Crew')).toBe(true);
    expect(deleteNameMatches('Nordlicht', 'Nordlicht Crew')).toBe(false);
    expect(deleteNameMatches('', 'Nordlicht Crew')).toBe(false);
  });
});

describe('crewMosaicTiles (R4DQ-53)', () => {
  const media = (id: string) => ({ id }) as never;
  const car = (id: string, cover: string | null) => ({ id, cover: cover ? media(cover) : null }) as never;

  it("takes each member's first car with a photo, then their others, three at most, each car once", () => {
    const rows = [
      { vehicles: [car('a1', null), car('a2', 'p-a2'), car('a3', 'p-a3')] },
      { vehicles: [car('b1', 'p-b1')] },
      { vehicles: [car('a2', 'p-a2')] },
      { vehicles: [car('c1', 'p-c1')] },
    ];
    expect(crewMosaicTiles(rows).map((tile) => tile.id)).toEqual(['a2', 'b1', 'c1']);
    expect(crewMosaicTiles(rows)).toHaveLength(MOSAIC_MAX);
  });

  it('is empty when no member shows a car photo', () => {
    expect(crewMosaicTiles([{ vehicles: [car('a1', null)] }, { vehicles: [] }])).toEqual([]);
  });
});

describe('facts (R4DQ-45)', () => {
  it('keeps the parts that are there, in order', () => {
    expect(facts([{ text: 'Hamburg' }, null, false, { text: '' }, { text: '12 Mitglieder', numeric: true }])).toEqual([
      { text: 'Hamburg' },
      { text: '12 Mitglieder', numeric: true },
    ]);
  });
});
