import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';

import { SampleBadges, useSampleBadgeLabels, type SampleFlags } from './Badge';
import { Photo, type PhotoFields } from './Photo';
import { PressableScale } from './PressableScale';
import { joinLabel, useStacksAtFontScale } from './rowParts';
import { Text } from './Text';

export type GridTileProps = {
  /** Two lines at normal text, as many as it needs at a large font (ADR-128). Screen readers always get the full text. */
  title: string;
  /** "500 PS · AWD" */
  spec?: string;
  photo: PhotoFields;
  /** API flags (09 §8.19): "Beispiel" on a sample build's photo. */
  sample?: SampleFlags;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const TITLE_LINES = 2;

const useStyles = createStyles((t) => ({
  body: { borderRadius: t.radius.sm },
  hoverLayer: { backgroundColor: t.color.state.hover },
  text: { gap: t.space[2], marginTop: t.space[8] },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
}));

/**
 * §8 grid tile: 4:3 photo radius 8, `callout` title on two lines, one spec line in `caption`. §4 lifts the clamp at a
 * large font, because make and model are never cut (ADR-128).
 */
export function GridTile({ title, spec, photo, sample, onPress, style, testID }: GridTileProps) {
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const sampleLabels = useSampleBadgeLabels(sample);

  const content = (hovered: boolean) => (
    <>
      <Photo {...photo} aspect="4:3" corner="sm" testID={testID ? `${testID}.photo` : undefined}>
        {hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
        <SampleBadges flags={sample} tone="onPhoto" style={styles.badges} testID={testID ? `${testID}.sample` : undefined} />
      </Photo>
      <View style={styles.text}>
        {/* DQ-027: a clamped title ends in the ellipsis, not in a hyphen ("Sport-…"). */}
        <Text variant="callout" hyphenate={largeFont} numberOfLines={largeFont ? undefined : TITLE_LINES}>
          {title}
        </Text>
        {spec ? (
          <Text hyphenate={false} variant="caption" color="text.secondary">
            {spec}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {content(false)}
      </View>
    );
  }
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([...sampleLabels, title, spec])}
      onPress={onPress}
      testID={testID}
      style={style}
      contentStyle={styles.body}
    >
      {(state) => content(state.hovered)}
    </PressableScale>
  );
}
