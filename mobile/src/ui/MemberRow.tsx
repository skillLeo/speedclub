import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space } from '@/theme';

import { Avatar } from './Avatar';
import { WithoutForcedState } from './qaVisualState';
import { joinLabel, RowBody, RowDivider, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { Text } from './Text';
import { handleText, metaLineText } from './textBreaks';

export type MemberRowProps = {
  name: string;
  /** "@lukas.sc · Stuttgart" */
  meta?: string;
  avatarUri?: string | null;
  avatarBlurhash?: string | null;
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

/** A name that is only the username ("@lukas.sc", when there is no display name): one word, which must not be hyphenated. */
const isHandle = (name: string) => name.startsWith('@');

/** §8 member row: avatar 40, `body.strong` name, `supporting` meta, trailing Follow button. */
export function MemberRow({ name, meta, avatarUri, avatarBlurhash, onPress, trailing, divider = false, inset, style, testID }: MemberRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const largeFont = useStacksAtFontScale();
  const stacked = largeFont && Boolean(trailing);
  return (
    <View testID={testID} style={[stacked ? styles.rootStacked : styles.root, style]}>
      <RowBody
        onPress={onPress}
        label={joinLabel([name, meta])}
        boxStyle={stacked ? styles.boxStacked : styles.boxInline}
        style={[styles.body, { paddingLeft: side, paddingRight: side }]}
        testID={testID ? `${testID}.body` : undefined}
      >
        <Avatar decorative name={name} uri={avatarUri} blurhash={avatarBlurhash} size={size.avatar.md} />
        <View style={styles.text}>
          <Text variant="bodyStrong" hyphenate={!isHandle(name)}>
            {isHandle(name) ? handleText(name) : name}
          </Text>
          {meta ? (
            <Text variant="supporting" color="text.secondary" hyphenate={false}>
              {memberMetaText(meta)}
            </Text>
          ) : null}
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
