import { useLocalSearchParams, useRouter } from 'expo-router';
import type { FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import {
  useMyStickers,
  useRestoreStickerVersion,
  useStickerDefaultPreview,
  useStickerSvg,
  useStickerVersions,
  type StickerDesign,
} from '@/api/queries/stickers';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { formatNumber, keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, size, space } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { CollapsingFlashList } from '@/ui/useCollapsingHeader';

import { QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { QrPage } from '../components/QrPage';
import { StickerArt } from '../components/StickerArt';

const ROUTE = 'STK-07';
const THUMB = size.thumb.card + space[24];
const SKELETON_ROWS = 3;
const NBSP = '\u00a0';
/** The sample row's date: a fixed demo day (DQ-M54-16), never "today". */
const SAMPLE_DATE = '2026-03-02T12:00:00+01:00';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  thumb: {
    alignItems: 'center',
    backgroundColor: t.color.media.ground,
    borderRadius: t.radius.sm,
    height: THUMB,
    justifyContent: 'center',
    width: THUMB,
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  titleRow: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  restore: { alignSelf: 'flex-start', marginTop: t.space[8] },
  intro: { marginBottom: t.space[16] },
  list: { flex: 1 },
  end: { paddingBottom: t.space[32], paddingTop: t.space[12] },
  // The grouped inset list of FS-12, drawn per cell so the list can stay a FlashList: bg.surface, radius 12 at the ends.
  // DQ-M54-14: on a desktop the list keeps a readable 8 of 12 columns instead of stretching across the page.
  cell: { backgroundColor: t.color.bg.surface, maxWidth: (layout.contentMax * 8) / 12, overflow: 'hidden' },
  intro8: { maxWidth: (layout.contentMax * 8) / 12 },
  sample: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    maxWidth: (layout.contentMax * 8) / 12,
    overflow: 'hidden',
  },
  sampleBadge: { alignSelf: 'flex-start' },
  emptyText: { gap: t.space[8], marginTop: t.space[24] },
  emptyAction: { alignSelf: 'flex-start', marginTop: t.space[16] },
  first: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  last: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md },
}));

function HistorySkeleton() {
  const styles = useStyles();
  // DQ-M54R2-04: the intro's two lines, then rows in the loaded geometry (thumb, title, meta, date, the action under them).
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={[styles.intro, styles.intro8]}>
        <SkeletonText variant="callout" lines={2} />
      </View>
      <QrRowGroup style={styles.intro8}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index}>
            <View style={styles.row}>
              <SkeletonBlock width={THUMB} height={THUMB} corner="sm" />
              <View style={styles.text}>
                <SkeletonText variant="headline" width="40%" />
                <SkeletonText variant="callout" width="70%" />
                <SkeletonText variant="caption" width="55%" />
                {index > 0 ? (
                  <SkeletonBlock width="45%" height={size.button.s} corner="sm" style={styles.restore} />
                ) : null}
              </View>
            </View>
            {index < SKELETON_ROWS - 1 ? <Hairline inset={space[16]} /> : null}
          </View>
        ))}
      </QrRowGroup>
    </Skeleton>
  );
}

function VersionThumb({ design }: { design: StickerDesign }) {
  const styles = useStyles();
  const svg = useStickerSvg(design.id, design.updated_at);
  const room = THUMB - space[8];
  const ratio = design.size_mm.width / design.size_mm.height;
  const width = ratio >= 1 ? room : room * ratio;
  return (
    <View style={styles.thumb} aria-hidden>
      {svg.data ? (
        <StickerArt
          svg={svg.data}
          width={width}
          widthMm={design.size_mm.width}
          heightMm={design.size_mm.height}
          label=""
        />
      ) : (
        <SkeletonBlock width={width} aspectRatio={ratio} corner="xs" />
      )}
    </View>
  );
}

