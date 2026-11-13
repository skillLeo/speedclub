/**
 * DQ-1025 (09 §5 MediaCard `feed`, §7.3): the action row of a Home feed card, reaction · save · share, without public counts.
 *
 * The feed sends no viewer state yet (lane B gap: `viewer {saved, reaction}` on FeedVehicleResource and BuildUpdateRowResource), so:
 * - a reaction is offered on update items only, and the card knows only the reaction the member gave in this session (a small store,
 *   so a recycled FlashList cell never shows another item's choice). A vehicle's own reaction stays on VEH-01, where it is known;
 * - save opens the save sheet, which reads `contains` per collection; once the sheet was opened, the icon follows those answers;
 * - share opens the system share sheet with the build's public page (`/v/{slug}`).
 * Guests see the row; every control asks to sign in first (§7.3 "guest: actions open a sign-in sheet"). An owner gets no reaction on
 * their own build (own item: 403), and never a count here (counts are owner-only on VEH-05).
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import { REACTION_KEYS, SOCIAL_FLAGS, useCollections, useReact, type CollectionItemType, type ReactionKey } from '@/api/queries/social2';
import { SaveSheet } from '@/features/collections/components/SaveSheet';
import { shareLink } from '@/features/profile/share';
import { siteUrl } from '@/features/settings/markdown/links';
import { haptics } from '@/lib/haptics';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { toast, type MediaCardFeedProps } from '@/ui';
import { BUILD_REACTION_GLYPHS } from '@/ui/motion/kit';

// -- The reactions the member gave in this session, by update id.

const given = new Map<string, ReactionKey | null>();
const listeners = new Set<() => void>();
let lastUsed: ReactionKey = 'strong';

function setGiven(id: string, reaction: ReactionKey | null): void {
  given.set(id, reaction);
  if (reaction) lastUsed = reaction;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget what this session reacted. */
export function __resetFeedReactionsForTests(): void {
  given.clear();
  lastUsed = 'strong';
}

const GLYPHS: Record<ReactionKey, (typeof BUILD_REACTION_GLYPHS)[keyof typeof BUILD_REACTION_GLYPHS]> = {
  strong: BUILD_REACTION_GLYPHS.stark,
  clean: BUILD_REACTION_GLYPHS.sauber,
  low: BUILD_REACTION_GLYPHS.tief,
  loud: BUILD_REACTION_GLYPHS.laut,
};

/** The public page of a build, or null where the app knows no site to link to. */
export function publicVehicleUrl(slug: string, site: string | null = siteUrl()): string | null {
  if (!site || !slug) return null;
  return `${site.replace(/\/+$/, '')}/v/${encodeURIComponent(slug)}`;
}

export type FeedCardActions = Pick<MediaCardFeedProps, 'reaction' | 'save' | 'onShare'> & { sheet: ReactNode };

/**
 * The action row's props for one feed card, and the save sheet to render next to it. `update` is the change the card tells, when it
 * tells one.
 */
export function useFeedCardActions({
  vehicle,
  updateId,
  routeId,
  returnTo = '/',
}: {
  vehicle: FeedVehicle;
  updateId?: string;
  routeId: string;
  /**
   * Where a guest comes back to after signing in. A constant on purpose: a cell that read the path would render again on every
   * navigation, also while Start is hidden on web, and FlashList would measure it at 0 there and lose the list's place (f-home).
   */
  returnTo?: string;
}): FeedCardActions {
  const { t } = useTranslation('home');
  const pathname = returnTo;
  const requireAuth = useRequireAuth();
  const me = useSessionStore((state) => state.member?.username ?? null);
  const reactionsOn = useFlag(SOCIAL_FLAGS.reactions);
  const collectionsOn = useFlag(SOCIAL_FLAGS.collections);
  const own = me !== null && vehicle.owner?.username === me;

  const item = useMemo<{ type: CollectionItemType; id: string }>(
    () => (updateId ? { type: 'build_update', id: updateId } : { type: 'vehicle', id: vehicle.id }),
    [updateId, vehicle.id],
  );
  const itemKey = `${item.type}:${item.id}`;
  // A recycled cell shows another item: what this cell opened belongs to the item it was opened for.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const known = openedFor === itemKey;
  const collections = useCollections(item, known && collectionsOn);
  const saved = known && (collections.data ?? []).some((collection) => collection.contains === true);

  const reactionTarget = updateId ?? '';
  const react = useReact('build-updates', reactionTarget);
  const mine = useSyncExternalStore(
    subscribe,
    () => (updateId ? (given.get(updateId) ?? null) : null),
    () => null,
  );
  const reactions = useMemo(() => REACTION_KEYS.map((key) => ({ key, label: t(`actions.reactions.${key}`), icon: GLYPHS[key] })), [t]);

  const select = useCallback(
    (key: string | null) => {
      if (!updateId) return;
      requireAuth(
        () => {
          const next = (key as ReactionKey | null) ?? null;
          const before = given.get(updateId) ?? null;
          setGiven(updateId, next);
          react.mutate(next, {
            onSuccess: (state) => setGiven(updateId, state.my_reaction ?? null),
            onError: (error) => {
              setGiven(updateId, before);
              toast(error.message || t('actions.failed'), { haptic: 'warning', testID: `${routeId}.toast` });
            },
          });
        },
        { returnTo: pathname },
      );
    },
    [pathname, react, requireAuth, routeId, t, updateId],
  );

  const openSave = useCallback(() => {
    requireAuth(
      () => {
        haptics.light();
        setOpenedFor(itemKey);
        setSheetFor(itemKey);
      },
      { returnTo: pathname },
    );
  }, [itemKey, pathname, requireAuth]);

  const share = useCallback(() => {
    const url = publicVehicleUrl(vehicle.slug);
    if (!url) return;
    void shareLink({ url, title: vehicle.full_title }).then((outcome) => {
      if (outcome === 'copied') toast(t('actions.copied'), { testID: `${routeId}.toast` });
      if (outcome === 'failed') toast(t('actions.shareFailed', { url }), { testID: `${routeId}.toast` });
    });
  }, [routeId, t, vehicle.full_title, vehicle.slug]);

  const showReaction = reactionsOn && Boolean(updateId) && !own && !vehicle.is_sample;
  const showSave = collectionsOn && !own;
  return {
    reaction: showReaction
      ? { reactions, selected: mine, lastUsed, onSelect: select, label: t('actions.react') }
      : undefined,
    save: showSave ? { saved, onToggle: openSave } : undefined,
    onShare: vehicle.visibility === 'public' && publicVehicleUrl(vehicle.slug) ? share : undefined,
    sheet: showSave ? (
      <SaveSheet visible={sheetFor === itemKey} onClose={() => setSheetFor(null)} item={item} routeId={routeId} />
    ) : null,
  };
}
