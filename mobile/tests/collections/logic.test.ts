import { collectionItemKey, flattenCollectionItems, withItemOrder, withoutItem, type CollectionItem, type CollectionItemsData , MemberCollection } from '@/api/queries/social2';
import { mosaicSlots } from '@/features/collections/components/CollectionTile';
import { collectionColumns, collectionTileWidth, visibleCollections } from '@/features/collections/components/CollectionsGrid';
import { __resetRemovalsForTests, flushRemovals, removeWithUndo } from '@/features/collections/deferred';
import { itemRemovalKey, itemTile, moveKey } from '@/features/collections/model';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const VEHICLE = {
  id: 'v1',
  slug: 'nissan-skyline-gt-r-r34-5tf974vj',
  full_title: 'Nissan Skyline GT-R R34',
  cover: null,
  is_sample: false,
};

function item(type: CollectionItem['type'], id: string, extra: Partial<CollectionItem> = {}): CollectionItem {
  return { type, id, position: 1, added_at: null, vehicle: null, modification: null, build_update: null, ...extra } as CollectionItem;
}

const pages = (...groups: CollectionItem[][]): CollectionItemsData => ({
  pages: groups.map((data, index) => ({ data, meta: { next_cursor: index < groups.length - 1 ? `c${index + 1}` : null } })),
  pageParams: groups.map((_, index) => (index === 0 ? null : `c${index}`)),
});

describe('COL-02 order and removal on the cached pages', () => {
  const a = item('vehicle', 'a');
  const b = item('modification', 'b');
  const c = item('build_update', 'c');

  it('names an item as the order route does', () => {
    expect(collectionItemKey(b)).toBe('modification:b');
  });

  it('keeps each page as long as before when the order changes', () => {
    const next = withItemOrder(pages([a, b], [c]), ['build_update:c', 'vehicle:a', 'modification:b']);
    expect(next.pages.map((page) => page.data.map(collectionItemKey))).toEqual([['build_update:c', 'vehicle:a'], ['modification:b']]);
    expect(flattenCollectionItems(next).map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });

  it('takes one item out of whichever page holds it', () => {
    expect(flattenCollectionItems(withoutItem(pages([a, b], [c]), 'build_update:c')).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('moves a key forward, back and to the start, and stays put at the ends', () => {
    const keys = ['a', 'b', 'c'];
    expect(moveKey(keys, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(keys, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(keys, 'c', 'first')).toEqual(['c', 'a', 'b']);
    expect(moveKey(keys, 'a', -1)).toEqual(keys);
    expect(moveKey(keys, 'c', 1)).toEqual(keys);
    expect(moveKey(keys, 'x', 1)).toEqual(keys);
  });
});

describe('COL-02 tiles', () => {
  it('opens a build and a mod at their pages; an update has no address yet', () => {
    expect(itemTile(item('vehicle', 'v1', { vehicle: VEHICLE as CollectionItem['vehicle'] }))).toMatchObject({
      key: 'vehicle:v1',
      type: 'vehicle',
      id: 'v1',
      href: '/v/nissan-skyline-gt-r-r34-5tf974vj',
      isSample: false,
    });
    const mod = itemTile(item('modification', 'm1', { modification: { id: 'm1', title: 'KW V3', category: 'suspension', vehicle: VEHICLE } }));
    expect(mod.href).toBe('/v/nissan-skyline-gt-r-r34-5tf974vj/mods/m1');
    expect(mod.title).toContain('KW V3');
    expect(itemTile(item('build_update', 'u1')).href).toBeNull();
  });
});

describe('COL-01 mosaic and grid', () => {
  it('fills four quadrants from up to four covers, or one tile from one', () => {
    expect(mosaicSlots([])).toEqual([null]);
    expect(mosaicSlots(['x'])).toEqual(['x']);
    expect(mosaicSlots(['x', 'y'])).toEqual(['x', 'y', null, null]);
    expect(mosaicSlots(['1', '2', '3', '4', '5'])).toEqual(['1', '2', '3', '4']);
  });

  it('lays out 2, 3 or 4 tiles a row by the column width', () => {
    expect(collectionColumns(353)).toBe(2);
    expect(collectionColumns(640)).toBe(3);
    expect(collectionColumns(1152)).toBe(4);
    expect(collectionTileWidth(353)).toBe(168);
    expect(collectionTileWidth(0)).toBe(0);
  });

  it('leaves out a collection whose delete waits for its undo toast', () => {
    const collection = { id: 'k1' } as MemberCollection;
    expect(visibleCollections([collection], new Set(['collection:k1']))).toEqual([]);
    expect(visibleCollections([collection], new Set())).toEqual([collection]);
  });
});

describe('delete with undo (SM20)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetRemovalsForTests();
  });
  afterEach(() => jest.useRealTimers());

  it('sends nothing while the toast offers Rückgängig, and nothing after undo', async () => {
    const commit = jest.fn(() => Promise.resolve());
    const removal = removeWithUndo('collection:k1', commit, jest.fn());
    jest.advanceTimersByTime(4900);
    expect(commit).not.toHaveBeenCalled();
    expect(removal.undo()).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('sends the delete once the toast is gone, and undo is then too late', async () => {
    const commit = jest.fn(() => Promise.resolve());
    const removal = removeWithUndo(itemRemovalKey('k1', 'vehicle:v1'), commit, jest.fn());
    await jest.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(removal.undo()).toBe(false);
  });

  it('reports a failed delete', async () => {
    const failed = jest.fn();
    removeWithUndo('collection:k2', () => Promise.reject(new Error('Nope')), failed);
    await jest.advanceTimersByTimeAsync(5000);
    expect(failed).toHaveBeenCalledWith(new Error('Nope'));
  });

  it('sends every waiting delete at once on flush', async () => {
    const commit = jest.fn(() => Promise.resolve());
    removeWithUndo('collection:k3', commit, jest.fn());
    removeWithUndo('collection:k4', commit, jest.fn());
    await flushRemovals();
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
