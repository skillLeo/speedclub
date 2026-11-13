import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { ColorToken } from '@/theme';
import { motion as motionTokens, type TypeVariant } from '@/theme/tokens.generated';

import { Text } from '../Text';
import { digitOffset, odometerCells } from './math';
import { useMotionPreference } from './preference';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row' },
  cell: { overflow: 'hidden' },
  column: { left: 0, position: 'absolute', right: 0, top: 0 },
  hidden: { opacity: 0 },
});

export type OdometerNumberProps = {
  /** The formatted value ("510", "1.725", "3,9"). Digits roll, everything else stands. */
  value: string;
  /**
   * Where the first roll starts ("000"). Without it the value is simply there on mount and only later changes roll. Pass it
   * only for the first showing (see `useOdometerOnce`): SM6 rolls once per vehicle per session.
   */
  rollFrom?: string;
  variant?: TypeVariant;
  color?: ColorToken;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * SM6 odometer numerals (09 §4.7): each digit rolls vertically in its own column on spring.default; tabular figures keep the
 * width still. Reduced motion: the number jumps to its value. Screen readers read the value once (the columns are hidden).
 */
export function OdometerNumber({ value, rollFrom, variant = 'heroNumeral', color = 'text.primary', style, testID }: OdometerNumberProps) {
  // The previous value is where a column that appears later starts; the first render starts at `rollFrom`.
  const [previous, setPrevious] = useState(rollFrom ?? value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setPrevious(shown);
    setShown(value);
  }
  const cells = odometerCells(previous, value);
  return (
    <View accessible role="img" aria-label={value} style={[styles.row, style]} testID={testID}>
      {cells.map((cell) =>
        cell.kind === 'digit' ? (
          <DigitColumn key={cell.key} from={cell.from} to={cell.to} variant={variant} color={color} />
        ) : (
          <Text key={cell.key} aria-hidden variant={variant} color={color} numeric hyphenate={false}>
            {cell.char}
          </Text>
        ),
      )}
    </View>
  );
}

function DigitColumn({ from, to, variant, color }: { from: number; to: number; variant: TypeVariant; color: ColorToken }) {
  const motion = useMotionPreference();
  const [line, setLine] = useState(0);
  const position = useSharedValue(motion.reduced ? to : from);

  useEffect(() => {
    position.set(motion.reduced ? to : motion.springTo(to, 'default'));
  }, [motion, position, to]);

  const columnStyle = useAnimatedStyle(() => ({ transform: [{ translateY: digitOffset(position.get(), line) }] }));
  const onLayout = (event: LayoutChangeEvent) => setLine(event.nativeEvent.layout.height);
  const measured = line > 0;

  return (
    <View aria-hidden style={styles.cell}>
      {/* The sizer gives the cell one line of the role; it shows the digit until the column knows the line height. */}
      <Text variant={variant} color={color} numeric hyphenate={false} onLayout={onLayout} style={measured ? styles.hidden : null}>
        {DIGITS[to]}
      </Text>
      {measured ? (
        <Animated.View style={[styles.column, columnStyle]}>
          {DIGITS.map((digit) => (
            <Text key={digit} variant={variant} color={color} numeric hyphenate={false}>
              {digit}
            </Text>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ once per session (SM6) */

const rolled = new Set<string>();

/**
 * True the first time `key` (a vehicle id) asks in this session, false afterwards: the spec strip rolls once per vehicle per
 * session (09 §4.7 SM6). The answer is fixed while the key stays, so a re-render never rolls again.
 */
export function useOdometerOnce(key: string): boolean {
  // Pure render: the answer is read for the key and kept while the key stays; a recycled cell with a new key asks afresh.
  // The session set is written after commit, never inside render or a state initialiser.
  const [answer, setAnswer] = useState(() => ({ key, first: !rolled.has(key) }));
  let current = answer;
  if (answer.key !== key) {
    current = { key, first: !rolled.has(key) };
    setAnswer(current);
  }
  const { first } = current;
  useEffect(() => {
    if (first) rolled.add(key);
  }, [first, key]);
  return first;
}

/** Test seam. */
export function __resetOdometerSessionForTests(): void {
  rolled.clear();
}

/** A string of zeros with the value's shape ("1.725" → "0.000"): the usual start of a first roll. */
export function zeroed(value: string): string {
  return value.replace(/[0-9]/g, '0');
}

/* ------------------------------------------------------------------ live count (SM18) */

/** `value`, held back until it has stood still for `delay` ms (the Discover apply button: 250 ms). */
export function useDebouncedValue<T>(value: T, delay: number = motionTokens.signature.liveCountDebounce): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

/**
 * SM18 live count roll: a count that follows filters ("128 Builds anzeigen"), debounced 250 ms, rolling with the SM6 engine.
 * The caller formats the number (`formatCount`) and sets the words around it in its own translation.
 */
export function LiveCount({ value, ...rest }: Omit<OdometerNumberProps, 'rollFrom'>) {
  const settled = useDebouncedValue(value);
  return <OdometerNumber value={settled} {...rest} />;
}
