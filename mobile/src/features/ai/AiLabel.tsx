import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type AiLabelProps = {
  /** The server's label, "KI-Vorschlag" or "Übersetzt" (EU AI Act Art. 50), in the request's language. */
  label: string;
  /** `suggestion`: a lightbulb; `translation`: the translate glyph. Phosphor, never sparkles (M3.7 §2). */
  kind?: 'suggestion' | 'translation';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The disclosure on every AI output: glyph and the label in `caption`, text.secondary; neutral, never the accent. */
export function AiLabel({ label, kind = 'suggestion', style, testID }: AiLabelProps) {
  const styles = useStyles();
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Icon name={kind === 'translation' ? 'translate' : 'lightbulb'} size={16} color="text.secondary" />
      <Text variant="caption" color="text.secondary">
        {label}
      </Text>
    </View>
  );
}
