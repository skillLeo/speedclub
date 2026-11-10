import { View } from 'react-native';

import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { createStyles } from '@/theme';
import { Hairline, ListRow, Radio, Switch, Text } from '@/ui';

import { ROW_INSET } from './ValueRow';

const useStyles = createStyles((t) => ({
  radioRow: { justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: ROW_INSET, paddingVertical: t.space[4] },
  // Under the label, past the 22 radio and its 12 gap: a slot as wide as the radio, so every spacing stays on the scale.
  radioHelper: { flexDirection: 'row', gap: t.space[12], paddingBottom: t.space[8] },
  radioSlot: { width: t.size.checkbox },
  radioHelperText: { flex: 1 },
}));

export type SwitchRowProps = {
  title: string;
  /** What the switch does, in one or two plain sentences (SET-07, SET-09). */
  helper?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
  testID: string;
};

/**
 * A row of a grouped list with a switch: title, the effect under it, the switch beside. The switch is `<testID>.switch`.
 * Disabled (offline, restricted) dims the switch only: the row itself is no control, and its text keeps its colours, which pass
 * AA, while text.disabled would not (M2.8 axe on SET-07).
 */
export function SwitchRow({ title, helper, value, onValueChange, disabled, divider, testID }: SwitchRowProps) {
  // View-as (m3.2-contract §3): every setting is read-only.
  const readOnly = useViewAsReadOnly();
  return (
    <ListRow
      title={title}
      subtitle={helper}
      inset={ROW_INSET}
      divider={divider}
      control={<Switch value={value} onValueChange={onValueChange} label={title} disabled={disabled || readOnly} testID={`${testID}.switch`} />}
      testID={testID}
    />
  );
}

export type RadioOption<T extends string> = { value: T; label: string; helper?: string };

export type RadioRowsProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  options: readonly RadioOption<T>[];
  /** Null: nothing chosen yet (SET-15 category). */
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Each option is `<testID>.<value>`. */
  testID: string;
};

/** A radio list inside a grouped card: one row per option, its effect under the label, hairlines between. */
export function RadioRows<T extends string>({ label, options, value, onChange, disabled, testID }: RadioRowsProps<T>) {
  const styles = useStyles();
  const readOnly = useViewAsReadOnly();
  return (
    <View role="radiogroup" aria-label={label} testID={testID}>
      {options.map((option, index) => (
        <View key={option.value}>
          <View style={styles.radioRow}>
            <Radio
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              label={option.label}
              showLabel
              alignFirstLine
              disabled={disabled || readOnly}
              // DQ-444: as SwitchRow, disabled dims the control only; title and helper keep their hierarchy.
              dimLabel={false}
              testID={`${testID}.${option.value}`}
            />
            {option.helper ? (
              <View style={styles.radioHelper}>
                <View style={styles.radioSlot} />
                <Text variant="supporting" color="text.secondary" style={styles.radioHelperText} testID={`${testID}.${option.value}.helper`}>
                  {option.helper}
                </Text>
              </View>
            ) : null}
          </View>
          {index < options.length - 1 ? <Hairline inset={ROW_INSET} /> : null}
        </View>
      ))}
    </View>
  );
}
