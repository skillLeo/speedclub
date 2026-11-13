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
import {
  Button,
  ErrorState,
  Icon,
  MemberRow,
  Sheet,
  Skeleton,
  SkeletonText,
  Text,
  toast,
  type IconName,
} from '@/ui';
import { BUILD_REACTION_GLYPHS, ReactionPicker, type Reaction } from '@/ui/motion/kit';

const useStyles = createStyles((t) => ({
  owner: { gap: t.space[12] },
  ownerHead: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[8],
    justifyContent: 'space-between',
  },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  kind: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  count: { fontVariant: ['tabular-nums'] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { gap: t.space[4], paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
}));

const GLYPH: Record<ReactionKey, IconName> = {
  strong: BUILD_REACTION_GLYPHS.stark,
  clean: BUILD_REACTION_GLYPHS.sauber,
  low: BUILD_REACTION_GLYPHS.tief,
  loud: BUILD_REACTION_GLYPHS.laut,
};

const LAST_USED: { key: ReactionKey } = { key: 'strong' };

export function useBuildReactions(): readonly Reaction[] {
  const { t } = useTranslation('vehicle');
  return REACTION_KEYS.map((key) => ({ key, label: t(`reactions.${key}`), icon: GLYPH[key] }));
}

const isReactionKey = (value: string | null): value is ReactionKey =>
  value !== null && (REACTION_KEYS as readonly string[]).includes(value);

export type ReactButtonProps = {
  target: ReactionTarget;
  id: string;
  /** The viewer's own reaction from the API (`my_reaction`); never anybody else's. */
  mine: ReactionKey | null;
  testID: string;
};

/**
 * 09 §8.5 private reactions for a non-owner: the SM9 picker (tap = last used, long-press = all four). Optimistic; a failure
 * puts the old choice back with a toast. A guest is asked to sign in. Nothing here shows a count.
 */
export function ReactButton({ target, id, mine, testID }: ReactButtonProps) {
  const { t } = useTranslation('vehicle');
  const reactions = useBuildReactions();
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
    const next = isReactionKey(key) ? key : null;
    if (next) LAST_USED.key = next;
    react.mutate(next, {
      onError: () => toast(t('reactions.failed'), { haptic: 'warning', testID: `${testID}.toast` }),
    });
  };
  return (
    <ReactionPicker
      reactions={reactions}
      selected={mine}
      lastUsed={LAST_USED.key}
      onSelect={select}
      label={t('reactions.label')}
      testID={testID}
    />
  );
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
  const reactions = useBuildReactions();
  const [open, setOpen] = useState(false);
  const list = useReactionList(target, id, open);
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  const labelOf = (key: ReactionKey) => reactions.find((reaction) => reaction.key === key)?.label ?? key;

  return (
    <View style={styles.owner} testID={testID}>
      <View style={styles.ownerHead}>
        <Text variant="callout" color="text.secondary" testID={`${testID}.hint`}>
          {t('reactions.ownerHint')}
        </Text>
        {summary.total > 0 ? (
          <Button
            label={t('reactions.showAll')}
            variant="tertiary"
            size="s"
            onPress={() => setOpen(true)}
            testID={`${testID}.showAll`}
          />
        ) : null}
      </View>
      {summary.total === 0 ? (
        <Text variant="body" color="text.secondary" testID={`${testID}.none`}>
          {t('reactions.ownerNone')}
        </Text>
      ) : (
        <View style={styles.kinds} testID={`${testID}.summary`}>
          {REACTION_KEYS.map((key) => (
            <View
              key={key}
              style={styles.kind}
              aria-label={`${labelOf(key)} ${summary[key]}`}
              testID={`${testID}.${key}`}
            >
              <Icon name={GLYPH[key]} size={20} color="text.primary" />
              <Text variant="callout" style={styles.count}>
                {String(summary[key])}
              </Text>
            </View>
          ))}
        </View>
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
