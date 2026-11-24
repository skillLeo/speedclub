import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useVehicle } from '@/api/queries/garage';
import { SPOT_SETTING_KEYS, spotSettingsOf, type VehicleSpotSettings } from '@/api/queries/dex';
import { useUpdateSpotSettings } from '@/api/queries/dexOwner';
import { FormGroup } from '@/features/garage/components/fields';
import { SwitchRow } from '@/features/settings/components/SettingRows';
import { KnownTextSkeleton } from '@/features/vehicle/components/KnownTextSkeleton';
import { RowCard } from '@/features/vehicle/components/RowCard';
import { useOnline } from '@/state/online';
import { createStyles, size, space } from '@/theme';
import { ListRow } from '@/ui/ListRow';
import { SkeletonBlock } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';

import { ownerSpotsRoute } from '../navigation';

const COPY: Readonly<Record<keyof VehicleSpotSettings, { title: string; helper: string; id: string }>> = {
  ghost_mode: { title: 'settings.ghost', helper: 'settings.ghostHelper', id: 'ghost' },
  spotting_paused: { title: 'settings.pause', helper: 'settings.pauseHelper', id: 'pause' },
  hide_spot_cities: { title: 'settings.hideCities', helper: 'settings.hideCitiesHelper', id: 'hideCities' },
};

const useStyles = createStyles((t) => ({
  note: { paddingHorizontal: t.space[16], paddingTop: t.space[4] },
}));

/**
 * GAR-12 "Spots" (contract §1/§4/§5): Ghost-Modus, Spotten pausieren, Städte verbergen for this car, each saved at once
 * (`PATCH /vehicles/{id}`, optimistic, back with a toast on failure), and the way to the car's spots. They sit with the car's
 * visibility because Ghost is a visibility: the car leaves search, Entdecken and lists, and only a scan in person finds it.
 */
export function SpotSettings({ vehicleId, routeId, disabled = false }: { vehicleId: string; routeId: string; disabled?: boolean }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const vehicle = useVehicle(vehicleId);
  const update = useUpdateSpotSettings(vehicleId);
  const values = spotSettingsOf(vehicle.data);
  const testID = `${routeId}.spots`;

  const change = (key: keyof VehicleSpotSettings, next: boolean) =>
    update.mutate(
      { [key]: next },
      {
        onSuccess: () => toast(t('settings.saved'), { testID: `${testID}.saved` }),
        onError: () => toast(t('settings.failed'), { haptic: 'warning', testID: `${testID}.failed` }),
      },
    );

  return (
    <FormGroup title={t('settings.group')} testID={testID}>
      <RowCard>
        {SPOT_SETTING_KEYS.map((key) => (
          <SwitchRow
            key={key}
            title={t(COPY[key].title)}
            helper={t(COPY[key].helper)}
            value={values[key]}
            onValueChange={(next) => change(key, next)}
            disabled={disabled || !online}
            divider
            testID={`${testID}.${COPY[key].id}`}
          />
        ))}
        <ListRow icon="qr-sticker" title={t('settings.stats')} onPress={() => router.push(ownerSpotsRoute(vehicleId))} inset={space[16]} testID={`${testID}.stats`} />
      </RowCard>
      {online ? (
        // DQ-P5G-56: these switches save at once, unlike the page's "Speichern" below.
        <Text variant="caption" color="text.tertiary" style={styles.note} testID={`${testID}.instant`}>
          {t('settings.instant')}
        </Text>
      ) : (
        <Text variant="callout" color="text.secondary" style={styles.note} testID={`${testID}.offline`}>
          {t('settings.offline')}
        </Text>
      )}
    </FormGroup>
  );
}

const useSkeletonStyles = createStyles((t) => ({
  group: { gap: t.space[16], marginTop: t.space[8] },
  eyebrow: { marginBottom: t.space[8] - t.space[16] },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, padding: t.space[16] },
  text: { flex: 1, minWidth: 0 },
  caption: { paddingHorizontal: t.space[16] },
}));

/** GAR-12's skeleton of this group, in its geometry: the header, three switch rows with their helpers, the "Spots ansehen" row. */
export function SpotSettingsSkeleton() {
  const { t } = useTranslation('dex');
  const styles = useSkeletonStyles();
  return (
    <View style={styles.group}>
      <KnownTextSkeleton text={t('settings.group')} variant={SECTION_HEADER_ROLE} style={styles.eyebrow} />
      <View style={styles.card}>
        {SPOT_SETTING_KEYS.map((key) => (
          <View key={key} style={styles.row}>
            <View style={styles.text}>
              <KnownTextSkeleton text={t(COPY[key].title)} variant="body" />
              <KnownTextSkeleton text={t(COPY[key].helper)} variant="callout" />
            </View>
            <SkeletonBlock width={size.switch.width} height={size.switch.height} corner="full" />
          </View>
        ))}
        <View style={styles.row}>
          <SkeletonBlock width={size.icon.m} height={size.icon.m} />
          <KnownTextSkeleton text={t('settings.stats')} variant="body" style={styles.text} />
        </View>
      </View>
      <KnownTextSkeleton text={t('settings.instant')} variant="caption" style={styles.caption} />
    </View>
  );
}
