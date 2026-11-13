import type { Href } from 'expo-router';

import { collectionItemKey, type CollectionItem, type CollectionItemType } from '@/api/queries/social2';
import type { MediaData } from '@/api/queries/profile';
import { keepNameTogether } from '@/lib/format';

/** What a wall tile of COL-02 shows of an item. */
export type ItemTile = {
  key: string;
  type: CollectionItemType;
  id: string;
  title: string;
  cover: MediaData | null;
  isSample: boolean;
  /** Null when the app cannot open it yet (a build update: the API gives no build address with it). */
  href: Href | null;
};

/** A saved build, mod, update, event or business as a tile. Exported for the tests. */
export function itemTile(item: CollectionItem): ItemTile {
  const key = collectionItemKey(item);
  const ref = { key, type: item.type, id: item.id };
  if (item.type === 'vehicle' && item.vehicle) {
    return {
      ...ref,
      title: keepNameTogether(item.vehicle.full_title),
      cover: item.vehicle.cover,
      isSample: item.vehicle.is_sample,
      href: `/v/${item.vehicle.slug}`,
    };
  }
  if (item.type === 'modification' && item.modification) {
    const mod = item.modification;
    return {
      ...ref,
      title: `${mod.title} · ${keepNameTogether(mod.vehicle.full_title)}`,
      cover: mod.vehicle.cover,
      isSample: mod.vehicle.is_sample,
      href: `/v/${mod.vehicle.slug}/mods/${mod.id}`,
    };
  }
  // M4.12 / M4.14 (09 §7.7 COL-02): a saved event opens EVT-02 with its cover, a saved business BIZ-01 with its logo.
  if (item.type === 'event' && item.event) {
    return { ...ref, title: item.event.title, cover: item.event.cover, isSample: item.event.is_sample, href: `/events/${item.event.slug}` };
  }
  if (item.type === 'business' && item.business) {
    return { ...ref, title: item.business.name, cover: item.business.logo, isSample: item.business.is_sample, href: `/b/${item.business.slug}` };
  }
  const update = item.build_update;
  return {
    ...ref,
    title: update ? update.type_label || update.summary : '',
    cover: update?.photos[0] ?? null,
    isSample: false,
    href: null,
  };
}

/** The keys of `keys` with `key` moved by `step` (−1 forward, +1 back) or to the front (`'first'`). Exported for the tests. */
export function moveKey(keys: readonly string[], key: string, step: -1 | 1 | 'first'): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  const to = step === 'first' ? 0 : Math.min(keys.length - 1, Math.max(0, from + step));
  if (to === from) return [...keys];
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** The deferred-removal key of an item in a collection. */
export function itemRemovalKey(collectionId: string, key: string): string {
  return `item:${collectionId}:${key}`;
}
