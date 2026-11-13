import { memo } from 'react';
import { View } from 'react-native';

import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { Hairline, Icon, PressableScale, Text } from '@/ui';
import { joinLabel } from '@/ui/rowParts';

export type OptionRowProps = {
  label: string;
  /** "12 Builds", the facet count in words; the row shows the figure. */
  countLabel?: string;
  /** The figure shown at the end of the row. */
  formattedCount?: string;
  selected: boolean;
  /** `radio` for one value (sort, make, model), `checkbox` for a list. */
  role: 'radio' | 'checkbox';
  onPress: () => void;
  divider?: boolean;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  target: { alignSelf: 'stretch' },
  row: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.single,
    paddingVertical: t.space[8],
  },
  hover: { backgroundColor: t.color.state.hover },
  label: { flex: 1, minWidth: 0 },
  count: { fontVariant: ['tabular-nums'] },
  check: { alignItems: 'center', width: t.size.icon.m },
}));

/** A choice in a sheet: the name, its real count ("BMW · 12") and a check when chosen. 56 high, the whole row is the target. */
export const OptionRow = memo(function OptionRow({ label, countLabel, formattedCount, selected, role, onPress, divider = false, testID }: OptionRowProps) {
  const styles = useStyles();
  return (
    <View>
      <PressableScale
        // Draws its own pressed fill from state.pressed: no second tone layer (SM7).
        toneShift={false}
        role={role}
        aria-checked={selected}
        aria-label={isWeb ? undefined : joinLabel([label, countLabel])}
        onPress={onPress}
        style={styles.target}
        contentStyle={(state) => [styles.row, state.hovered || state.pressed ? styles.hover : null]}
        testID={testID}
      >
        <Text variant="body" hyphenate={false} style={styles.label}>
          {keepNameTogether(label)}
        </Text>
        {formattedCount !== undefined ? (
          <Text variant="callout" color="text.tertiary" style={styles.count} aria-label={countLabel} testID={testID ? `${testID}.count` : undefined}>
            {formattedCount}
          </Text>
        ) : null}
        <View style={styles.check}>{selected ? <Icon name="check" size={20} color="text.primary" /> : null}</View>
      </PressableScale>
      {divider ? <Hairline /> : null}
    </View>
  );
});
