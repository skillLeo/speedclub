import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, typography, useBreakpoint, useTheme } from '@/theme';

import { Text } from './Text';

export type OfflineBannerProps = {
  /** Replaces the common offline copy. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Between one and two lines: any text taller than this has wrapped. */
const WRAPPED_LINES = 1.5;

const useStyles = createStyles((t) => ({
  // ADR-119: one line sits in the 32 of §8. The specified copy needs about 400 wide, so a phone wraps it, with 8 around.
  banner: { backgroundColor: t.color.bg.raised, justifyContent: 'center', minHeight: t.space[32], paddingVertical: t.space[4] },
  bannerWrapped: { paddingVertical: t.space[8] },
}));

/** §8 offline banner: top of the screen, at least 32 high, bg.raised, `supporting`. */
export function OfflineBanner({ label, style, testID }: OfflineBannerProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const { gutter } = useBreakpoint();
  const [textHeight, setTextHeight] = useState(0);
  const wrapped = textHeight > typography.callout.lineHeight * theme.fontScale * WRAPPED_LINES;
  return (
    <View
      role="status"
      aria-live="polite"
      testID={testID}
      style={[styles.banner, wrapped ? styles.bannerWrapped : null, { paddingLeft: gutter, paddingRight: gutter }, style]}
    >
      <Text
        variant="callout"
        hyphenate={false}
        onLayout={(event) => setTextHeight(event.nativeEvent.layout.height)}
        testID={testID ? `${testID}.text` : undefined}
      >
        {label ?? t('states.offline')}
      </Text>
    </View>
  );
}
