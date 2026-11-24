import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Icon } from '@/ui/icons/Icon';
import { Text } from '@/ui/Text';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type AiLabelProps = {
  /** The server's label, "KI-Vorschlag" or "Übersetzt" (EU AI Act Art. 50), in the request's language. */
  label: string;
  /**
   * `suggestion`: the text label alone (09 §4.5: AI features carry "KI-Vorschlag", no icon); `translation`: the translate glyph,
   * which says what happened to the text, not that a machine did it.
   */
  kind?: 'suggestion' | 'translation';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The disclosure on every AI output: glyph and the label in `caption`, text.secondary; neutral, never the accent. */
export function AiLabel({ label, kind = 'suggestion', style, testID }: AiLabelProps) {
  const styles = useStyles();
  return (
    <View style={[styles.row, style]} testID={testID}>
      {kind === 'translation' ? <Icon name="translate" size={16} color="text.secondary" /> : null}
      <Text variant="caption" color="text.secondary">
        {label}
      </Text>
    </View>
  );
}
