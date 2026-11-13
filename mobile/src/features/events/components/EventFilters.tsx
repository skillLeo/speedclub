import '@/features/events/i18n';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  EVENT_TYPES,
  GEOCODE_UNAVAILABLE,
  useGeocode,
  type EventFilters as Filters,
  type EventType,
  type EventWhen,
} from '@/api/queries/events';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';
import { createStyles, useBreakpoint } from '@/theme';
import { Button, Chip, ListRow, Sheet, Text, TextInput } from '@/ui';

const WHEN_CHIPS: readonly Exclude<EventWhen, 'upcoming'>[] = ['today', 'weekend', 'month'];
/** "Entfernung" (EVT-01): the radius steps up to the server's 300 km. */
export const RADIUS_STEPS = [25, 50, 100, 300] as const;

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[8] },
  sheet: { gap: t.space[16], paddingBottom: t.space[16] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  search: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[8] },
  field: { flex: 1 },
  results: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: t.space[12], justifyContent: 'flex-end' },
}));

export type NearChoice = { lat: number; lng: number; label: string | null };

export type EventFilterBarProps = {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** The label of the point "Entfernung" measures from ("Stuttgart", or the member's location). */
  nearLabel: string | null;
  onNearLabel: (label: string | null) => void;
  /** Opens the distance sheet from outside, e.g. the empty state's "Region ändern". */
  sheetOpen?: boolean;
  onSheetOpen?: (open: boolean) => void;
  /** Bleeds the chip row to the screen edges on a phone. */
  bleed?: number;
  /** DQ-1119 c: from 768 the chips wrap onto a second line instead of running off the column's end. */
  wrap?: boolean;
  routeId: string;
};

/**
 * EVT-01 filter chips (09 §7.10): Heute · Wochenende · Diesen Monat (one at a time; the chosen one again goes back to all) ·
 * Entfernung (sheet) · Art: Treffen · Ausfahrt · Trackday · Messe. One horizontal row that scrolls, so the list stays near the top.
 */
export function EventFilterBar({
  filters,
  onChange,
  nearLabel,
  onNearLabel,
  sheetOpen,
  onSheetOpen,
  bleed = 0,
  wrap = false,
  routeId,
}: EventFilterBarProps) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = sheetOpen ?? ownOpen;
  const setOpen = onSheetOpen ?? setOwnOpen;
  const pickWhen = (when: Exclude<EventWhen, 'upcoming'>) => {
    haptics.selection();
    onChange({ ...filters, when: filters.when === when ? 'upcoming' : when });
  };
  const pickType = (type: EventType) => {
    haptics.selection();
    onChange({ ...filters, type: filters.type === type ? null : type });
  };
  const distance = filters.near
    ? t('list.distanceActive', { distance: format.distance(filters.near.radiusKm) })
    : t('list.distance');
  const chips = (
    <>
      {WHEN_CHIPS.map((when) => (
        <Chip
          key={when}
          label={t(`list.when.${when}`)}
          selected={filters.when === when}
          selectionRole="radio"
          onPress={() => pickWhen(when)}
          testID={`${routeId}.filter.${when}`}
        />
      ))}
      <Chip
        label={distance}
        icon="map-pin"
        selected={filters.near !== null}
        selectionRole="checkbox"
        accessibilityLabel={nearLabel && filters.near ? `${distance}, ${nearLabel}` : distance}
        onPress={() => setOpen(true)}
        testID={`${routeId}.filter.near`}
      />
      {EVENT_TYPES.map((type) => (
        <Chip
          key={type}
          label={t(`type.${type}`)}
          selected={filters.type === type}
          selectionRole="radio"
          onPress={() => pickType(type)}
          testID={`${routeId}.filter.type.${type}`}
        />
      ))}
    </>
  );
  return (
    <>
      {wrap ? (
        <View
          style={styles.chips}
          role="toolbar"
          aria-label={t('list.filters')}
          testID={`${routeId}.filters`}
        >
          {chips}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={bleed ? { marginHorizontal: -bleed } : null}
          contentContainerStyle={[styles.row, bleed ? { paddingHorizontal: bleed } : null]}
          role="toolbar"
          aria-label={t('list.filters')}
          testID={`${routeId}.filters`}
        >
          {chips}
        </ScrollView>
      )}
      <NearSheet
        visible={open}
        current={filters.near}
        currentLabel={nearLabel}
        onClose={() => setOpen(false)}
        onApply={(near, label) => {
          onNearLabel(label);
          onChange({ ...filters, near });
          setOpen(false);
        }}
        routeId={routeId}
      />
    </>
  );
}

type Point = { lat: number; lng: number };

/**
 * "Entfernung": a point and a radius. The point is the member's location on the web (asked only now, used for this request and never
 * stored, 09 §8.7) or a place searched through the server's geocoder on submit (members; 60 an hour). Native location needs
 * expo-location, which is not in the app yet: there the place search is the way.
 */
