import { useRouter } from 'expo-router';
import type { FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useMe } from '@/api/queries/auth';
import { useMyQrCodes, type QrCodeData } from '@/api/queries/qr';
import { photoFields } from '@/features/profile/media';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space } from '@/theme';
import { CollapsingFlashList, EmptyState, ErrorState, Hairline, ListRow, Skeleton, SkeletonBlock, SkeletonText } from '@/ui';

import { displayQrCode } from '../code';
import { QrPage } from '../components/QrPage';
import { QrNotice, QrSignInState } from '../components/parts';
import { qrRowStatus } from '../status';

const ROUTE = 'QR-01';
const SKELETON_ROWS = 3;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // The grouped inset list of FS-12, drawn per row so the list can stay a FlashList: bg.surface, radius 12 at the ends.
  row: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  first: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  last: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md },
  notice: { marginBottom: t.space[16] },
  end: { paddingBottom: t.space[32] },
  skeletonGroup: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingHorizontal: t.space[16],
    paddingVertical: t.space[8],
  },
  skeletonText: { flex: 1, gap: t.space[4] },
}));

function ListSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeletonGroup}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index}>
            <View style={styles.skeletonRow}>
              <SkeletonBlock width={size.thumb.row} aspectRatio={1} corner="sm" />
              <View style={styles.skeletonText}>
                <SkeletonText variant="body" width="60%" />
                <SkeletonText variant="supporting" width="35%" />
              </View>
            </View>
            {index < SKELETON_ROWS - 1 ? <Hairline inset={space[16]} /> : null}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

type QrListItemProps = {
  qr: QrCodeData;
  first: boolean;
  last: boolean;
  columnStyle: StyleProp<ViewStyle>;
  onOpen: (vehicleId: string) => void;
};

/** One row: cover, "Nissan Skyline GT-R R34", "8TR0 Q3MC" and the status, "Aktiv", "Privat" or "Gesperrt". */
const QrListItem = memo(function QrListItem({ qr, first, last, columnStyle, onOpen }: QrListItemProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const code = qr.display_code ?? (qr.code ? displayQrCode(qr.code) : t('status.none'));
  return (
    <View style={[columnStyle, styles.row, first ? styles.first : null, last ? styles.last : null]}>
      <ListRow
        thumb={photoFields(qr.vehicle.cover, size.thumb.row)}
        title={keepNameTogether(qr.vehicle.full_title)}
        subtitle={code}
        value={t(`status.${qrRowStatus(qr)}`)}
        // DQ-152: the status takes its own line before the name would break inside a word.
        adaptiveValue
        onPress={() => onOpen(qr.vehicle.id)}
        inset={space[16]}
        divider={!last}
        testID={`${ROUTE}.row.${qr.vehicle.id}`}
      />
    </View>
  );
});

/** QR-01: one row per published vehicle with its code and what a scan leads to; the empty state leads to adding one. */
export function QrListScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const me = useMe();
  const addVehicle = useAddVehicle();
  const query = useMyQrCodes();
  const rows = qaState === 'empty' ? [] : query.data;
  const suspended = qaState === 'restricted' || me.data?.restrictions.suspended === true;
  const listRef = useRef<FlashListRef<QrCodeData>>(null);
  const retained = useRetainedListScroll(listRef);

  const open = useCallback(
    (vehicleId: string) => router.push({ pathname: '/qr/[vehicleId]', params: { vehicleId } }),
    [router],
  );

  let state: ReactNode = null;
  if (session === 'guest') {
    state = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!rows && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')
  ) {
    state = <ListSkeleton />;
  } else if (qaState === 'error' || !rows) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('list.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        icon="qr-code"
        title={t('list.emptyTitle')}
        body={t('list.emptyBody')}
        action={{ label: t('list.addVehicle'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const notice = suspended ? (
    <QrNotice message={t('list.suspendedNotice')} style={styles.notice} testID={`${ROUTE}.restricted`} />
  ) : null;

  return (
    <QrPage
      routeId={ROUTE}
      title={t('list.title')}
      subtitle={t('list.subtitle')}
      fallback="/profile"
      offlineLabel={t('common.offlineBanner')}
      onListScrollToTop={(animated) => {
        retained.forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={state ? [] : (rows ?? [])}
          keyExtractor={(qr: QrCodeData) => qr.vehicle.id}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          ListHeaderComponent={
            <>
              {frame.titleBlock}
              {notice ? <View style={frame.columnStyle}>{notice}</View> : null}
            </>
          }
          ListEmptyComponent={state ? <View style={frame.columnStyle}>{state}</View> : null}
          ListFooterComponent={<View style={styles.end} />}
          renderItem={({ item, index }: { item: QrCodeData; index: number }) => (
            <QrListItem
              qr={item}
              first={index === 0}
              last={index === (rows?.length ?? 0) - 1}
              columnStyle={frame.columnStyle}
              onOpen={open}
            />
          )}
          testID={`${ROUTE}.list`}
        />
      )}
    />
  );
}
