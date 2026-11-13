import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { MAINTENANCE_FLAG, useMaintenanceItems } from '@/api/queries/maintenance';
import { formatMonthYear } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Chip } from '@/ui';

import { monthDate } from '../model';

const useStyles = createStyles(() => ({
  root: { alignItems: 'flex-start' },
}));

/** The vehicle's HU/AU item with its month, or null (no item, flag off, or `vehicleId` empty: not the owner). */
export function useNextHu(vehicleId: string) {
  const flag = useFlag(MAINTENANCE_FLAG);
  const items = useMaintenanceItems(flag ? vehicleId : '');
  const hu = items.data?.items.find((item) => item.type === 'hu_au' && item.next_due.month);
  const month = hu?.next_due.month ? monthDate(hu.next_due.month) : null;
  return flag && vehicleId && hu && month ? { hu, month } : null;
}

/**
 * GAR-02 / VEH-01 for the owner (M4.13): "Nächste HU: März 2027" from the vehicle's HU/AU item, opening MNT-01. Owner only and
 * private like all maintenance; nothing without an HU/AU item or with the `maintenance` flag off.
 */
export function NextHuChip({ vehicleId, routeId }: { vehicleId: string; routeId: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const next = useNextHu(vehicleId);
  if (!next) return null;
  const { hu, month } = next;
  const text = formatMonthYear(month, format.locale);
  return (
    <View style={styles.root}>
      <Chip
        label={hu.state === 'overdue' ? t('maintenance.huChipOverdue', { month: text }) : t('maintenance.huChip', { month: text })}
        icon="hu-plakette"
        onPress={() => router.push(`/garage/${vehicleId}/maintenance`)}
        testID={`${routeId}.nextHu`}
      />
    </View>
  );
}
