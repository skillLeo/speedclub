/**
 * M5.9c Build Journey + Build Score: the pure parts of the app side — the owner's "Nächstes Upgrade" (which items, in which order,
 * where each one leads), the rank lines, the "TÜV-eingetragen" rule, the composer's before/after validation. No React, so Jest
 * covers them directly.
 */
import type { Href } from 'expo-router';

import type { BuildScoreRank, NextUpgrade } from '@/api/queries/buildScore';
import type { IconName } from '@/ui/icons/Icon';

/**
 * The items the owner can act on, the glyph of each and the editor it opens. Community points (reactions, spots, followers) and the
 * history span come from other people or from time: never an item, so the list never asks the owner to chase likes (10 §16).
 */
export const UPGRADE_ITEMS = {
  photos: { icon: 'camera', target: 'photos' },
  cover_focal: { icon: 'image', target: 'photos' },
  key_specs: { icon: 'list', target: 'specs' },
  description: { icon: 'pencil-simple', target: 'basics' },
  documented_mods: { icon: 'wrench', target: 'mods' },
  registered_mods: { icon: 'hu-plakette', target: 'mods' },
  planned_mods: { icon: 'part-box', target: 'mods' },
  timeline: { icon: 'clock', target: 'post' },
  before_after: { icon: 'arrows-left-right', target: 'beforeAfter' },
} as const satisfies Record<string, { icon: IconName; target: UpgradeTarget }>;

export type UpgradeKey = keyof typeof UPGRADE_ITEMS;
export type UpgradeTarget = 'photos' | 'specs' | 'basics' | 'mods' | 'post' | 'beforeAfter';

export function isUpgradeKey(key: string): key is UpgradeKey {
  return Object.prototype.hasOwnProperty.call(UPGRADE_ITEMS, key);
}

export type UpgradeItem = NextUpgrade & { key: UpgradeKey; missing: number };

/** The owner's checklist: known, actionable items with points, most points first (ties keep the server's order). */
export function upgradeItems(upgrades: readonly NextUpgrade[] | undefined): UpgradeItem[] {
  return (upgrades ?? [])
    .flatMap((item, index) =>
      isUpgradeKey(item.key) && item.points > 0
        ? [{ item: { ...item, key: item.key, missing: Math.max(0, item.progress.need - item.progress.have) }, index }]
        : [],
    )
    .sort((a, b) => b.item.points - a.item.points || a.index - b.index)
    .map(({ item }) => item);
}

/** Where an item leads: the editor of that part of the build. */
export function upgradeHref(key: UpgradeKey, vehicleId: string): Href {
  const target = UPGRADE_ITEMS[key].target;
  switch (target) {
    case 'photos':
      return `/garage/${vehicleId}/photos` as Href;
    case 'specs':
      return `/garage/${vehicleId}/specs` as Href;
    case 'basics':
      return `/garage/${vehicleId}/basics` as Href;
    case 'mods':
      return `/garage/${vehicleId}/mods` as Href;
    case 'post':
      return { pathname: '/post-update', params: { vehicleId } } satisfies Href;
    case 'beforeAfter':
      return { pathname: '/post-update', params: { vehicleId, kind: 'before_after' } } satisfies Href;
  }
}

/** The rank lines in their fixed order (generation first, then Bundesland), each scope once. */
export function rankLines(ranks: readonly BuildScoreRank[]): BuildScoreRank[] {
  const order: BuildScoreRank['scope'][] = ['generation', 'bundesland'];
  return order.flatMap((scope) => {
    const rank = ranks.find((entry) => entry.scope === scope && entry.group_size >= 3 && entry.rank >= 1 && entry.rank <= entry.group_size);
    return rank ? [rank] : [];
  });
}

/** Contract §1: "TÜV-eingetragen" is the owner's statement — `is_registered`, or (older answers) a status meaning "in the papers". */
export const REGISTERED_STATUSES: readonly string[] = ['registered', 'individual_approval'];

export function isRegistered(mod: { is_registered?: unknown; legal_status?: string | null }): boolean {
  if (typeof mod.is_registered === 'boolean') return mod.is_registered;
  return typeof mod.legal_status === 'string' && REGISTERED_STATUSES.includes(mod.legal_status);
}

/** The update kinds (contract §2). */
export type BuildUpdateKind = 'post' | 'before_after';

/** The kind an update says it is; `post` when the answer has none. */
export function updateKindOf(update: unknown): BuildUpdateKind {
  return typeof update === 'object' && update !== null && (update as { kind?: unknown }).kind === 'before_after' ? 'before_after' : 'post';
}

export type BeforeAfterIssue = 'beforeMissing' | 'afterMissing';

/** What stops "Posten" of a before/after: both photos must be there (the server checks they are the owner's, of this vehicle). */
export function beforeAfterIssues(slots: { before: unknown; after: unknown }): BeforeAfterIssue[] {
  const issues: BeforeAfterIssue[] = [];
  if (!slots.before) issues.push('beforeMissing');
  if (!slots.after) issues.push('afterMissing');
  return issues;
}
