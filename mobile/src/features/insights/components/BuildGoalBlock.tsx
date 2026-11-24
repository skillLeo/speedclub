import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { INSIGHTS_FLAG, useInsights } from '@/api/queries/insights';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space, typography, useTheme } from '@/theme';
import { Icon } from '@/ui/icons/Icon';
import { ListRow } from '@/ui/ListRow';
import { Text } from '@/ui/Text';
import { RowGroup } from '@/ui/RowGroup';

import { goalVisibleTo } from '../model';
import { insightsHref } from '../navigation';
import { BuildGoalSheet } from './BuildGoalSheet';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  line: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  lineText: { flexShrink: 1 },
}));

/** Whether the goal block has anything for this viewer (VEH-01 asks before it draws the Build-Fortschritt slot). */
export function hasVisibleGoal(vehicle: Pick<PublicVehicle, 'build_goal'>, owner: boolean): boolean {
  return goalVisibleTo((vehicle as Partial<Pick<PublicVehicle, 'build_goal'>>).build_goal, owner);
}

/** The glyph on the first line of the callout, whatever the font scale. */
function useFirstLineBox() {
  const { fontScale } = useTheme();
  return { height: typography.callout.lineHeight * Math.min(fontScale, 1.3), justifyContent: 'center' as const };
}

export type BuildGoalBlockProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** The viewer owns the car (VEH-01 `is_owner`, GAR-02). */
  owner: boolean;
  /** The Build-Fortschritt card, when the page draws one. */
  children?: ReactNode;
};

/**
 * 10 §6.1/§6.2 next to Build-Fortschritt in Überblick (VEH-01 and GAR-02), apart from the vehicle lane's components:
 * - a visitor reads "Ziel: Saison 2027" under the card while the goal is set and its season not over;
 * - the owner gets one grouped list: "Build-Ziel" (opens the goal sheet; a passed season offers a new one) and, for a published car
 *   while `insights` is on, "Statistiken" with this week's views, which opens INS-01 for this car.
 * No countdown, no reminder: the goal is the owner's own statement.
 */
export function BuildGoalBlock({ vehicle, routeId, owner, children }: BuildGoalBlockProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const firstLine = useFirstLineBox();
  const [editing, setEditing] = useState(false);
  const goal = (vehicle as Partial<Pick<PublicVehicle, 'build_goal'>>).build_goal ?? null;
  const insightsOn = useFlag(INSIGHTS_FLAG);
  const withStats = owner && insightsOn && vehicle.status === 'published';
  const stats = useInsights({ kind: 'vehicle', vehicleId: vehicle.id }, withStats);
  const views = stats.data?.views.this_week;

  if (!owner) {
    return (
      <View style={styles.root}>
        {children}
        {goalVisibleTo(goal, false) ? (
          <View style={styles.line} testID={`${routeId}.goal`}>
            <View style={firstLine}>
              <Icon name="flag-checkered" size={20} color="text.secondary" />
            </View>
            <Text variant="callout" color="text.secondary" style={styles.lineText} testID={`${routeId}.goal.label`}>
              {t('insights.goal.label', { season: goal.season })}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  const goalValue = !goal ? t('insights.goal.notSet') : goal.passed ? t('insights.goal.newGoal') : t('insights.goal.season', { season: goal.season });
  return (
    <View style={styles.root}>
      {children}
      <RowGroup testID={`${routeId}.ownerRows`}>
        <ListRow
          icon="flag-checkered"
          title={t('insights.goal.row')}
          subtitle={goal?.passed ? t('insights.goal.passedRow', { season: goal.season }) : undefined}
          value={goalValue}
          onPress={() => setEditing(true)}
          accessibilityTitle={t('insights.goal.rowLabel')}
          inset={space[16]}
          divider={withStats}
          testID={`${routeId}.goal`}
        />
        {withStats ? (
          <ListRow
            icon="chart-bar"
            title={t('insights.entry.row')}
            value={views === undefined ? undefined : t('insights.entry.value', { count: views, value: format.number(views) })}
            onPress={() => router.push(insightsHref(vehicle.id))}
            role="link"
            inset={space[16]}
            testID={`${routeId}.insights`}
          />
        ) : null}
      </RowGroup>
      <BuildGoalSheet vehicle={vehicle} goal={goal} visible={editing} onClose={() => setEditing(false)} testID={`${routeId}.goalSheet`} />
    </View>
  );
}
