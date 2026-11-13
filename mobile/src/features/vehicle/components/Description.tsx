import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { joinShortCompounds } from '@/lib/format';
import { createStyles } from '@/theme';
import { PressableScale, Text } from '@/ui';

/** 09 §7.6 Übersicht (DQ-1056): four lines at every font scale, then "Mehr anzeigen". */
export const DESCRIPTION_LINES = 4;

const useStyles = createStyles((t) => ({
  // The full text, laid out at the same width and never seen, so the clamp knows whether it hides anything. Measuring
  // beats counting lines: React Native Web reports no text layout, and iOS reports only the visible lines.
  // Not clipped by an overflow box: a clipping parent would itself read as cut-off text to the DOM audit.
  probe: { left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  toggle: { alignSelf: 'flex-start', marginTop: t.space[4] },
  toggleVisual: { justifyContent: 'center', minHeight: t.size.touchMin },
}));

export type DescriptionProps = {
  text: string;
  style?: StyleProp<ViewStyle>;
  /** On the text, as WEB-01's `VEH-01.description`. */
  testID?: string;
  /** On the toggle, as WEB-01's `VEH-01.more`. */
  moreTestID?: string;
};

/** The owner's description (≤ 500): line breaks kept, clamped to four lines with a toggle when it is longer. */
export function Description({ text, style, testID, moreTestID }: DescriptionProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  // r5 VEH-01: the owner's words never break beside a short part of a compound ("GT-SS- / Ladern"); display only.
  const shown = joinShortCompounds(text);
  const [clampedHeight, setClampedHeight] = useState(0);
  const [fullHeight, setFullHeight] = useState(0);
  // One point of tolerance for rounding between the two layouts.
  const overflows = fullHeight > clampedHeight + 1;

  return (
    <View style={style}>
      <View>
        <Text
          variant="body"
          numberOfLines={expanded ? undefined : DESCRIPTION_LINES}
          onLayout={(event) => {
            if (!expanded) setClampedHeight(event.nativeEvent.layout.height);
          }}
          testID={testID}
        >
          {shown}
        </Text>
        {expanded ? null : (
          <Text variant="body" aria-hidden style={styles.probe} onLayout={(event) => setFullHeight(event.nativeEvent.layout.height)}>
            {shown}
          </Text>
        )}
      </View>
      {overflows || expanded ? (
        <PressableScale
          role="button"
          aria-expanded={expanded}
          onPress={() => setExpanded((open) => !open)}
          style={styles.toggle}
          contentStyle={styles.toggleVisual}
          testID={moreTestID}
        >
          <Text variant="bodyStrong" color="text.secondary" selectable={false}>
            {expanded ? t('actions.showLess') : t('actions.showMore')}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
