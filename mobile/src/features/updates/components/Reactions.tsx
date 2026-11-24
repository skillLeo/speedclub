import { usePathname } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import {
  REACTION_KEYS,
  SOCIAL_FLAGS,
  useReact,
  useReactionList,
  type ReactionKey,
  type ReactionSummary,
  type ReactionTarget,
} from '@/api/queries/social2';
import { variantUrl } from '@/features/vehicle/media';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Icon, type IconName } from '@/ui/icons/Icon';
import { MemberRow } from '@/ui/MemberRow';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { BUILD_REACTION_GLYPHS, ReactionPicker, type Reaction } from '@/ui/motion/kit';

import { isLikeReactionKey, LIKE, LIKE_REACTION_ORDER, reactionTriggerLabel } from '../reactions';

const useStyles = createStyles((t) => ({
  owner: { gap: t.space[12] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  // The zero state: the five glyphs, quiet, as a preview of where the counts will stand, and the line that says none came yet.
  none: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  noneGlyphs: { flexDirection: 'row', gap: t.space[8] },
  kind: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  count: { fontVariant: ['tabular-nums'] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { gap: t.space[4], paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
}));

const GLYPH: Record<ReactionKey, IconName> = {
  like: BUILD_REACTION_GLYPHS.gefaellt,
  strong: BUILD_REACTION_GLYPHS.stark,
  clean: BUILD_REACTION_GLYPHS.sauber,
  low: BUILD_REACTION_GLYPHS.tief,
  loud: BUILD_REACTION_GLYPHS.laut,
};

/** The four car reactions (Stark · Sauber · Tief · Laut), as DEX-03 offers them. */
export function useBuildReactions(): readonly Reaction[] {
  const { t } = useTranslation('vehicle');
  return REACTION_KEYS.map((key) => ({ key, label: t(`reactions.${key}`), icon: GLYPH[key] }));
}

/** R4-2.2: the heart "Gefällt mir" first, then the four car reactions (the picker's order and the owner's summary). */
export function useLikeReactions(): readonly Reaction[] {
  const { t } = useTranslation('vehicle');
  return LIKE_REACTION_ORDER.map((key) => ({ key, label: t(`reactions.${key}`), icon: GLYPH[key] }));
}

export type ReactButtonProps = {
  target: ReactionTarget;
  id: string;
  /** The viewer's own reaction from the API (`my_reaction`); never anybody else's. */
  mine: ReactionKey | null;
  /** Draws the trigger with its label beside the heart ("Gefällt mir", or the chosen reaction): VEH-05. */
  labelled?: boolean;
  testID: string;
};

/**
 * 09 §8.5 private reactions for a non-owner, R4-2.2: a tap is "Gefällt mir" (a second tap takes any reaction back), a long press
 * (keyboard: Arrow up) opens the heart and the four car reactions. Optimistic; a failure puts the old choice back with a toast. A
 * guest is asked to sign in. Nothing here shows a count.
 */
export function ReactButton({ target, id, mine, labelled = false, testID }: ReactButtonProps) {
  const { t } = useTranslation('vehicle');
  const reactions = useLikeReactions();
  const enabled = useFlag(SOCIAL_FLAGS.reactions);
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const pathname = usePathname();
  const lock = useViewAsLock();
  const react = useReact(target, id);
  if (!enabled) return null;
  const select = (key: string | null) => {
    if (status !== 'member') {
      requireAuth(undefined, { returnTo: pathname });
      return;
    }
    if (lock) {
      toast(lock, { testID: `${testID}.toast` });
      return;
    }
    const next = isLikeReactionKey(key) ? key : null;
    react.mutate(next, {
      onError: () => toast(t('reactions.failed'), { haptic: 'warning', testID: `${testID}.toast` }),
    });
  };
  return (
    <ReactionPicker
      reactions={reactions}
      selected={mine}
      lastUsed={LIKE}
      onSelect={select}
      label={reactionTriggerLabel(mine, { like: t('reactions.like'), react: t('reactions.label') })}
      buttonLabel={labelled ? (reactions.find((reaction) => reaction.key === mine)?.label ?? t('reactions.like')) : undefined}
      testID={testID}
    />
  );
}

/** A kind's count in the owner's summary; 0 for a kind an older server does not send yet ("like" before R4-2.2). */
function countOf(summary: ReactionSummary, key: ReactionKey): number {
  const value: unknown = (summary as Partial<Record<ReactionKey, number>>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** R4DQ-15: the kinds the owner's summary shows, in the picker's order: only those with a count, never a row of zeros. */
export function summaryEntries(summary: ReactionSummary): { key: ReactionKey; count: number }[] {
  return LIKE_REACTION_ORDER.map((key) => ({ key, count: countOf(summary, key) })).filter((entry) => entry.count > 0);
}

export type OwnerReactionsProps = {
  target: ReactionTarget;
  id: string;
  /** `reaction_summary`: present for the owner only. */
  summary: ReactionSummary;
  testID: string;
};

/** The owner's private view: counts per kind and the list of who reacted how (a sheet). "Nur du siehst das." */
export function OwnerReactions({ target, id, summary, testID }: OwnerReactionsProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const reactions = useLikeReactions();
  const [open, setOpen] = useState(false);
  const list = useReactionList(target, id, open);
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  const labelOf = (key: ReactionKey) => reactions.find((reaction) => reaction.key === key)?.label ?? key;
  const entries = summaryEntries(summary);

  return (
    <View style={styles.owner} testID={testID}>
      <Text variant="callout" color="text.secondary" testID={`${testID}.hint`}>
        {t('reactions.ownerHint')}
      </Text>
      {entries.length === 0 ? (
        <View style={styles.none} testID={`${testID}.none`}>
          <View style={styles.noneGlyphs} aria-hidden>
            {LIKE_REACTION_ORDER.map((key) => (
              <Icon key={key} name={GLYPH[key]} size={20} color="text.tertiary" />
            ))}
          </View>
          <Text variant="callout" color="text.secondary" testID={`${testID}.noneText`}>
            {t('reactions.ownerNone')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.kinds} testID={`${testID}.summary`}>
            {entries.map(({ key, count }) => (
              <View key={key} style={styles.kind} aria-label={`${labelOf(key)} ${count}`} testID={`${testID}.${key}`}>
                <Icon name={GLYPH[key]} size={20} color="text.primary" />
                <Text variant="callout" style={styles.count}>
                  {String(count)}
                </Text>
              </View>
            ))}
          </View>
          {/* R4DQ-15: the link to the list comes after the data it opens. */}
          <Button
            label={t('reactions.showAll')}
            variant="tertiary"
            size="s"
            flush="start"
            onPress={() => setOpen(true)}
            testID={`${testID}.showAll`}
          />
        </>
      )}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('reactions.listTitle')}
        label={t('reactions.listTitle')}
        testID={`${testID}.sheet`}
      >
        {list.isPending ? (
          <Skeleton testID={`${testID}.sheet.skeleton`}>
            <View style={styles.list}>
              {[0, 1, 2].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  <SkeletonText variant="body" width="50%" />
                  <SkeletonText variant="caption" width="20%" />
                </View>
              ))}
            </View>
          </Skeleton>
        ) : list.isError ? (
          <ErrorState
            message={t('reactions.loadError')}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
            testID={`${testID}.sheet.error`}
          />
        ) : (
          <View style={styles.list}>
            {rows.map((row, index) => (
              <MemberRow
                key={`${row.member?.username ?? 'gone'}-${index}`}
                name={
                  row.member
                    ? row.member.display_name || `@${row.member.username}`
                    : t('reactions.removedMember')
                }
                meta={labelOf(row.reaction)}
                avatarUri={variantUrl(row.member?.avatar, size.avatar.md)}
                avatarBlurhash={row.member?.avatar?.blurhash}
                divider={index < rows.length - 1}
                testID={`${testID}.sheet.row.${index}`}
              />
            ))}
            {list.hasNextPage ? (
              <Button
                label={t('reactions.showAll')}
                variant="tertiary"
                size="m"
                onPress={() => void list.fetchNextPage()}
                loading={list.isFetchingNextPage}
                testID={`${testID}.sheet.more`}
              />
            ) : null}
          </View>
        )}
      </Sheet>
    </View>
  );
}