function NearSheet({
  visible,
  current,
  currentLabel,
  onClose,
  onApply,
  routeId,
}: {
  visible: boolean;
  current: Filters['near'];
  currentLabel: string | null;
  onClose: () => void;
  onApply: (near: Filters['near'], label: string | null) => void;
  routeId: string;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const { kind } = useBreakpoint();
  const member = useSessionStore((state) => state.status === 'member');
  const geocode = useGeocode();
  const [query, setQuery] = useState('');
  const [point, setPoint] = useState<(Point & { label: string | null }) | null>(
    current ? { lat: current.lat, lng: current.lng, label: currentLabel } : null,
  );
  const [radius, setRadius] = useState<number>(current?.radiusKm ?? RADIUS_STEPS[1]);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const geolocation = isWeb && typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const locate = () => {
    if (!geolocation) return;
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Coarse on purpose (09 §8.7): two decimals, about a kilometre.
        setPoint({
          lat: Number(position.coords.latitude.toFixed(2)),
          lng: Number(position.coords.longitude.toFixed(2)),
          label: t('near.aroundMe'),
        });
      },
      () => {
        setLocating(false);
        setNotice(t('near.locationDenied'));
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15 * 1000 },
    );
  };

  const search = () => {
    const q = query.trim();
    if (q.length < 2 || !member) return;
    setNotice(null);
    geocode.mutate(q, {
      onSuccess: (rows) => {
        if (rows.length === 0) setNotice(t('near.noResults'));
      },
      onError: (error) =>
        setNotice(
          error instanceof ApiError && error.code === GEOCODE_UNAVAILABLE
            ? t('near.geocodeDown')
            : error instanceof ApiError
              ? error.message
              : t('near.geocodeDown'),
        ),
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('near.title')}
      narrow={kind !== 'phone'}
      footer={
        <View style={styles.actions}>
          <Button
            label={t('near.clear')}
            variant="tertiary"
            size="m"
            onPress={() => onApply(null, null)}
            testID={`${routeId}.near.clear`}
          />
          <Button
            label={t('near.apply')}
            size="m"
            disabled={!point}
            onPress={() =>
              point ? onApply({ lat: point.lat, lng: point.lng, radiusKm: radius }, point.label) : undefined
            }
            testID={`${routeId}.near.apply`}
          />
        </View>
      }
      testID={`${routeId}.near`}
    >
      <View style={styles.sheet}>
        {geolocation ? (
          <Button
            label={locating ? t('near.locating') : t('near.useLocation')}
            icon="navigation-arrow"
            variant="secondary"
            size="m"
            loading={locating}
            onPress={locate}
            testID={`${routeId}.near.locate`}
          />
        ) : null}
        {member ? (
          <View style={styles.search}>
            <TextInput
              label={t('near.searchLabel')}
              placeholder={t('near.searchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={search}
              returnKeyType="search"
              autoCorrect={false}
              containerStyle={styles.field}
              testID={`${routeId}.near.query`}
            />
            <Button
              label={t('near.search')}
              variant="secondary"
              size="l"
              loading={geocode.isPending}
              onPress={search}
              testID={`${routeId}.near.search`}
            />
          </View>
        ) : (
          <Text variant="callout" color="text.secondary">
            {t('near.signInToSearch')}
          </Text>
        )}
        {geocode.data && geocode.data.length > 0 ? (
          <View style={styles.results}>
            {geocode.data.map((place, index) => (
              <ListRow
                key={`${place.lat},${place.lng},${index}`}
                icon="map-pin"
                title={place.city ?? place.label}
                subtitle={place.label}
                role="button"
                chevron={false}
                selected={point?.lat === place.lat && point?.lng === place.lng}
                onPress={() => setPoint({ lat: place.lat, lng: place.lng, label: place.city ?? place.label })}
                divider={index < (geocode.data?.length ?? 0) - 1}
                testID={`${routeId}.near.result.${index}`}
              />
            ))}
          </View>
        ) : null}
        {notice ? (
          <Text variant="callout" color="text.secondary" role="alert" testID={`${routeId}.near.notice`}>
            {notice}
          </Text>
        ) : null}
        {point?.label ? (
          <Text variant="callout" testID={`${routeId}.near.point`}>
            {t('near.around', { place: point.label })}
          </Text>
        ) : null}
        <View style={styles.chips} role="radiogroup" aria-label={t('near.radiusLabel')}>
          {RADIUS_STEPS.map((km) => (
            <Chip
              key={km}
              label={t('near.radius', { distance: format.distance(km) })}
              selected={radius === km}
              selectionRole="radio"
              onPress={() => {
                haptics.selection();
                setRadius(km);
              }}
              testID={`${routeId}.near.radius.${km}`}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}
