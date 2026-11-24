import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ALL_FILTER, useMyDex } from '@/api/queries/dex';
import { useFormat } from '@/lib/useFormat';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';

import { DEX_HOME_ROUTE } from '../navigation';
import { QA_META, qaDexActive } from '../qaDex';

/**
 * PROF-01 (own profile only, contract §8): the row "Mein Dex" with "87 / 1.240" (tnum) once the Dex has loaded; opens DEX-01. The
 * progress shares DEX-01's cache, so the screen opens on what the row showed. A row of the profile's one group with "Mein Wrapped"
 * (DQ-P5G-66): the caller draws the group, `divider` when a row follows.
 */
export function DexProfileEntry({ routeId, divider = false }: { routeId: string; divider?: boolean }) {
  const { t } = useTranslation('dex');
  const router = useRouter();
  const format = useFormat();
  const sample = qaDexActive();
  const query = useMyDex(ALL_FILTER, !sample);
  const meta = sample ? QA_META : query.data?.pages[0]?.meta;
  const value = meta ? t('profile.value', { found: format.number(meta.found), total: format.number(meta.total) }) : undefined;
  return (
    <ListRow
      icon="qr-sticker"
      title={t('profile.row')}
      value={value}
      onPress={() => router.push(DEX_HOME_ROUTE)}
      divider={divider}
      inset={space[16]}
      testID={`${routeId}.dex`}
    />
  );
}
