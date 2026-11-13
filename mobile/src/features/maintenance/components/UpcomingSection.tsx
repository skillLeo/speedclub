import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { MAINTENANCE_FLAG, useUpcomingMaintenance, type MaintenanceUpcoming } from '@/api/queries/maintenance';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { MaintenanceCard } from '@/ui';
import { RowGroup } from '@/ui/RowGroup';

import { dueModel } from '../model';
import { useDistanceUnit } from '../units';

const ROUTE = 'GAR-01';

const useStyles = createStyles((t) => ({
  root: { paddingBottom: t.space[32] },
}));

/**
 * GAR-01 "Nächste Fälligkeiten" (09 §8.8): overdue items first, then those due within 60 days or 1,000 km, across the member's
 * vehicles, each with its car; a row opens that car's MNT-01. Nothing at all while there is nothing due (the garage stays the
 * cars' page), and nothing while the `maintenance` flag is off. It also keeps the local reminder backups in step (ADR-441).
 */
export function UpcomingSection() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const unit = useDistanceUnit();
  const qaState = useQaState();
  const flag = useFlag(MAINTENANCE_FLAG);
  const query = useUpcomingMaintenance(flag);
  const rows: MaintenanceUpcoming[] = qaState === 'empty' ? [] : (query.data ?? []);
  if (!flag || rows.length === 0) return null;
  return (
    <View style={styles.root} testID={`${ROUTE}.due`}>
      <RowGroup title={t('maintenance.upcoming.title')}>
        {rows.map((item, index) => {
          const model = dueModel(t, item, unit, format.locale);
          return (
            <MaintenanceCard
              key={item.id}
              title={model.title}
              subtitle={item.vehicle.full_title}
              glyph={model.glyph}
              due={model.due}
              countdown={model.countdown}
              tone={model.tone}
              progress={model.progress}
              divider={index < rows.length - 1}
              onPress={() => router.push(`/garage/${item.vehicle_id}/maintenance`)}
              testID={`${ROUTE}.due.${item.id}`}
            />
          );
        })}
      </RowGroup>
    </View>
  );
}
