import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { LARGE_FONT_SCALE } from '@/ui/rowParts';

/**
 * DQ-197: from 1.5 the full hint "Marke, Modell, Mods oder Mitglieder" no longer fits a 44 field on a phone and was cut
 * mid-word; the short one names the same kinds of search in the words that fit ("Marke, Modell, Mitglied").
 */
export function useSearchPlaceholder(): string {
  const { t } = useTranslation('discover');
  return useTheme().fontScale >= LARGE_FONT_SCALE ? t('search.placeholderShort') : t('search.placeholder');
}
