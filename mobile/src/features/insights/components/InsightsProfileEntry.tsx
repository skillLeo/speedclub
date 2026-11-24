import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import { INSIGHTS_FLAG } from '@/api/queries/insights';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';

import { insightsHref } from '../navigation';

/** Whether PROF-01 offers "Statistiken": while the `insights` flag is on. */
export function useInsightsEntry(): boolean {
  return useFlag(INSIGHTS_FLAG);
}

/**
 * PROF-01 (own profile only, 10 §6.1): "Statistiken" opens INS-01 for the profile and every car. A row of the profile's one group with
 * "Mein Dex" and "Mein Wrapped"; no number on the row (the numbers stay on the owner's own page). The caller draws the group and asks
 * `useInsightsEntry` first.
 */
export function InsightsProfileEntry({ routeId, divider = false }: { routeId: string; divider?: boolean }) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  return (
    <ListRow
      icon="chart-bar"
      title={t('insights.entry.row')}
      subtitle={t('insights.entry.profileSubtitle')}
      onPress={() => router.push(insightsHref())}
      role="link"
      divider={divider}
      inset={space[16]}
      testID={`${routeId}.insights`}
    />
  );
}
