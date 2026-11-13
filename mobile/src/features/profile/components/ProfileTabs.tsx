import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMyEvents, useProfileUpdates, type MediaData, type ProfileEvent, type ProfileUpdate, type VehicleCardData } from '@/api/queries/profile';
import { useCollections } from '@/api/queries/social2';
import { CollectionsGrid, CollectionsGridSkeleton, useCollectionActions } from '@/features/collections/components/CollectionsGrid';
import { SampleCollections } from '@/features/collections/components/SampleCollections';
import { garageCardProps } from '@/features/garage/card';
import { withoutRepeatedKind } from '@/features/home/components/HomeFeedCard';
import { historyMetaLine, updateGlyph, updateHeadline } from '@/features/vehicle/model';
import { keepNameTogether } from '@/lib/format';
import { bindTrailingCode } from '@/ui/textBreaks';
import { useQaState, type QaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import {
  BuildUpdateRow,
  BuildUpdateRowSkeleton,
  Button,
  ContentTabs,
  EmptyState,
  ErrorState,
  SectionHeader,
  Skeleton,
  Text,
  VehicleCard,
  VehicleCardSkeleton,
  type ContentTab,
} from '@/ui';

import { photoFields } from '../media';
import { EventCardView } from '@/features/events/components/EventCardView';

import { SampleEvent, SampleGarageCard, SampleUpdates } from './samples';

export type ProfileTab = 'garage' | 'updates' | 'events' | 'saved';

const TABS: readonly ProfileTab[] = ['garage', 'updates', 'events', 'saved'];

/** `?tab=updates` opens that tab (links and the visual matrix); anything else the Garage. */
export function initialProfileTab(param: string | string[] | undefined): ProfileTab {
  const value = Array.isArray(param) ? param[0] : param;
  return TABS.find((tab) => tab === value) ?? 'garage';
}

/** The events flag of 09 §8.18: without it the Treffen tab is not there. */
export const EVENTS_FLAG = 'events';
/** The member collections flag (ADR-436). */
export const COLLECTIONS_FLAG = 'collections';

const useStyles = createStyles((t) => ({
  tabs: { marginTop: t.space[24] },
  panel: { paddingTop: t.space[16] },
  cards: { gap: t.space[24] },
  // Desktop (the wide column): the cards side by side, 2 or 3 per row by width, rows 32 apart (09 §7.15 12-column layouts).
  cardsGrid: { columnGap: t.space[24], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[32] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  more: { alignSelf: 'flex-start', marginTop: t.space[12] },
  eventCards: { gap: t.space[24] },
  savedHeader: { marginBottom: t.space[12] },
}));

/** The tabs a profile shows: Treffen and Gespeichert are the member's own (no API names another member's events). */
export function profileTabs(own: boolean, flags: { events: boolean; collections: boolean }): ProfileTab[] {
  return [
    'garage',
    'updates',
    ...(own && flags.events ? (['events'] as const) : []),
    ...(own && flags.collections ? (['saved'] as const) : []),
  ];
}

export type ProfileTabBarProps = {
  routeId: string;
  tabs: readonly ProfileTab[];
  value: ProfileTab;
  onChange: (next: ProfileTab) => void;
};

/**
 * 09 §7.7 Garage · Updates · Treffen · Gespeichert. Four tabs exceed the segmented control (three at most, §5), so the profile
 * uses the content tabs of VEH-01: same row height, roving arrow keys on the web, selection haptic.
 */
export function ProfileTabBar({ routeId, tabs, value, onChange }: ProfileTabBarProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const entries: ContentTab<ProfileTab>[] = tabs.map((tab) => ({ value: tab, label: t(`tabs.${tab}`), testID: `${routeId}.tabs.${tab}` }));
  return <ContentTabs tabs={entries} value={value} onChange={onChange} label={t('tabs.label')} style={styles.tabs} testID={`${routeId}.tabs`} />;
}

type QueryState = {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => unknown;
};

/** Loading as long as there is nothing to show and the request is under way (a paused one is offline, not loading). */
function isLoading(query: QueryState, qaState: QaState): boolean {
  if (qaState === 'loading') return true;
  if (qaState === 'empty' || qaState === 'error') return false;
  return query.data === undefined && query.isPending && query.fetchStatus !== 'paused';
}

export type GaragePanelProps = {
  routeId: string;
  own: boolean;
  vehicles: readonly VehicleCardData[];
  query: QueryState;
  /** The column's inner width (without gutters): the cards take it. */
  width: number;
  onAdd?: () => void;
};

/** Cards per row in the Garage tab: one under the other on phones (09 §7.7), side by side in the wide desktop column. */
export function garageColumns(width: number): 1 | 2 | 3 {
  if (width >= GARAGE_THREE_UP) return 3;
  if (width >= GARAGE_TWO_UP) return 2;
  return 1;
}
/** Each card keeps at least the phone card's width (≈ 350): 2 × 350 + 24 and 3 × 350 + 2 × 24. */
const GARAGE_TWO_UP = 724;
const GARAGE_THREE_UP = 1098;

/** Garage: the published builds as VehicleCards, one under the other (09 §7.7), main vehicle first. */
export function GaragePanel({ routeId, own, vehicles, query, width, onAdd }: GaragePanelProps) {
  const { t } = useTranslation('profile');
  const garage = useTranslation('garage').t;
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const open = useCallback((vehicle: VehicleCardData) => router.push(`/v/${vehicle.slug}`), [router]);
  // DQ-1109: never more columns than cards. Two builds at 1440 take two wide columns (both titles at 30/34) instead of leaving the
  // third column empty with one title at 24.
  const columns = Math.min(garageColumns(width), Math.max(1, vehicles.length));
  const cardWidth = columns > 1 ? Math.floor((width - space[24] * (columns - 1)) / columns) : width;

  let body: ReactNode;
  if (isLoading(query, qaState)) {
    body = (
      <Skeleton testID={`${routeId}.garage.skeleton`}>
        <View style={{ width }}>
          <VehicleCardSkeleton variant="garage" />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (query.data === undefined && qaState !== 'empty')) {
    body = (
      <ErrorState
        title={own ? t('garage.errorTitle') : t('member.garageError')}
        message={own ? t('garage.errorBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${routeId}.garage.error`}
      />
    );
  } else if (vehicles.length === 0) {
    body = own ? (
      <EmptyState
        preview={<SampleGarageCard width={width} testID={`${routeId}.garage.sample`} />}
        title={t('garage.emptyTitle')}
        body={t('garage.emptyBody')}
        action={onAdd ? { label: t('garage.add'), onPress: onAdd } : undefined}
        testID={`${routeId}.garage.empty`}
      />
    ) : (
      <Text variant="body" color="text.secondary" testID={`${routeId}.garage.empty`}>
        {t('member.garageEmpty')}
      </Text>
    );
  } else {
    body = (
      <>
        <View style={columns > 1 ? styles.cardsGrid : styles.cards} role="list" testID={`${routeId}.garage.list`}>
          {vehicles.map((vehicle) => (
            <View key={vehicle.id} role="listitem">
              {/* 09 §7.7 Garage tab: the 2.0 VehicleCards (09 §5), without the status pill: the profile lists published builds only. */}
              <VehicleCard
                {...garageCardProps(vehicle, cardWidth, garage)}
                status={undefined}
                onPress={() => open(vehicle)}
                style={{ width: cardWidth }}
                testID={`${routeId}.vehicle.${vehicle.id}`}
              />
            </View>
          ))}
        </View>
        {own && onAdd ? (
          <Button label={t('garage.add')} icon="plus" variant="tertiary" size="m" onPress={onAdd} style={styles.more} testID={`${routeId}.addVehicle`} />
        ) : null}
      </>
    );
  }
  return (
    <View style={styles.panel} testID={`${routeId}.garage`}>
      {body}
    </View>
  );
}

type HistoryTitle = Parameters<typeof updateHeadline>[1];

/**
 * DQ-1093: one row of the Updates tab as VEH-01 tells the same entry (DQ-1059). The title names the change ("HKS Super Turbo
 * Muffler statt Fujitsubo Legalis R"), and the meta carries its system once, the date and the build ("Abgasanlage · 13.03.2023 ·
 * Nissan Skyline GT-R R34"). A note or post is the member's own words: its text is the title, never "Notiz". Otherwise the type's
 * label is the title and the summary without its repeated system the line under it. Exported for the tests.
 */
export function profileUpdateText(
  entry: ProfileUpdate,
  title: HistoryTitle,
  date: (date: Date) => string,
): { title: string; diff: string | undefined; meta: string } {
  const { update, vehicle } = entry;
  const when = update.created_at ? date(new Date(update.created_at)) : null;
  // DQ-1126: the model code stays with the word before it ("GT-R R34"), so the meta never ends a line on a lone "R34" (ADR-426 c).
  // A caption pair this short fits every phone line, also at 200 %.
  const build = bindTrailingCode(keepNameTogether(vehicle.full_title), () => true);
  const authored = (update.type === 'note' || update.type === 'post') && update.note?.trim();
  if (authored) {
    return { title: update.note?.trim() ?? '', diff: undefined, meta: [when, build].filter(Boolean).join(' · ') };
  }
  const head = updateHeadline(update, title);
  const summary = update.summary.trim();
  const diff = head.namesChange ? (historyMetaLine(update)?.diff ?? undefined) : withoutRepeatedKind(update.type_label, summary) || undefined;
  return {
    title: head.title.trim() || build,
    diff,
    meta: [head.system, when, build].filter(Boolean).join(' · '),
  };
}

/**
 * DQ-1093: the row's photo is the update's own; without one, the build's cover on that build's newest row only, so the same cover
 * never repeats down the list; a later row without photos keeps the quiet tile.
 */
export function profileUpdatePhotos(updates: readonly ProfileUpdate[]): (MediaData | null)[] {
  const seen = new Set<string>();
  return updates.map(({ update, vehicle }) => {
    const own = update.photos[0];
    if (own) return own;
    if (!vehicle.cover || seen.has(vehicle.id)) return null;
    seen.add(vehicle.id);
    return vehicle.cover;
  });
}

export type UpdatesPanelProps = {
  routeId: string;
  own: boolean;
  vehicles: readonly VehicleCardData[];
  /** The vehicles are known (or failed): only then are their updates read. */
  ready: boolean;
  onPost?: () => void;
};

/** Updates: the newest build updates of the member's builds, as the rows of Home (09 §5). */
export function UpdatesPanel({ routeId, own, vehicles, ready, onPost }: UpdatesPanelProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const query = useProfileUpdates(vehicles, ready && qaState !== 'empty');
  const updates = useMemo(() => (qaState === 'empty' ? [] : (query.data ?? [])), [qaState, query.data]);
  const vehicleT = useTranslation('vehicle').t;
  const historyTitle: HistoryTitle = (key, values) => vehicleT(`history.title.${key}`, values);
  const photos = useMemo(() => profileUpdatePhotos(updates), [updates]);
  const state: QueryState = {
    data: vehicles.length === 0 ? [] : query.data,
    isPending: !ready || query.isPending,
    isFetching: query.isFetching,
    fetchStatus: query.isPaused ? 'paused' : query.isFetching ? 'fetching' : 'idle',
    refetch: query.refetch,
  };

  let body: ReactNode;
  if (isLoading(state, qaState)) {
    body = (
      <Skeleton testID={`${routeId}.updates.skeleton`}>
        <View style={styles.list}>
          <BuildUpdateRowSkeleton inset={space[16]} />
          <BuildUpdateRowSkeleton inset={space[16]} divider={false} />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (state.data === undefined && qaState !== 'empty')) {
    body = (
      <ErrorState title={t('tabs.updatesError')} onRetry={() => void query.refetch()} retrying={query.isFetching} testID={`${routeId}.updates.error`} />
    );
  } else if (updates.length === 0) {
    body = own ? (
      <EmptyState
        preview={<SampleUpdates testID={`${routeId}.updates.sample`} />}
        title={t('tabs.updatesEmptyTitle')}
        body={t('tabs.updatesEmptyBody')}
        action={onPost ? { label: t('tabs.postUpdate'), onPress: onPost } : undefined}
        testID={`${routeId}.updates.empty`}
      />
    ) : (
      <Text variant="body" color="text.secondary" testID={`${routeId}.updates.empty`}>
        {t('tabs.updatesEmptyOther')}
      </Text>
    );
  } else {
    body = (
      // DQ-1093: the updates sit on the canvas as a hairline list, not in a raised box.
      <View role="list" testID={`${routeId}.updates.list`}>
        {updates.map((entry, index) => {
          const text = profileUpdateText(entry, historyTitle, format.date);
          return (
            <BuildUpdateRow
              key={entry.update.id}
              title={text.title}
              diff={text.diff}
              meta={text.meta}
              photo={photoFields(photos[index], size.thumb.row)}
              glyph={updateGlyph(entry.update) ?? (entry.update.type === 'note' || entry.update.type === 'post' ? 'pencil-simple' : 'wrench')}
              onPress={() => router.push(`/v/${entry.vehicle.slug}/updates/${entry.update.id}`)}
              inset={0}
              divider={index < updates.length - 1}
              testID={`${routeId}.update.${entry.update.id}`}
            />
          );
        })}
      </View>
    );
  }
  return (
    <View style={styles.panel} testID={`${routeId}.updates`}>
      {body}
    </View>
  );
}

/** "14" and "JUN" of an event's start, in the event's time zone. Exported for the tests. */
export function eventDateParts(event: Pick<ProfileEvent, 'starts_at' | 'timezone'>, locale: string): { day: string; month: string; time: string } | null {
  if (!event.starts_at) return null;
  const date = new Date(event.starts_at);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: event.timezone }).format(date);
  return {
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }).replace('.', ''),
    time: part({ hour: '2-digit', minute: '2-digit' }),
  };
}

/** Treffen: the events the member said yes to (09 §7.7; the event pages come with M4.12). */
export function EventsPanel({ routeId }: { routeId: string }) {
  const { t } = useTranslation('profile');
  const tEvents = useTranslation('events').t;
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const query = useMyEvents(qaState !== 'empty');
  const events = qaState === 'empty' ? [] : (query.data ?? []);

  let body: ReactNode;
  if (isLoading(query, qaState)) {
    body = (
      <Skeleton testID={`${routeId}.events.skeleton`}>
        <View style={styles.list}>
          <BuildUpdateRowSkeleton inset={space[16]} divider={false} />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (query.data === undefined && qaState !== 'empty')) {
    body = <ErrorState title={t('tabs.eventsError')} onRetry={() => void query.refetch()} retrying={query.isFetching} testID={`${routeId}.events.error`} />;
  } else if (events.length === 0) {
    body = (
      <EmptyState
        preview={<SampleEvent testID={`${routeId}.events.sample`} />}
        title={t('tabs.eventsEmptyTitle')}
        body={t('tabs.eventsEmptyBody')}
        action={{ label: t('tabs.discover'), onPress: () => router.push('/events'), variant: 'secondary', size: 'm' }}
        testID={`${routeId}.events.empty`}
      />
    );
  } else {
    // M4.12: the same EventCards as EVT-05, each opening its EVT-02, and the way to all of the member's meets.
    body = (
      <>
        <View style={styles.eventCards} role="list" testID={`${routeId}.events.list`}>
          {events.map((event) => (
            <EventCardView key={event.id} event={event} routeId={routeId} />
          ))}
        </View>
        <Button
          label={tEvents('mine.title')}
          variant="tertiary"
          size="m"
          onPress={() => router.push('/profile/events')}
          style={styles.more}
          testID={`${routeId}.events.all`}
        />
      </>
    );
  }
  return (
    <View style={styles.panel} testID={`${routeId}.events`}>
      {body}
    </View>
  );
}

/** Gespeichert (own only): the collections as mosaics (COL-01), "Gespeichert" first. */
export function SavedPanel({ routeId, width }: { routeId: string; width: number }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const query = useCollections(undefined, qaState !== 'empty');
  const actions = useCollectionActions(routeId);
  const collections = qaState === 'empty' ? [] : (query.data ?? []);
  const empty = collections.every((collection) => collection.items_count === 0);

  let body: ReactNode;
  if (isLoading(query, qaState)) {
    body = (
      <Skeleton testID={`${routeId}.saved.skeleton`}>
        <CollectionsGridSkeleton width={width} count={2} />
      </Skeleton>
    );
  } else if (qaState === 'error' || (query.data === undefined && qaState !== 'empty')) {
    body = <ErrorState title={t('collections.listErrorTitle')} onRetry={() => void query.refetch()} retrying={query.isFetching} testID={`${routeId}.saved.error`} />;
  } else if (empty) {
    body = (
      <EmptyState
        preview={<SampleCollections width={width} testID={`${routeId}.saved.sample`} />}
        title={t('collections.emptyTitle')}
        body={t('collections.emptyBody')}
        action={{ label: t('collections.discover'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${routeId}.saved.empty`}
      />
    );
  } else {
    body = <CollectionsGrid collections={collections} width={width} actions={actions} routeId={routeId} />;
  }
  // DQ-1094: one way in. "Sammlungen" with "Alle" in the header's trailing slot on the gutter; the old "Alle gespeicherten Builds"
  // row is gone, since "Gespeichert" is itself a collection here (DQ-1087, 09 §8.6: collections replace PROF-05's list).
  return (
    <View style={styles.panel} testID={`${routeId}.savedTab`}>
      <SectionHeader
        title={t('collections.title')}
        actionLabel={empty || query.data === undefined ? undefined : t('collections.allShort')}
        actionAccessibilityLabel={t('collections.all')}
        onAction={() => router.push('/profile/collections')}
        style={styles.savedHeader}
        testID={`${routeId}.collections`}
      />
      {body}
      {actions.element}
    </View>
  );
}

/** The flags that decide the tabs. */
export function useProfileTabFlags(): { events: boolean; collections: boolean } {
  return { events: useFlag(EVENTS_FLAG), collections: useFlag(COLLECTIONS_FLAG) };
}
