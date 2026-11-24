import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space, typography, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import type { IconName } from './icons/Icon';
import { SampleBadges, useSampleBadgeLabels, type SampleFlags } from './Badge';
import { WithoutForcedState } from './qaVisualState';
import { joinLabel, RowBody, RowDivider, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { Text } from './Text';
import { metaLineText } from './textBreaks';

export type MemberRowProps = {
  name: string;
  /** "@lukas.sc · Stuttgart" */
  meta?: string;
  avatarUri?: string | null;
  avatarBlurhash?: string | null;
  /** A glyph in the avatar slot in place of initials, for a person who is not named (Avatar `icon`). */
  avatarIcon?: IconName;
  /** API flags (09 §8.19): "Editorial" / "Beispiel" under the name of the Editorial account or a sample member. */
  sample?: SampleFlags;
  onPress?: () => void;
  /** §8: the Follow button, size M. It sits beside the pressable part, because controls must not nest. */
  trailing?: ReactNode;
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  root: { alignItems: 'center', flexDirection: 'row' },
  rootStacked: { alignItems: 'flex-start', flexDirection: 'column' },
  boxInline: { flex: 1, minWidth: 0 },
  boxStacked: { alignSelf: 'stretch' },
  body: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.single,
    paddingVertical: t.space[8],
  },
  text: { flex: 1, minWidth: 0 },
  badges: { marginTop: t.space[4] },
  trailing: { flexShrink: 0 },
  // DQ-053: the pressed fill of the row ends 8 before the button.
  trailingInline: { paddingLeft: t.space[8] },
  trailingStacked: { paddingBottom: t.space[12] },
}));

/**
 * The meta line of a member ("@lukas.sc · Stuttgart", "@max.e46 · Subaru Impreza WRX STI GD"): it may wrap between words, never
 * inside one (M2.2 test D1). A line wraps at its "·" first: a short part ("Frankfurt am Main") stays whole, a longer one may wrap at
 * its own spaces, and a line without a "·" ("Blockiert am 24.10.2026") wraps between its words (DQ-278). A hyphenated name stays
 * whole ("GT-R"), a handle breaks only after its "." or "_" (DQ-282), and the "·" stays at the end of the part before it.
 */
export function memberMetaText(meta: string): string {
  return metaLineText(meta);
}

/** "@lukas.sc · Stuttgart" → the leading handle and the rest; null when the meta does not start with a handle. */
export function splitMetaHandle(meta: string): { handle: string; rest: string } | null {
  const at = meta.indexOf(' · ');
  const first = at < 0 ? meta : meta.slice(0, at);
  if (!/^@\S+$/.test(first)) return null;
  return { handle: first, rest: at < 0 ? '' : meta.slice(at + ' · '.length) };
}

/**
 * An upper bound of the advance of a handle's characters in Inter Medium, in em (the bound Text's title rule uses: lowercase
 * runs measure 0.50–0.56, "m" and "w" pull a handle up).
 */
const HANDLE_ADVANCE = 0.6;

/**
 * Whether a handle surely fits one line `width` wide in `callout` at `fontScale`. A handle breaks only after "." or "_" (DQ-282);
 * one without them ("@wolfgangschwarzenberger", up to 24 characters) that is wider than the line has no place to break, so the
 * row then sets it on a line of its own, cut with an ellipsis (m4.18 final gate, HOME-01 suggestions at 200 %).
 */
export function handleFitsLine(handle: string, width: number, fontScale: number): boolean {
  return [...handle].length * typography.callout.fontSize * fontScale * HANDLE_ADVANCE <= width;
}

/**
 * A name that is only the username ("@lukas.sc", when there is no display name): one word, which must not be hyphenated. It is
 * one line, cut with an ellipsis where it is wider than its column, as the identity card sets it (DQ-1017): a handle without "."
 * or "_" ("@gmwfgv0nd9wtp21") has no place to break, and at 200 % the browser then split it inside its letters (m4.18 final gate,
 * HOME-01 suggestions). Text keeps the whole handle as the accessible name of a cut line.
 */
const isHandle = (name: string) => name.startsWith('@');

/** §8 member row: avatar 40, `body.strong` name, `supporting` meta, trailing Follow button. */
export function MemberRow({ name, meta, avatarUri, avatarBlurhash, avatarIcon, sample, onPress, trailing, divider = false, inset, style, testID }: MemberRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const largeFont = useStacksAtFontScale();
  const stacked = largeFont && Boolean(trailing);
  const sampleLabels = useSampleBadgeLabels(sample);
  const { fontScale } = useTheme();
  // The text column's width, for the handle rule (handleFitsLine); 0 until the first layout, which keeps the one-line meta.
  const [textWidth, setTextWidth] = useState(0);
  const onTextLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setTextWidth((current) => (Math.abs(current - next) < 1 ? current : next));
  };
  const metaHandle = meta ? splitMetaHandle(meta) : null;
  const handleOwnLine = metaHandle !== null && textWidth > 0 && !handleFitsLine(metaHandle.handle, textWidth, fontScale);
  return (
    <View testID={testID} style={[stacked ? styles.rootStacked : styles.root, style]}>
      <RowBody
        onPress={onPress}
        label={joinLabel([name, ...sampleLabels, meta])}
        boxStyle={stacked ? styles.boxStacked : styles.boxInline}
        style={[styles.body, { paddingLeft: side, paddingRight: side }]}
        testID={testID ? `${testID}.body` : undefined}
      >
        <Avatar decorative name={name} uri={avatarUri} blurhash={avatarBlurhash} icon={avatarIcon} size={size.avatar.md} />
        <View style={styles.text} onLayout={onTextLayout} testID={testID ? `${testID}.text` : undefined}>
          {isHandle(name) ? (
            <Text variant="bodyStrong" hyphenate={false} numberOfLines={1} testID={testID ? `${testID}.name` : undefined}>
              {name}
            </Text>
          ) : (
            <Text variant="bodyStrong" testID={testID ? `${testID}.name` : undefined}>
              {name}
            </Text>
          )}
          {meta && metaHandle && handleOwnLine ? (
            <>
              <Text variant="callout" color="text.secondary" hyphenate={false} numberOfLines={1} testID={testID ? `${testID}.handle` : undefined}>
                {metaHandle.handle}
              </Text>
              {metaHandle.rest ? (
                <Text variant="callout" color="text.secondary" hyphenate={false}>
                  {memberMetaText(metaHandle.rest)}
                </Text>
              ) : null}
            </>
          ) : meta ? (
            <Text variant="callout" color="text.secondary" hyphenate={false}>
              {memberMetaText(meta)}
            </Text>
          ) : null}
          <SampleBadges flags={sample} style={styles.badges} testID={testID ? `${testID}.sample` : undefined} />
        </View>
      </RowBody>
      {trailing ? (
        <View
          style={[
            styles.trailing,
            stacked ? styles.trailingStacked : styles.trailingInline,
            stacked ? { paddingLeft: side } : { paddingRight: side },
          ]}
        >
          <WithoutForcedState>{trailing}</WithoutForcedState>
        </View>
      ) : null}
      {divider ? <RowDivider inset={side} lead={size.avatar.md + space[12]} /> : null}
    </View>
  );
}
