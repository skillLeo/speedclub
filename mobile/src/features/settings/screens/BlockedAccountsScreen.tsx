import { useRouter } from 'expo-router';
import type { FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useBlockedMembers, useUnblockMember, type BlockedMember } from '@/api/queries/social';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useBack } from '@/features/vehicle/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  CollapsingFlashList,
  Dialog,
  EmptyState,
  ErrorState,
  MemberRow,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
} from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { SettingsSplit, useSettingsSplit } from '../components/SettingsSplit';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-08';
const SKELETON_ROWS = 3;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  intro: { marginBottom: t.space[16] },
  state: { paddingTop: t.space[32] },
  more: { alignItems: 'center', paddingVertical: t.space[16] },
  // The geometry of MemberRow: 56 minimum, 8 above and below, name and meta without a gap (60 per row).
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingVertical: t.space[8] },
  skeletonText: { flex: 1 },
}));

type RowProps = {
  member: BlockedMember;
  divider: boolean;
  columnStyle: StyleProp<ViewStyle>;
  onUnblock: (member: BlockedMember) => void;
};

/**
 * The name as it was when you blocked (a stored snapshot, never the member's live profile): initials from it, "@paul.roadster",
 * "Blockiert am 08.11.2026" and "Freigeben". The row does not open a profile: it is hidden.
 */
const BlockedRow = memo(function BlockedRow({ member, divider, columnStyle, onUnblock }: RowProps) {
  const { t } = useTranslation('settings');
  const readOnly = useViewAsReadOnly();
  const format = useFormat();
  const handle = `@${member.username}`;
  const since = member.blocked_at ? t('blocked.since', { date: format.date(new Date(member.blocked_at)) }) : undefined;
  const testID = `${ROUTE}.row.${member.username}`;
  return (
    <View style={columnStyle}>
      <MemberRow
        name={handle}
        meta={since}
        avatarUri={null}
        trailing={
          <Button
            disabled={readOnly}
            label={t('blocked.unblock')}
            variant="secondary"
            size="m"
            onPress={() => onUnblock(member)}
            accessibilityLabel={t('blocked.unblockName', { name: handle })}
            testID={`${testID}.unblock`}
          />
        }
        divider={divider}
        inset={0}
        testID={testID}
      />
    </View>
  );
});

/**
 * SET-08 /settings/privacy/blocked: the members you blocked, newest first, each with "Freigeben" behind a confirm. Reached from
 * SET-01 until SET-07 (M2.5) takes the row over.
 */
export function BlockedAccountsScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const back = useBack('/settings');
  const router = useRouter();
  const split = useSettingsSplit();
  const query = useBlockedMembers();
  const focused = useScreenFocused();
  const unblock = useUnblockMember({
    onFailed: (error) => toast(error.message || t('blocked.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
  });
  const [confirming, setConfirming] = useState<BlockedMember | null>(null);
  const listRef = useRef<FlashListRef<BlockedMember>>(null);
  const { forget } = useRetainedListScroll(listRef);
  const rows = useMemo(() => (qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])), [qaState, query.data]);

  const ask = useCallback((member: BlockedMember) => setConfirming(member), []);
  const confirm = () => {
    const member = confirming;
    setConfirming(null);
    if (!member) return;
    const handle = `@${member.username}`;
    unblock.mutate(member.username, { onSuccess: () => toast(t('blocked.done', { name: handle }), { testID: `${ROUTE}.toast` }) });
  };

  let state: ReactNode = null;
  // DQ-276: a skeleton stands exactly where the rows will, without the gap that empty, error and offline get.
  let loading = false;
  if (status === 'guest') {
    state = <SettingsGuest routeId={ROUTE} returnTo="/settings/privacy/blocked" />;
  } else if (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    loading = true;
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="bodyStrong" width="50%" />
              <SkeletonText variant="callout" width="40%" />
            </View>
            <SkeletonBlock width={size.touchMin * 2} height={size.button.m} corner="sm" />
          </View>
        ))}
      </Skeleton>
    );
  } else if (qaState === 'error' || !query.data) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('blocked.offlineTitle') : t('blocked.errorTitle')}
        message={offline ? t('blocked.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    // DQ-1033 (09 §5 EmptyState): the row a blocked account gets, badged Beispiel, then the line and the one way on.
    state = (
      <EmptyState
        preview={
          <MemberRow
            name={t('blocked.sampleHandle')}
            meta={t('blocked.since', { date: t('blocked.sampleDate') })}
            avatarUri={null}
            sample={{ is_sample: true }}
            inset={0}
            testID={`${ROUTE}.sample`}
          />
        }
        title={t('blocked.emptyTitle')}
        body={t('blocked.emptyBody')}
        action={{ label: t('blocked.emptyAction'), onPress: () => router.push('/settings/privacy'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const handle = `@${confirming?.username ?? ''}`;
  return (
    <SettingsSplit routeId={ROUTE} section="blocked">
    <PushedListPage
      routeId={ROUTE}
      title={t('blocked.title')}
      // DQ-420: the settings list stands beside this page from 1280; it is the way back there.
      onBack={split ? undefined : back}
      offlineLabel={t('blocked.offlineBanner')}
      onScrollToTop={(animated) => {
        forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      overlays={
        <Dialog
          visible={confirming !== null}
          onClose={() => setConfirming(null)}
          title={t('blocked.confirmTitle', { name: handle })}
          body={t('blocked.confirmBody', { name: handle })}
          testID={`${ROUTE}.dialog`}
          actions={[
            { label: t('blocked.cancel'), variant: 'secondary', onPress: () => setConfirming(null), testID: `${ROUTE}.dialog.cancel` },
            { label: t('blocked.unblock'), variant: 'primary', onPress: confirm, testID: `${ROUTE}.dialog.confirm` },
          ]}
        />
      }
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(member: BlockedMember) => member.username}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          ListHeaderComponent={
            status === 'guest' ? null : (
            <View style={frame.columnStyle}>
              <Text variant="body" color="text.secondary" style={styles.intro} testID={`${ROUTE}.intro`}>
                {t('blocked.intro')}
              </Text>
            </View>
            )
          }
          ListEmptyComponent={state ? <View style={[frame.columnStyle, loading ? null : styles.state]}>{state}</View> : null}
          ListFooterComponent={
            <View style={[frame.columnStyle, frame.endStyle]}>
              {query.isFetchingNextPage ? (
                <View style={styles.more}>
                  <Spinner testID={`${ROUTE}.more`} />
                </View>
              ) : null}
            </View>
          }
          onEndReached={() => {
            // Code review M2.8 nit 4: no page for a screen left behind in its tab or stack.
            if (focused && query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }: { item: BlockedMember; index: number }) => (
            <BlockedRow member={item} divider={index < rows.length - 1} columnStyle={frame.columnStyle} onUnblock={ask} />
          )}
          testID={`${ROUTE}.list`}
        />
      )}
    />
    </SettingsSplit>
  );
}
