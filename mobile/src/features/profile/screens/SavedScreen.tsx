import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useSaveBuild, useSavedBuilds, type SavedBuild } from '@/api/queries/social';
import { feedOwner } from '@/features/home/model';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { NotFoundScreen } from '@/features/system/screens/NotFoundScreen';
import { useBack } from '@/features/vehicle/navigation';
import { SAVE_ICON, SAVED_BUILDS_FLAG } from '@/features/vehicle/save';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout } from '@/theme';
import { CollapsingFlashList, EmptyState, ErrorState, IconButton, Skeleton, Spinner, Text, toast, VehicleCard, VehicleCardSkeleton, type VehicleCardOwner } from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { GuestInvitation } from '../components/GuestInvitation';
import { vehicleCardProps } from '../media';

const ROUTE = 'PROF-05';

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // §5: card to card 24 in lists.
  item: { paddingBottom: t.space[24] },
  // The save date and the way out, on one line under the card: the glyph ends on the card's edge.
  footer: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginRight: -t.space[12], marginTop: t.space[4] },
  since: { flex: 1 },
  state: { paddingTop: t.space[32] },
  more: { alignItems: 'center', paddingVertical: t.space[16] },
}));

/** DQ-268: one date per card, "Gespeichert am …" beside the glyph that removes it; the owner row keeps no time of its own. */
function ownerWithoutTime(owner: VehicleCardOwner | undefined): VehicleCardOwner | undefined {
  return owner ? { username: owner.username, avatarUri: owner.avatarUri, avatarBlurhash: owner.avatarBlurhash } : undefined;
}

type SavedCardProps = {
  vehicle: SavedBuild;
  width: number;
  columnStyle: StyleProp<ViewStyle>;
  onOpen: (vehicle: SavedBuild) => void;
};

/** One saved build: the card of §8, and the filled save glyph that takes it out again, with "Rückgängig" in the toast. */
const SavedCard = memo(function SavedCard({ vehicle, width, columnStyle, onOpen }: SavedCardProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const failed = (error: Error) => toast(error.message || t('saved.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
  const save = useSaveBuild(vehicle.id, { onFailed: failed });
  const testID = `${ROUTE}.card.${vehicle.id}`;

  // The card leaves the list at once, so the toast with "Rückgängig" comes at once too; a failure brings the card back and says so.
  const remove = () => {
    save.mutate({ vehicleId: vehicle.id, save: false });
    toast(t('saved.removed', { name: vehicle.full_title }), {
      undo: () => save.mutate({ vehicleId: vehicle.id, save: true }),
      testID: `${ROUTE}.toast`,
    });
  };

  return (
    <View style={[columnStyle, styles.item]}>
      <VehicleCard
        {...vehicleCardProps(vehicle, width)}
        isMain={false}
        owner={ownerWithoutTime(feedOwner(vehicle, format.relative))}
        onPress={() => onOpen(vehicle)}
        testID={testID}
      />
      <View style={styles.footer}>
        <Text variant="caption" color="text.tertiary" style={styles.since} testID={`${testID}.savedAt`}>
          {vehicle.saved_at ? t('saved.since', { date: format.date(new Date(vehicle.saved_at)) }) : ''}
        </Text>
        <IconButton icon={SAVE_ICON} selected label={t('saved.remove', { name: vehicle.full_title })} onPress={remove} testID={`${testID}.remove`} />
      </View>
    </View>
  );
});

/**
 * PROF-05 [SIGNATURE `sig.saved_builds`]: your private list of saved builds, newest save first. Nobody else sees it, and an
 * owner only ever learns an aggregate (§3.5). Builds you can no longer see are left out by the server. Without the flag the
 * route does not exist.
 */
export function SavedScreen() {
  const enabled = useFlag(SAVED_BUILDS_FLAG);
  return enabled ? <SavedList /> : <NotFoundScreen />;
}

function SavedList() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const status = useSessionStore((state) => state.status);
  const back = useBack('/profile');
  const query = useSavedBuilds(true);
  const listRef = useRef<FlashListRef<SavedBuild>>(null);
  const { forget } = useRetainedListScroll(listRef);
  const [width, setWidth] = useState(0);
  const rows = useMemo(() => (qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])), [qaState, query.data]);
  const cardWidth = Math.min(width, layout.feedColumn);

  const open = useCallback((vehicle: SavedBuild) => router.push(`/v/${vehicle.slug}`), [router]);

  let state: ReactNode = null;
  // DQ-276: a skeleton stands exactly where the rows will, without the gap that empty, error and offline get.
  let loading = false;
  if (status === 'guest') {
    state = <GuestInvitation routeId={ROUTE} returnTo="/profile/saved" />;
  } else if (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    loading = true;
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <VehicleCardSkeleton owner />
      </Skeleton>
    );
  } else if (qaState === 'error' || !query.data) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('saved.errorTitle')}
        message={offline ? t('saved.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        icon={SAVE_ICON}
        title={t('saved.emptyTitle')}
        body={t('saved.emptyBody')}
        action={{ label: t('saved.discover'), onPress: () => router.navigate('/discover') }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  return (
    <PushedListPage
      routeId={ROUTE}
      title={t('saved.title')}
      onBack={back}
      offlineLabel={t('saved.offlineBanner')}
      onScrollToTop={(animated) => {
        forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(vehicle: SavedBuild) => vehicle.id}
          extraData={cardWidth}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
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
          renderItem={({ item }: { item: SavedBuild }) => <SavedCard vehicle={item} width={cardWidth} columnStyle={frame.columnStyle} onOpen={open} />}
          testID={`${ROUTE}.list`}
        />
      )}
    />
  );
}
