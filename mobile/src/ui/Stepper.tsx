import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { WithoutForcedState } from './qaVisualState';
import { Text } from './Text';

export type StepperProps = {
  value: number;
  onChange: (next: number) => void;
  /** Accessible name of the group. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Defaults to the locale's number format. */
  formatValue?: (value: number) => string;
  /** Replace the labels from namespace common. */
  decreaseLabel?: string;
  increaseLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    minHeight: t.size.stepper,
  },
  target: { alignSelf: 'stretch', width: t.size.touchMin },
  visual: { alignItems: 'center', borderRadius: t.radius.sm, justifyContent: 'center', minHeight: t.size.stepper },
  hover: { backgroundColor: t.color.state.hover },
  pressed: { backgroundColor: t.color.state.pressed },
  value: { minWidth: t.size.touchMin, textAlign: 'center' },
}));

/** Keeps decimal steps exact: 0.1 + 0.2 stays 0.3. */
function addStep(value: number, delta: number): number {
  return Number((value + delta).toFixed(6));
}

/** §8 stepper: 36 high, − / + are 44 targets. */
export function Stepper({
  value,
  onChange,
  label,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  formatValue,
  decreaseLabel,
  increaseLabel,
  disabled = false,
  style,
  testID,
}: StepperProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const format = useFormat();

  const control = (icon: IconName, name: string, delta: number, blocked: boolean, id: string) => (
    <PressableScale
      // Draws its own pressed fill from state.pressed: no second tone layer (SM7).
      toneShift={false}
      role="button"
      aria-label={`${label}: ${name}`}
      disabled={disabled || blocked}
      visualHeight={size.stepper}
      onPress={() => {
        haptics.selection();
        onChange(Math.min(max, Math.max(min, addStep(value, delta))));
      }}
      testID={testID ? `${testID}.${id}` : undefined}
      style={styles.target}
      contentStyle={(state) => [styles.visual, state.pressed ? styles.pressed : state.hovered ? styles.hover : null]}
    >
      <Icon name={icon} size={20} color={disabled || blocked ? 'text.disabled' : 'text.primary'} />
    </PressableScale>
  );

  return (
    <View role="group" aria-label={label} testID={testID} style={[styles.root, style]}>
      <WithoutForcedState>{control('minus', decreaseLabel ?? t('actions.decrease'), -step, value <= min, 'decrease')}</WithoutForcedState>
      <Text
        variant="bodyStrong" numeric
        color={disabled ? 'text.disabled' : 'text.primary'}
        aria-live="polite"
        selectable={false}
        hyphenate={false}
        testID={testID ? `${testID}.value` : undefined}
        style={styles.value}
      >
        {formatValue ? formatValue(value) : format.number(value)}
      </Text>
      {control('plus', increaseLabel ?? t('actions.increase'), step, value >= max, 'increase')}
    </View>
  );
}
