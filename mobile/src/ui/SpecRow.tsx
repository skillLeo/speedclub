import { View, type StyleProp, type ViewStyle } from 'react-native';

import { isNumericValue } from '@/lib/format';
import { createStyles } from '@/theme';

import { RowDivider, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { Text } from './Text';

export type SpecRowProps = {
  /** "Leistung" */
  label: string;
  /** "500" */
  value: string;
  /** "PS" */
  unit?: string;
  /** Shown under the value when it is not the factory figure: "Besitzerangabe", "Gemessen". */
  provenance?: string;
  /** The hairline to the next row. */
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const NO_BREAK_SPACE = ' ';

const useStyles = createStyles((t) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[16],
    justifyContent: 'space-between',
    minHeight: t.space[48],
    paddingVertical: t.space[8],
  },
  rowStacked: { alignItems: 'stretch', flexDirection: 'column', gap: t.space[2] },
  label: { flexShrink: 1 },
  end: { alignItems: 'flex-end', flexShrink: 1 },
  endStacked: { alignItems: 'flex-start' },
  endText: { textAlign: 'right' },
  endTextStacked: { textAlign: 'left' },
  // `spec.value` is tabular. An empty list would not reset it on web, so a text value says what it wants.
  proportional: { fontVariant: ['proportional-nums'] },
}));

/**
 * §8 spec row: at least 48 high, label left, value right, provenance under non-factory values, hairline. At a large
 * font the value moves under the label, because beside it either one would be crushed.
 */
export function SpecRow({ label, value, unit, provenance, divider = true, inset, style, testID }: SpecRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const stacked = useStacksAtFontScale();
  const endText = stacked ? styles.endTextStacked : styles.endText;
  return (
    <View testID={testID} style={style}>
      <View accessible style={[styles.row, stacked ? styles.rowStacked : null, { paddingLeft: side, paddingRight: side }]}>
        <Text variant="supporting" color="text.secondary" hyphenate={false} style={styles.label}>
          {label}
        </Text>
        <View style={[styles.end, stacked ? styles.endStacked : null]}>
          <Text
            variant="specValue"
            hyphenate={false}
            style={[endText, isNumericValue(value) ? null : styles.proportional]}
            testID={testID ? `${testID}.value` : undefined}
          >
            {value}
            {unit ? (
              <Text variant="specUnit" color="text.secondary" hyphenate={false}>
                {NO_BREAK_SPACE}
                {unit}
              </Text>
            ) : null}
          </Text>
          {provenance ? (
            <Text
              variant="caption"
              color="text.tertiary"
              hyphenate={false}
              style={endText}
              testID={testID ? `${testID}.provenance` : undefined}
            >
              {provenance}
            </Text>
          ) : null}
        </View>
      </View>
      {divider ? <RowDivider inset={side} /> : null}
    </View>
  );
}
