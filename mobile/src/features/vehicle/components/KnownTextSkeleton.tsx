import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, maxFontScale, typography, typographyDesktop, useTheme, type SizedTypeVariant, type TypeVariant } from '@/theme';
import { SkeletonText, Text } from '@/ui';
import { useDesktopType } from '@/ui/Text';

import { estimatedTextWidth } from '../skeletonGeometry';

const useStyles = createStyles(() => ({
  // The real text, invisible, in the width the skeleton line has. Out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
}));

/**
 * The lines a box of this height holds in a type variant, with the font scale and its cap as SkeletonText draws them; `desktop`:
 * in the role's web desktop line box, as Text and SkeletonText take it at layout.breakpoints.desktop (body 24, not 22).
 */
export function linesInHeight(height: number, variant: SizedTypeVariant, fontScale: number, desktop: boolean = false): number {
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  const desktopType = desktop ? (typographyDesktop as Partial<Record<SizedTypeVariant, { lineHeight: number }>>)[variant] : undefined;
  const lineHeight = (desktopType ?? typography[variant]).lineHeight;
  return Math.max(1, Math.round(height / (lineHeight * Math.min(fontScale, cap ?? fontScale))));
}

export type KnownTextSkeletonProps = {
  /** The copy the page will set here. */
  text: string;
  variant: SizedTypeVariant;
  /** As the page's Text, so both break at the same places. */
  hyphenate?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * DQ-214, §8 "matching final geometry": the skeleton of a text the screen already knows. The real string lays itself out
 * invisibly in the same box, and the lines drawn are the lines it takes, in every language and at every width and font
 * scale, where a character estimate is a line off. The Skeleton stays hidden for 300 ms, longer than the measure takes.
 */
export function KnownTextSkeleton({ text, variant, hyphenate, style, testID }: KnownTextSkeletonProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const lines = box.height > 0 ? linesInHeight(box.height, variant, fontScale, desktop) : 1;
  const oneLine = box.width > 0 ? box.width : estimatedTextWidth(text, variant, fontScale);
  return (
    <View style={style}>
      <SkeletonText variant={variant} lines={lines} width={lines > 1 ? '100%' : oneLine} testID={testID} />
      <View aria-hidden style={styles.measure}>
        <Text
          variant={variant}
          hyphenate={hyphenate}
          selectable={false}
          onLayout={(event) => setBox({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}
