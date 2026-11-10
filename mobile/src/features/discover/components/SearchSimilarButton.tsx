import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import type { PublicMod } from '@/api/queries/vehicles';
import { Button } from '@/ui';

import { similarSearchHref, similarSearchState } from '../similarSearch';

export type SearchSimilarButtonProps = {
  mod: Pick<PublicMod, 'title' | 'brand' | 'search'>;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/** VEH-02 "Ähnliche suchen": DISC-02 with this mod's filters, for example wheel brand + diameter (contract §8). */
export function SearchSimilarButton({ mod, style, testID }: SearchSimilarButtonProps) {
  const { t } = useTranslation('discover');
  const router = useRouter();
  return (
    <Button
      label={t('searchSimilar.action')}
      accessibilityLabel={t('searchSimilar.label', { mod: mod.title })}
      variant="secondary"
      size="m"
      icon="magnifying-glass"
      role="link"
      onPress={() => router.navigate(similarSearchHref(similarSearchState(mod)))}
      style={style}
      testID={testID}
    />
  );
}
