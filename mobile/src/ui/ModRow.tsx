import { View, type StyleProp, type ViewStyle } from 'react-native';

import { keepShortNamesTogether } from '@/lib/format';
import { createStyles, size, space } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { joinLabel, RowBody, RowDivider, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { StatusPill } from './StatusPill';
import { Text } from './Text';
import { ValueText } from './ValueText';

export type ModRowProps = {
  /** Category glyph, for example `wheel` or `coilover`. */
  icon: IconName;
  /** "BBS LM" */
  name: string;
  /** "19″ × 9,5J ET35 · 255/35 R19" */
  values?: string;
  /** "Verbaut", "Geplant" */
  status?: string;
  /** [SIG `sig.mod_legal_status`] The owner's stated legal status, "Teilegutachten": a second pill of the same shape (§8). */
  legalStatus?: string;
  /** How screen readers name the legal pill, "Rechtlicher Status: Teilegutachten". Defaults to the pill's text. */
  legalStatusLabel?: string;
  onPress?: () => void;
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.single,
    paddingVertical: t.space[8],
  },
  text: { flex: 1, minWidth: 0 },
  // Under the text the pills wrap onto a second line rather than leave the column, at any width and font.
  pills: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[4], rowGap: t.space[4] },
  end: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: t.space[8] },
}));

/**
 * §8 mod row: category glyph 20, `body.strong` name, tabular figures on the numeric values, status pill, chevron. DQ-180: at
 * a large font the pill takes its own line under the text, because beside it the name would break after every syllable.
 *
 * The legal status [SIG] is a second pill that never sits beside the install status: two pills at the end would leave the name
 * about 70 wide at 360. It goes under the values, on the text's edge, and at a large font both pills share that line and wrap.
 */
export function ModRow({ icon, name, values, status, legalStatus, legalStatusLabel, onPress, divider = false, inset, style, testID }: ModRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const largeFont = useStacksAtFontScale();
  const pill = status ? <StatusPill label={status} testID={testID ? `${testID}.status` : undefined} /> : null;
  const legalName = legalStatus ? (legalStatusLabel ?? legalStatus) : undefined;
  const legalPill = legalStatus ? (
    <View accessible aria-label={legalName} testID={testID ? `${testID}.legalStatus` : undefined}>
      <StatusPill label={legalStatus} />
    </View>
  ) : null;
  const stackedPill = largeFont ? pill : null;
  return (
    <View testID={testID} style={style}>
      <RowBody
        onPress={onPress}
        label={joinLabel([name, values, status, legalName])}
        style={[styles.row, { paddingLeft: side, paddingRight: side }]}
        testID={testID ? `${testID}.body` : undefined}
      >
        <Icon name={icon} size={20} color="text.secondary" />
        <View style={styles.text}>
          <Text variant="bodyStrong">{keepShortNamesTogether(name)}</Text>
          {values ? <ValueText variant="callout" color="text.secondary" hyphenate={largeFont} values={values} wholeValues={!largeFont} /> : null}
          {stackedPill || legalPill ? (
            <View style={styles.pills} testID={testID ? `${testID}.pills` : undefined}>
              {stackedPill}
              {legalPill}
            </View>
          ) : null}
        </View>
        {(pill && !largeFont) || onPress ? (
          <View style={styles.end}>
            {largeFont ? null : pill}
            {onPress ? <Icon name="caret-right" size={16} color="text.tertiary" /> : null}
          </View>
        ) : null}
      </RowBody>
      {divider ? <RowDivider inset={side} lead={size.icon.m + space[12]} /> : null}
    </View>
  );
}