const VersionRow = memo(function VersionRow({
  design,
  current,
  onRestore,
  restoring,
  disabled,
}: {
  design: StickerDesign;
  current: boolean;
  onRestore: (version: number) => void;
  restoring: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const format = useFormat();
  const when = design.validated_at ?? design.updated_at;
  const state =
    design.state === 'validated'
      ? // A date never breaks inside itself ("16. November 2026"), DQ-M54R2-03.
        t('history.validated', { date: when ? format.longDate(new Date(when)).replace(/ /g, NBSP) : '' })
      : t('history.draft');
  const line = [
    t(`designer.template.names.${design.template}`),
    t(`designer.size.${design.options.size}`),
    t('designer.size.mm', {
      width: formatNumber(design.size_mm.width, format.locale),
      height: formatNumber(design.size_mm.height, format.locale),
    }),
  ].join(' · ');
  return (
    <View style={styles.row} testID={`${ROUTE}.version.${design.version}`}>
      <VersionThumb design={design} />
      {/* DQ-M54R2-03: the meta takes the row's whole text column; the action sits under it, never beside it in a narrow strip. */}
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text variant="headline" numeric>
            {t('history.version', { version: design.version })}
          </Text>
          {/* DQ-M54R2-11 b: "aktuell" is a state, set as a pill beside the version, not a meta word. */}
          {current ? (
            <StatusPill
              label={t('history.currentPill')}
              testID={`${ROUTE}.version.${design.version}.current`}
            />
          ) : null}
        </View>
        <Text variant="callout" color="text.secondary">
          {line}
        </Text>
        <Text variant="caption" color="text.secondary">
          {state}
        </Text>
        {current ? null : (
          <Button
            label={t('history.restore')}
            variant="secondary"
            size="s"
            loading={restoring}
            disabled={disabled}
            accessibilityLabel={t('history.restoreLabel', { version: design.version })}
            onPress={() => onRestore(design.version)}
            style={styles.restore}
            testID={`${ROUTE}.version.${design.version}.restore`}
          />
        )}
      </View>
    </View>
  );
});

/** A version row as an example: the car's own default drawing, a fixed demo date, the "Beispiel" badge; it restores nothing. */
function SampleVersionRow({ vehicleId }: { vehicleId: string }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const format = useFormat();
  const preview = useStickerDefaultPreview(vehicleId);
  const mm = preview.data?.size_mm ?? { width: 156, height: 65 };
  const room = THUMB - space[8];
  const ratio = mm.width / mm.height;
  const width = ratio >= 1 ? room : room * ratio;
  return (
    <View style={styles.sample} testID={`${ROUTE}.sample`}>
      <View style={styles.row}>
        <View style={styles.thumb} aria-hidden>
          {preview.data ? (
            <StickerArt
              svg={preview.data.svg}
              width={width}
              widthMm={mm.width}
              heightMm={mm.height}
              label=""
            />
          ) : (
            <SkeletonBlock width={width} aspectRatio={ratio} corner="xs" />
          )}
        </View>
        <View style={styles.text}>
          <SampleBadge style={styles.sampleBadge} />
          <Text variant="headline" numeric>
            {t('history.version', { version: 1 })}
          </Text>
          <Text variant="callout" color="text.secondary">
            {[
              t('designer.template.names.classic'),
              t('designer.size.m'),
              t('designer.size.mm', {
                width: formatNumber(mm.width, format.locale),
                height: formatNumber(mm.height, format.locale),
              }),
            ].join(' · ')}
          </Text>
          <Text variant="caption" color="text.secondary">
            {t('history.validated', { date: format.longDate(new Date(SAMPLE_DATE)).replace(/ /g, NBSP) })}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** STK-07 Design-Verlauf: every validated version and the open draft, newest first, page by page; any version can become the draft. */
export function StickerHistoryScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const { vehicleId: param } = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = typeof param === 'string' ? param : '';
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const me = useMe();
  const readOnly = useViewAsReadOnly();
  const versions = useStickerVersions(vehicleId);
  const restore = useRestoreStickerVersion(vehicleId);
  const cards = useMyStickers();
  const title = cards.data?.find((card) => card.vehicle.id === vehicleId)?.vehicle.full_title;
  const suspended = qaState === 'restricted' || me.data?.restrictions.suspended === true;
  const [restoring, setRestoring] = useState<number | null>(null);
  const key = useRef<{ version: number; key: string } | null>(null);
  const listRef = useRef<FlashListRef<StickerDesign>>(null);
  const list = useMemo(
    () => (qaState === 'empty' ? [] : versions.data?.pages.flatMap((page) => page.data)),
    [qaState, versions.data],
  );
  const error = versions.error instanceof ApiError ? versions.error : null;
  // The designer under this page, or a new one in its place: never a second designer on top of a stale one (review MF-3).
  const toDesigner = useCallback(
    () => router.dismissTo({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId } }),
    [router, vehicleId],
  );

  const onRestore = useCallback(
    async (version: number) => {
      if (key.current?.version !== version) key.current = { version, key: newIdempotencyKey() };
      setRestoring(version);
      try {
        // The newest entry is the current version: its draft revision is what the restore builds on (review MF-4).
        const design = await restore.mutateAsync({
          version,
          baseRevision: list?.[0]?.revision ?? 0,
          idempotencyKey: key.current.key,
        });
        key.current = null;
        toast(t('history.restored', { version, draft: design.version }), {
          testID: `${ROUTE}.restoredToast`,
        });
        toDesigner();
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.status !== 0) key.current = null;
        toast(
          failure instanceof ApiError && failure.status === 409
            ? t('history.restoreConflict')
            : t('history.restoreFailed'),
          { testID: `${ROUTE}.restoreToast` },
        );
        if (failure instanceof ApiError && failure.status === 409) void versions.refetch();
      } finally {
        setRestoring(null);
      }
    },
    [restore, list, t, toDesigner, versions],
  );

  let state: ReactNode = null;
  let loading = false;
  if (session === 'guest') {
    state = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!list && versions.isPending && versions.fetchStatus !== 'paused' && qaState === 'default')
  ) {
    loading = true;
  } else if (!list && (error?.status === 404 || error?.status === 403)) {
    state = (
      <QrState
        routeId={ROUTE}
        name="unavailable"
        icon="qr-code"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{
          label: t('unavailable.garage'),
          onPress: () => router.navigate('/garage'),
          variant: 'secondary',
          size: 'm',
        }}
      />
    );
  } else if (qaState === 'error' || !list) {
    const offline = !online || versions.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('history.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void versions.refetch()}
        retrying={versions.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (list.length === 0) {
    // DQ-M54-16: what a version looks like (a badged sample row), one line, one action; never the centred glyph.
    state = (
      <View testID={`${ROUTE}.empty`}>
        <SampleVersionRow vehicleId={vehicleId} />
        <View style={styles.emptyText}>
          <Text variant="title2" role="heading" aria-level={2}>
            {t('history.emptyTitle')}
          </Text>
          <Text variant="body" color="text.secondary">
            {t('history.emptyBody')}
          </Text>
        </View>
        <Button
          label={t('hub.design')}
          variant="secondary"
          size="m"
          style={styles.emptyAction}
          onPress={toDesigner}
          testID={`${ROUTE}.empty.action`}
        />
      </View>
    );
  }

  const rows = state || loading ? [] : (list ?? []);
  const disabledFor = (version: number) =>
    readOnly || suspended || (restoring !== null && restoring !== version);

  return (
    <QrPage
      routeId={ROUTE}
      title={t('history.title')}
      subtitle={title ? keepNameTogether(title) : undefined}
      subtitlePending={!title && session !== 'guest' && cards.isPending}
      fallback="/stickers"
      offlineLabel={t('common.offlineBanner')}
      onListScrollToTop={(animated) => listRef.current?.scrollToOffset({ offset: 0, animated })}
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={rows}
          keyExtractor={(design: StickerDesign) => design.id ?? String(design.version)}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          onEndReached={() => {
            if (versions.hasNextPage && !versions.isFetchingNextPage) void versions.fetchNextPage();
          }}
          ListHeaderComponent={
            <>
              {frame.titleBlock}
              {rows.length > 0 ? (
                <View style={frame.columnStyle}>
                  <Text variant="callout" color="text.secondary" style={[styles.intro, styles.intro8]}>
                    {t('history.intro')}
                  </Text>
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            loading ? (
              <View style={frame.columnStyle}>
                <HistorySkeleton />
              </View>
            ) : state ? (
              <View style={frame.columnStyle}>{state}</View>
            ) : null
          }
          ListFooterComponent={
            <View style={[frame.columnStyle, styles.end]}>
              {versions.isFetchingNextPage ? (
                <Skeleton testID={`${ROUTE}.more`}>
                  <SkeletonBlock height={THUMB + space[32]} corner="md" />
                </Skeleton>
              ) : null}
            </View>
          }
          renderItem={({ item, index }: { item: StickerDesign; index: number }) => (
            <View
              style={[
                frame.columnStyle,
                styles.cell,
                index === 0 ? styles.first : null,
                index === rows.length - 1 ? styles.last : null,
              ]}
            >
              <VersionRow
                design={item}
                current={index === 0}
                onRestore={onRestore}
                restoring={restoring === item.version}
                disabled={disabledFor(item.version)}
              />
              {index < rows.length - 1 ? <Hairline inset={space[16]} /> : null}
            </View>
          )}
          testID={`${ROUTE}.list`}
        />
      )}
    />
  );
}
