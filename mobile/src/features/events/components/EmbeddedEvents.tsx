import '@/features/events/i18n';

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DEFAULT_FILTERS, flattenEvents, useEventList, type EventFilters } from '@/api/queries/events';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, EmptyState, ErrorState, EventCardSkeleton, Skeleton, Text } from '@/ui';

import { grantMapConsent } from '../map/mapConsent';
import { groupByWeek, sampleEvent } from '../model';
import { EventCardView } from './EventCardView';
import { EventFilterBar } from './EventFilters';

/** DISC-01 Treffen: this many cards before "Alle Treffen" (the full list and the map live on EVT-01). */
const EMBEDDED_LIMIT = 8;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16] },
  list: { gap: t.space[16] },
  day: { paddingTop: t.space[8] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  skeleton: { gap: t.space[24] },
}));

/**
 * DISC-01 scope "Treffen" (09 §7.5: the scope embeds EVT-01): the same filter chips and date-grouped cards as EVT-01, the first
 * eight, then "Alle Treffen" and "Auf der Karte" into EVT-01. The page around it scrolls, so no list of its own.
 */
export function EmbeddedEvents({ width, bleed, routeId }: { width: number; bleed: number; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [nearLabel, setNearLabel] = useState<string | null>(null);
  const [nearOpen, setNearOpen] = useState(false);
  const list = useEventList(filters, qaState === 'default');
  const events = useMemo(
    () => (qaState === 'empty' ? [] : flattenEvents(list.data?.pages).slice(0, EMBEDDED_LIMIT)),
    [list.data?.pages, qaState],
  );
  const rows = useMemo(() => groupByWeek(events, now(), format.locale, t), [events, format.locale, t]);
  const filtered = filters.when !== 'upcoming' || filters.type !== null || filters.near !== null;
  const id = `${routeId}.eventsScope`;

  let body;
  if (
    qaState === 'loading' ||
    (qaState === 'default' && !list.data && list.isPending && list.fetchStatus !== 'paused')
  ) {
    body = (
      <Skeleton testID={`${id}.skeleton`}>
        <View style={styles.skeleton}>
          <EventCardSkeleton cover />
          <EventCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || !list.data) {
    const offline = qaState !== 'error' && (!online || list.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('list.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${id}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (events.length === 0) {
    body = (
      <EmptyState
        preview={
          <EventCardView
            event={sampleEvent(now(), t)}
            routeId={`${id}.empty`}
            withCover
            coverWidth={width}
            inert
          />
        }
        title={filtered ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
        body={filtered ? t('list.emptyFilteredBody') : t('list.emptyBody')}
        action={
          filtered
            ? {
                label: t('list.resetFilters'),
                onPress: () => setFilters(DEFAULT_FILTERS),
                variant: 'secondary',
                size: 'm',
              }
            : {
                label: t('list.changeRegion'),
                onPress: () => setNearOpen(true),
                variant: 'secondary',
                size: 'm',
              }
        }
        testID={`${id}.empty`}
      />
    );
  } else {
    body = (
      <View style={styles.list}>
        {rows.map((row, index) =>
          row.kind === 'day' ? (
            <Text
              key={row.key}
              variant="calloutStrong"
              color="text.secondary"
              role="heading"
              aria-level={2}
              style={index > 0 ? styles.day : null}
              testID={`${id}.${row.key}`}
            >
              {row.label}
            </Text>
          ) : (
            <EventCardView
              key={row.key}
              event={row.event}
              routeId={id}
              withCover={index === 1}
              coverWidth={width}
            />
          ),
        )}
      </View>
    );
  }

  return (
    <View style={styles.root} testID={id}>
      <EventFilterBar
        filters={filters}
        onChange={setFilters}
        nearLabel={nearLabel}
        onNearLabel={setNearLabel}
        sheetOpen={nearOpen}
        onSheetOpen={setNearOpen}
        bleed={bleed}
        routeId={id}
      />
      {body}
      <View style={styles.actions}>
        <Button
          label={t('list.all')}
          variant="secondary"
          size="m"
          onPress={() => router.push('/events')}
          testID={`${id}.all`}
        />
        <Button
          label={t('list.mapView')}
          icon="map-trifold"
          variant="tertiary"
          size="m"
          onPress={() => {
            grantMapConsent();
            router.push({ pathname: '/events', params: { view: 'map' } });
          }}
          testID={`${id}.map`}
        />
      </View>
    </View>
  );
}
