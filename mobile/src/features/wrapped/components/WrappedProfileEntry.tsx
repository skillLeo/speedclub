import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { latestReleased, useMyWrapped, type WrappedSeason } from '@/api/queries/wrapped';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';

import { seasonName } from '../model';
import '../qaWrapped';

/** The newest released season the PROF-01 row opens, or null (none yet, a guest, the feature off). */
export function useWrappedEntrySeason(): WrappedSeason | null {
  const query = useMyWrapped();
  return query.data ? latestReleased(query.data.seasons) : null;
}

/**
 * PROF-01 (own profile only, contract §6): "Mein Wrapped" with the season under it ("Saison 2026", DQ-P5G-52: the year once) once
 * `GET me/wrapped` lists a released season, the newest one; "Neu" until it was opened. Nothing at all before the first release, for
 * a guest, or while the feature is off (the read answers 404). DQ-P5G-66: a row of one group with "Mein Dex", one possessive for
 * both; the caller draws the group.
 */
export function WrappedProfileEntry({ routeId, divider = false }: { routeId: string; divider?: boolean }) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const season = useWrappedEntrySeason();
  if (!season) return null;
  return (
    <ListRow
      icon="calendar-blank"
      title={t('wrapped.entry.row')}
      subtitle={seasonName(t, season.season_key)}
      value={season.viewed_at ? undefined : t('wrapped.entry.new')}
      onPress={() => router.push({ pathname: '/wrapped/[season]', params: { season: season.season_key } })}
      divider={divider}
      inset={space[16]}
      testID={`${routeId}.wrapped`}
    />
  );
}
