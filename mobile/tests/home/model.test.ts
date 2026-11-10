import { flattenBuilds } from '@/api/queries/home';
import { featuredByline, feedOwner, latestChangeMeta, parseDate, updateMeta } from '@/features/home/model';

import { M4, R34 } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const relative = (date: Date) => `rel:${date.toISOString()}`;

describe('feed card model', () => {
  it('names the owner with @ and the time the build last changed', () => {
    expect(feedOwner(R34, relative)).toEqual({
      username: '@kenji.r34',
      avatarUri: null,
      avatarBlurhash: null,
      time: 'rel:2026-11-04T09:00:00.000Z',
    });
  });

  it('draws no owner row when the owner switched off "Besitzer zeigen" (ADR-148 a)', () => {
    expect(feedOwner(M4, relative)).toBeUndefined();
  });

  it('labels the latest change by its kind, and adds its time only when no owner row carries one', () => {
    expect(latestChangeMeta(R34, relative)).toBe('Modifikation hinzugefügt');
    expect(latestChangeMeta({ ...R34, owner: null }, relative)).toBe('Modifikation hinzugefügt · rel:2026-11-04T09:00:00.000Z');
    expect(latestChangeMeta(M4, relative)).toBeNull();
  });

  it('writes the FS-2 byline, and none for a hidden owner', () => {
    // DQ-203: the line may wrap after the "·", never before it.
    expect(featuredByline(R34.owner)).toBe('@kenji.r34\u00A0· Düsseldorf');
    expect(featuredByline({ username: 'max.e46', city: null })).toBe('@max.e46');
    expect(featuredByline(null)).toBeNull();
  });

  it('names the car, its owner and the time on a build-update row, and leaves a hidden owner out', () => {
    expect(updateMeta({ created_at: '2026-11-04T09:00:00+00:00', vehicle: R34 }, relative)).toBe(
      'Nissan Skyline GT-R R34 · @kenji.r34 · rel:2026-11-04T09:00:00.000Z',
    );
    expect(updateMeta({ created_at: null, vehicle: { ...R34, owner: null } }, relative)).toBe('Nissan Skyline GT-R R34');
  });

  it('reads broken dates as none', () => {
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('2026-11-04T09:00:00+00:00')?.toISOString()).toBe('2026-11-04T09:00:00.000Z');
  });
});

describe('Neue Builds pages', () => {
  it('joins the pages and keeps a build that moved up between two pages once, at its first place', () => {
    const list = flattenBuilds([{ data: [R34, M4] }, { data: [R34] }]);
    expect(list.map((vehicle) => vehicle.id)).toEqual([R34.id, M4.id]);
    expect(flattenBuilds(undefined)).toEqual([]);
  });
});
