/**
 * DQ-1025 (09 §5 MediaCard `feed`, §7.3): the action row of a Home feed card, Gefällt mir · Kommentare · save · share, without public
 * counts.
 *
 * - R4-2.2: a tap on the heart is "Gefällt mir" (a second tap takes any reaction back), a long press opens the heart and the four car
 *   reactions. R5-5: an update card reacts to its update, a car card to the car (`vehicles/{id}/reactions`). The card starts from the
 *   item's `viewer.reaction` and then follows what the member gave in this session (a small store, so a recycled FlashList cell never
 *   shows another item's choice);
 * - R4-2.2, R5-5: "Kommentare" (flag build_comments) opens the item's comments in a sheet (FeedComments): an update card its update's
 *   thread, a car card the car's own while it is open (`comment_thread.enabled`; the composer while `can_write`); no count;
 * - save opens the save sheet, which reads `contains` per collection; once the sheet was opened, the icon follows those answers;
 * - share opens the system share sheet with the build's public page (`/v/{slug}`).
 * Guests see the row; reacting and saving ask to sign in first (§7.3 "guest: actions open a sign-in sheet"), comments open readable.
 * An owner gets no reaction on their own build (own item: 403), and never a count here (counts are owner-only on VEH-05).
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import {
  SOCIAL_FLAGS,
  useCollections,
  useReact,
  vehicleCommentsEnabled,
  type CollectionItemType,
  type CommentTarget,
  type ReactionKey,
} from '@/api/queries/social2';
import { SaveSheet } from '@/features/collections/components/SaveSheet';
import { isLikeReactionKey, LIKE, LIKE_REACTION_ORDER, reactionTriggerLabel } from '@/features/updates/reactions';
import { shareLink, withShareVia } from '@/features/profile/share';
import { siteUrl } from '@/features/settings/markdown/links';
import { haptics } from '@/lib/haptics';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { type MediaCardFeedProps } from '@/ui/MediaCard';
import { toast } from '@/ui/toast';
import { BUILD_REACTION_GLYPHS } from '@/ui/motion/kit';

import { FeedComments } from './components/FeedComments';

// -- The reactions the member gave in this session, by item (`build-updates:{id}`, `vehicles:{id}`).

const given = new Map<string, ReactionKey | null>();
const listeners = new Set<() => void>();

function setGiven(id: string, reaction: ReactionKey | null): void {
  given.set(id, reaction);
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
}

const GLYPHS: Record<ReactionKey, (typeof BUILD_REACTION_GLYPHS)[keyof typeof BUILD_REACTION_GLYPHS]> = {
  like: BUILD_REACTION_GLYPHS.gefaellt,
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

export type FeedCardComment = { label: string; onPress: () => void };

export type FeedCardActions = Pick<MediaCardFeedProps, 'reaction' | 'save' | 'onShare'> & { comment?: FeedCardComment; sheet: ReactNode };

/**
 * The action row's props for one feed card, and the save sheet to render next to it. `update` is the change the card tells, when it
 * tells one.
 */
