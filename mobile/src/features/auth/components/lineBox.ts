import { PixelRatio, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { maxFontScale, typography, useTheme, type SizedTypeVariant, type TypeVariant } from '@/theme';

/**
 * A box as tall as the first line of `variant`, so an icon beside wrapping text stays centred on that line at any font
 * scale instead of drifting to its top.
 */
export function useFirstLineBox(variant: SizedTypeVariant): ViewStyle {
  const theme = useTheme();
  const requested = isWeb ? theme.fontScale : PixelRatio.getFontScale();
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  const scale = Math.min(requested, cap ?? requested);
  return { height: typography[variant].lineHeight * scale, justifyContent: 'center' };
}
