import '../qaStickers';

import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMe } from '@/api/queries/auth';
import { myStickersKey, useMyStickers, type StickerCard } from '@/api/queries/stickers';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { qa, useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, useBreakpoint } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Skeleton } from '@/ui/Skeleton';
import { CollapsingFlashList } from '@/ui/useCollapsingHeader';

import { QrNotice, QrSignInState } from '../components/parts';
import { QrPage, type QrListFrame } from '../components/QrPage';
import { StickerDownloadSheet } from '../components/StickerDownloadSheet';
import { SampleStickerPreview, StickerHubCard, StickerHubCardSkeleton } from '../components/StickerHubCard';

const ROUTE = 'STK-01';
const SKELETON_CARDS = 2;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  notice: { marginBottom: t.space[16] },
  sample: { alignSelf: 'flex-start', marginBottom: t.space[12] },
  end: { paddingBottom: t.space[32] },
  cellStart: { paddingRight: t.space[12] },
  cellEnd: { paddingLeft: t.space[12] },
}));

/** STK-01 "Meine Sticker" (10 §2.2): one card per published vehicle, main first; the hub of every sticker action. */
export function StickerHubScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  // DQ-M54-14: from 1280 the cards stand two by two across the content width, never one phone column.
  const { kind } = useBreakpoint();
  const columns = kind === 'desktop' ? 2 : 1;
  const router = useRouter();
  const client = useQueryClient();
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const me = useMe();
  const addVehicle = useAddVehicle();
  const query = useMyStickers();
  const cards = qaState === 'empty' ? [] : query.data;
  const suspended = qaState === 'restricted' || me.data?.restrictions.suspended === true;
  const listRef = useRef<FlashListRef<StickerCard>>(null);
  const retained = useRetainedListScroll(listRef);
  const [downloadFor, setDownloadFor] = useState<StickerCard | null>(null);

  const open = useCallback((vehicleId: string) => router.push({ pathname: '/stickers/[vehicleId]', params: { vehicleId } }), [router]);
  const design = useCallback(
    (vehicleId: string) => router.push({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId } }),
    [router],
  );
  const stats = useCallback(
    (vehicleId: string) => router.push({ pathname: '/stickers/[vehicleId]/stats', params: { vehicleId } }),
    [router],
  );
  // "Bestellen": the order page once the design passed its Scan-Test; before that, the designer, where the test is.
  const order = useCallback(
    (card: StickerCard) =>
      card.actions.order.available
        ? router.push({ pathname: '/stickers/[vehicleId]/order', params: { vehicleId: card.vehicle.id } })
        : // "Scan-Test" (DQ-M54R2-15): the designer opens and runs the test once.
          router.push({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: card.vehicle.id, scan: '1' } }),
    [router],
  );
  const download = useCallback((card: StickerCard) => setDownloadFor(card), []);

  let state: ReactNode = null;
  if (session === 'guest') {
    state = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!cards && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')
  ) {
    state = null;
  } else if (qaState === 'error' || !cards) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('hub.errorTitle')}
        message={offline ? t('hub.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (cards.length === 0) {
    state = (
      <EmptyState
        preview={<SampleStickerPreview testID={`${ROUTE}.sample`} />}
        title={t('hub.emptyTitle')}
        body={t('hub.emptyBody')}
        action={{ label: t('list.addVehicle'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );
  }
  const loading =
    session !== 'guest' &&
    (qaState === 'loading' || session === 'loading' || (!cards && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default'));

  const header = (frame: QrListFrame) => (
    <>
      {suspended ? (
        <View style={frame.columnStyle}>
          <QrNotice message={t('hub.suspendedNotice')} style={styles.notice} testID={`${ROUTE}.restricted`} />
        </View>
      ) : null}
      {qa.stickers === 'sample' && cards && cards.length > 0 ? (
        <View style={frame.columnStyle}>
          <SampleBadge style={styles.sample} testID={`${ROUTE}.sampleCounts`} />
        </View>
      ) : null}
    </>
  );

  return (
    <QrPage
      routeId={ROUTE}
      title={t('hub.title')}
      subtitle={t('hub.subtitle')}
      fallback="/profile"
      offlineLabel={t('common.offlineBanner')}
      onListScrollToTop={(animated) => {
        retained.forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      renderList={(frame) => (
        <>
          <CollapsingFlashList
            ref={listRef}
            {...frame.scrollProps}
            data={state || loading ? [] : (cards ?? [])}
            key={`columns-${columns}`}
            numColumns={columns}
            keyExtractor={(card: StickerCard) => card.vehicle.id}
            style={styles.list}
            contentContainerStyle={frame.contentContainerStyle}
            ListHeaderComponent={
              <>
                {frame.titleBlock}
                {header(frame)}
              </>
            }
            ListEmptyComponent={
              loading ? (
                <Skeleton testID={`${ROUTE}.skeleton`}>
                  {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                    <StickerHubCardSkeleton key={index} columnStyle={frame.columnStyle} />
                  ))}
                </Skeleton>
              ) : state ? (
                <View style={frame.columnStyle}>{state}</View>
              ) : null
            }
            ListFooterComponent={<View style={styles.end} />}
            renderItem={({ item, index }: { item: StickerCard; index: number }) => (
              <StickerHubCard
                card={item}
                columnStyle={columns === 2 ? (index % 2 === 0 ? styles.cellStart : styles.cellEnd) : frame.columnStyle}
                onOpen={open}
                onDesign={design}
                onOrder={order}
                onDownload={download}
                onStats={stats}
                suspended={suspended}
                routeId={ROUTE}
              />
            )}
            testID={`${ROUTE}.list`}
          />
          <StickerDownloadSheet
            visible={downloadFor !== null}
            onClose={() => setDownloadFor(null)}
            target={
              downloadFor?.design?.id && downloadFor.design.reference
                ? { designId: downloadFor.design.id, reference: downloadFor.design.reference, version: downloadFor.design.version }
                : null
            }
            vehicleTitle={downloadFor?.vehicle.full_title ?? ''}
            onStale={() => void client.invalidateQueries({ queryKey: myStickersKey })}
            routeId={ROUTE}
          />
        </>
      )}
    />
  );
}
