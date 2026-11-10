import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useMe } from '@/api/queries/auth';
import {
  CONNECTIONS_QUERY_MAX,
  isMemberUnavailable,
  memberIdOf,
  useConnections,
  useMemberProfile,
  useRemoveFollower,
  type Connection,
  type ConnectionsTab,
} from '@/api/queries/social';
import { variantUrl } from '@/features/profile/media';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { ownerMeta, ownerName } from '@/features/vehicle/model';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  CollapsingFlashList,
  ContentTabs,
  Dialog,
  EmptyState,
  ErrorState,
  MemberRow,
  SearchBar,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  toast,
} from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { FollowButton } from '../components/FollowButton';
import { GuestInvitation } from '../components/GuestInvitation';

const ROUTE = 'PROF-04';
const SKELETON_ROWS = 6;
/** Typing settles before the request follows, as on DISC-02. */
const SEARCH_DEBOUNCE_MS = 300;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  search: { marginTop: t.space[12], marginBottom: t.space[8] },
  state: { paddingTop: t.space[32] },
  more: { alignItems: 'center', paddingVertical: t.space[16] },
  // The geometry of MemberRow: 56 minimum, 8 above and below, name and meta without a gap (60 per row).
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingVertical: t.space[8] },
  skeletonText: { flex: 1 },
}));

function isTab(value: string | undefined): value is ConnectionsTab {
  return value === 'followers' || value === 'following';
}

/** The query as sent: trimmed, inner runs of space as one, at most 64 characters (contract §2). */
export function connectionsQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CONNECTIONS_QUERY_MAX).trim();
}

function RowsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="bodyStrong" width="55%" />
            <SkeletonText variant="supporting" width="35%" />
          </View>
          <SkeletonBlock width={size.touchMin * 2} height={size.button.m} corner="sm" />
        </View>
      ))}
    </Skeleton>
  );
}

type RowProps = {
  row: Connection;
  /** Your own Follower tab: "Entfernen" instead of Folgen. */
  removable: boolean;
  signedIn: boolean;
  divider: boolean;
  columnStyle: StyleProp<ViewStyle>;
  onOpen: (row: Connection) => void;
  onRemove: (row: Connection) => void;
};

/** §8 member row: avatar 40, name, "@jann.ptrs · Hamburg", and the trailing action (secondary M, §8 and DQ-264). */
const ConnectionRow = memo(function ConnectionRow({ row, removable, signedIn, divider, columnStyle, onOpen, onRemove }: RowProps) {
  const { t } = useTranslation('profile');
  const name = ownerName(row);
  const testID = `${ROUTE}.row.${row.username}`;
  let trailing: ReactNode = null;
  if (row.is_self) trailing = null;
  else if (removable) {
    trailing = (
      <Button
        label={t('connections.remove')}
        variant="secondary"
        size="m"
        onPress={() => onRemove(row)}
        accessibilityLabel={t('connections.removeName', { name })}
        testID={`${testID}.remove`}
      />
    );
  } else {
    trailing = (
      <FollowButton
        username={row.username}
        following={signedIn && row.is_following}
        size="m"
        variant="secondary"
        name={name}
        testID={`${testID}.follow`}
      />
    );
  }
  return (
    <View style={columnStyle}>
      <MemberRow
        name={row.is_self ? t('connections.selfName', { name }) : name}
        // DQ-277: without a display name the bold name is the handle already; the meta then carries the city alone.
        meta={row.display_name?.trim() ? ownerMeta(row) : row.city?.trim() || undefined}
        avatarUri={variantUrl(row.avatar, size.avatar.md)}
        avatarBlurhash={row.avatar?.blurhash}
        onPress={() => onOpen(row)}
        trailing={trailing}
        divider={divider}
        inset={0}
        testID={testID}
      />
    </View>
  );
});

export type ConnectionsScreenProps = {
  /** `/profile/connections`: your own lists, with "Entfernen" on the Follower tab. */
  own?: boolean;
};

/**
 * PROF-04 (`/profile/connections` and `/u/[username]/connections`): Follower and Folge ich as content tabs in `?tab=`, a search
 * field (debounced `q`), and one row per member, newest follow first. The tab counts are the profile's stats (contract §2); a
 * list may be shorter where a block hides rows, and it says nothing about who is hidden.
 */