export function useFeedCardActions({
  vehicle,
  updateId,
  viewerReaction,
  routeId,
  returnTo = '/',
}: {
  vehicle: FeedVehicle;
  updateId?: string;
  /**
   * The update's `viewer.reaction` from the feed: the member's own reaction before this session changed it. A car card leaves it out
   * and starts from the car's `viewer.reaction`.
   */
  viewerReaction?: string | null;
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
  const commentsOn = useFlag(SOCIAL_FLAGS.comments);
  // The comments sheet is mounted from its first opening on (its report flow outlives it), for the item it was opened for.
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
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

  // R5-5: an update card reacts to its update, a car card to the car.
  const reactionTarget = updateId ? 'build-updates' : 'vehicles';
  const reactionId = updateId ?? vehicle.id;
  const reactionKey = `${reactionTarget}:${reactionId}`;
  const react = useReact(reactionTarget, reactionId);
  const session = useSyncExternalStore(
    subscribe,
    () => (given.has(reactionKey) ? (given.get(reactionKey) ?? null) : undefined),
    () => undefined,
  );
  const fromFeed = updateId ? (viewerReaction ?? null) : (vehicle.viewer?.reaction ?? null);
  const mine: ReactionKey | null = session !== undefined ? session : isLikeReactionKey(fromFeed) ? fromFeed : null;
  const reactions = useMemo(() => LIKE_REACTION_ORDER.map((key) => ({ key, label: t(`actions.reactions.${key}`), icon: GLYPHS[key] })), [t]);

  const select = useCallback(
    (key: string | null) => {
      requireAuth(
        () => {
          const next = isLikeReactionKey(key) ? key : null;
          const before = mine;
          setGiven(reactionKey, next);
          react.mutate(next, {
            onSuccess: (state) => setGiven(reactionKey, state.my_reaction ?? null),
            onError: (error) => {
              setGiven(reactionKey, before);
              toast(error.message || t('actions.failed'), { haptic: 'warning', testID: `${routeId}.toast` });
            },
          });
        },
        { returnTo: pathname },
      );
    },
    [mine, pathname, react, reactionKey, requireAuth, routeId, t],
  );

  // R5-5: the thread the card opens: its update's, or the car's own.
  const commentTarget = useMemo<CommentTarget>(
    () => (updateId ? { type: 'update', id: updateId } : { type: 'vehicle', id: vehicle.id }),
    [updateId, vehicle.id],
  );
  const commentKey = `${commentTarget.type}:${commentTarget.id}`;
  const openComments = useCallback(() => {
    setCommentsFor(commentKey);
    setCommentsOpen(true);
  }, [commentKey]);

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
    const page = publicVehicleUrl(vehicle.slug);
    if (!page) return;
    // M5.7 (contract §2.4): a shared link counts as "geteilter Link" in the owner's statistics.
    const url = withShareVia(page);
    void shareLink({ url, title: vehicle.full_title }).then((outcome) => {
      if (outcome === 'copied') toast(t('actions.copied'), { testID: `${routeId}.toast` });
      if (outcome === 'failed') toast(t('actions.shareFailed', { url }), { testID: `${routeId}.toast` });
    });
  }, [routeId, t, vehicle.full_title, vehicle.slug]);

  // ADR-538 (R5DQ-08): a badged sample build takes real reactions and comments too (never a count); 09 §8.19 forbids invented
  // numbers, not members reacting. Samples never show in production.
  const showReaction = reactionsOn && !own;
  const showSave = collectionsOn && !own;
  // A car card offers the car's thread only while its owner allows comments; an update card always (a refusal closes the composer).
  const showComments = commentsOn && (Boolean(updateId) || vehicleCommentsEnabled(vehicle));
  return {
    reaction: showReaction
      ? {
          reactions,
          selected: mine,
          lastUsed: LIKE,
          onSelect: select,
          label: reactionTriggerLabel(mine, { like: t('actions.like'), react: t('actions.react') }),
        }
      : undefined,
    comment: showComments ? { label: t('actions.comments'), onPress: openComments } : undefined,
    save: showSave ? { saved, onToggle: openSave } : undefined,
    onShare: vehicle.visibility === 'public' && publicVehicleUrl(vehicle.slug) ? share : undefined,
    sheet: (
      <>
        {showSave ? <SaveSheet visible={sheetFor === itemKey} onClose={() => setSheetFor(null)} item={item} routeId={routeId} /> : null}
        {showComments && commentsFor === commentKey ? (
          <FeedComments
            visible={commentsOpen}
            onClose={() => setCommentsOpen(false)}
            target={commentTarget}
            {...(updateId ? {} : { canWrite: vehicle.comment_thread.can_write })}
            vehicleTitle={vehicle.full_title}
            own={own}
            routeId={routeId}
          />
        ) : null}
      </>
    ),
  };
}