export function ConnectionsScreen({ own = false }: ConnectionsScreenProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const status = useSessionStore((state) => state.status);
  const ownName = useSessionStore((state) => state.member?.username ?? '');
  const params = useLocalSearchParams<{ username?: string; tab?: string }>();
  const tabParam = paramOf(params.tab);
  const tab: ConnectionsTab = isTab(tabParam) ? tabParam : 'followers';
  const username = own ? ownName : (paramOf(params.username) ?? '');
  const back = useBack(own ? '/profile' : username ? `/u/${username}` : '/');
  const me = useMe();
  const profile = useMemberProfile(own ? undefined : username);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [removing, setRemoving] = useState<Connection | null>(null);
  const remove = useRemoveFollower({
    onFailed: (error) => toast(error.message || t('connections.removeFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
  });
  const query = useConnections(status === 'loading' || (own && status !== 'member') ? undefined : username, tab, q);
  const listRef = useRef<FlashListRef<Connection>>(null);
  const { forget } = useRetainedListScroll(listRef);

  useEffect(() => {
    const next = connectionsQuery(text);
    if (next === q) return undefined;
    const timer = setTimeout(() => setQ(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, text]);

  // A new list starts at its top.
  useEffect(() => {
    forget();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [forget, q, tab]);

  const stats = own ? me.data?.stats : profile.data?.stats;
  const rows = useMemo(() => (qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])), [qaState, query.data]);
  const handle = `@${(own ? ownName : profile.data?.username) || username}`;
  const signedIn = status === 'member';
  const removable = own && tab === 'followers';

  const open = useCallback(
    (row: Connection) => {
      if (row.is_self) router.navigate('/profile');
      else router.push({ pathname: '/u/[username]', params: { username: row.username } });
    },
    [router],
  );
  const askRemove = useCallback((row: Connection) => setRemoving(row), []);
  const confirmRemove = () => {
    const row = removing;
    setRemoving(null);
    if (!row) return;
    const name = `@${row.username}`;
    remove.mutate(row.username, { onSuccess: () => toast(t('connections.removed', { name }), { testID: `${ROUTE}.toast` }) });
  };

  // Another member's second list is "Folgt": "Folge ich" there would read as your own (copy review). Your own keeps "Folge ich".
  const following = own
    ? { plain: t('connections.following'), count: 'connections.followingCount', search: t('connections.searchFollowing'), tabs: t('connections.tabsLabel') }
    : {
        plain: t('connections.followingOther'),
        count: 'connections.followingCountOther',
        search: t('connections.searchFollowingOther'),
        tabs: t('connections.tabsLabelOther'),
      };
  const tabs = [
    { value: 'followers' as const, label: stats ? t('connections.followersCount', { count: stats.followers, value: format.number(stats.followers) }) : t('connections.followers') },
    { value: 'following' as const, label: stats ? t(following.count, { value: format.number(stats.following) }) : following.plain },
  ];

  let state: ReactNode = null;
  // DQ-276: a skeleton stands exactly where the rows will, without the gap that empty, error and offline get.
  let loading = false;
  const unavailable = !own && (qaState === 'restricted' || isMemberUnavailable(profile.error) || isMemberUnavailable(query.error));
  if (own && status === 'guest') {
    state = <GuestInvitation routeId={ROUTE} returnTo="/profile/connections" />;
  } else if (unavailable) {
    state = (
      <EmptyState
        icon="user"
        title={t('member.unavailableTitle')}
        body={t('member.unavailableBody')}
        action={{ label: t('member.unavailableAction'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.unavailable`}
      />
    );
  } else if (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    loading = true;
    state = <RowsSkeleton />;
  } else if (qaState === 'error' || !query.data) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('connections.errorTitle')}
        message={offline ? t('connections.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0 && q) {
    state = (
      <EmptyState icon="magnifying-glass" title={t('connections.noResults', { q })} body={t('connections.noResultsBody')} testID={`${ROUTE}.noResults`} />
    );
  } else if (rows.length === 0) {
    const key = `connections.empty.${own ? 'own' : 'other'}.${tab}` as const;
    state = (
      <EmptyState
        icon="user"
        title={t(`${key}.title`, { name: handle })}
        body={t(`${key}.body`, { name: handle })}
        action={own && tab === 'following' ? { label: t('connections.discover'), onPress: () => router.navigate('/discover') } : undefined}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const showControls = !(own && status === 'guest') && !unavailable;
  const top = showControls ? (
    <>
      <ContentTabs
        tabs={tabs}
        value={tab}
        onChange={(next) => router.setParams({ tab: next })}
        label={following.tabs}
        gutter={false}
        bleed
        testID={`${ROUTE}.tabs`}
      />
      <SearchBar
        value={text}
        onChangeText={setText}
        placeholder={tab === 'followers' ? t('connections.searchFollowers') : following.search}
        onCancel={() => setText('')}
        maxLength={CONNECTIONS_QUERY_MAX}
        style={styles.search}
        testID={`${ROUTE}.search`}
      />
    </>
  ) : null;

  return (
    <PushedListPage
      routeId={ROUTE}
      title={handle}
      onBack={back}
      offlineLabel={t('connections.offlineBanner')}
      top={top}
      onScrollToTop={(animated) => {
        forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      overlays={
        <Dialog
          visible={removing !== null}
          onClose={() => setRemoving(null)}
          title={t('connections.removeTitle', { name: `@${removing?.username ?? ''}` })}
          body={t('connections.removeBody', { name: `@${removing?.username ?? ''}` })}
          testID={`${ROUTE}.removeDialog`}
          actions={[
            { label: t('connections.cancel'), variant: 'secondary', onPress: () => setRemoving(null), testID: `${ROUTE}.removeDialog.cancel` },
            { label: t('connections.remove'), destructive: true, onPress: confirmRemove, testID: `${ROUTE}.removeDialog.confirm` },
          ]}
        />
      }
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: Connection) => memberIdOf(row.username)}
          extraData={signedIn}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
            if (shown && query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }: { item: Connection; index: number }) => (
            <ConnectionRow
              row={item}
              removable={removable}
              signedIn={signedIn}
              divider={index < rows.length - 1}
              columnStyle={frame.columnStyle}
              onOpen={open}
              onRemove={askRemove}
            />
          )}
          testID={`${ROUTE}.list`}
        />
      )}
    />
  );
}
