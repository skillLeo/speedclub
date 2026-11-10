import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { createStyles, size, space, useMotion } from '@/theme';

import { PressableScale } from './PressableScale';
import { WithoutForcedState } from './qaVisualState';
import { useStacksAtFontScale } from './rowParts';
import { Text } from './Text';
import { useRovingKeys } from './useRovingKeys';

export type Segment<T extends string> = { value: T; label: string; disabled?: boolean; testID?: string };

export type SegmentedControlProps<T extends string> = {
  /** At most three segments (§8). */
  options: readonly [Segment<T>] | readonly [Segment<T>, Segment<T>] | readonly [Segment<T>, Segment<T>, Segment<T>];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** `tablist` when it switches content, `radiogroup` when it sets a form value. */
  role?: 'tablist' | 'radiogroup';
  disabled?: boolean;
  /**
   * A form value that may stay unanswered (FS-5 Antrieb): a `value` outside the options then selects no segment and draws
   * no pill. Without it the first segment stands in, as for a tablist.
   */
  allowNone?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const INSET = space[2];
const SEGMENT_HEIGHT = size.segmented - INSET * 2;

const useStyles = createStyles((t) => ({
  track: {
    alignSelf: 'stretch',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    minHeight: t.size.segmented,
    padding: INSET,
  },
  pill: {
    backgroundColor: t.colorScheme === 'light' ? t.color.bg.surface : t.color.bg.overlay,
    borderRadius: t.radius.sm,
    bottom: INSET,
    boxShadow: t.colorScheme === 'light' ? t.shadow.e1 : undefined,
    left: INSET,
    position: 'absolute',
    top: INSET,
  },
  // Large font: nothing is cut or hyphenated. Each segment takes its label's width and the control scrolls if it must.
  pillInScroller: { bottom: 0, left: 0, top: 0 },
  scrollContent: { flexDirection: 'row', flexGrow: 1 },
  segment: { flex: 1, minWidth: 0 },
  segmentNatural: { flexGrow: 1, flexShrink: 0 },
  visual: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    justifyContent: 'center',
    minHeight: SEGMENT_HEIGHT,
    paddingHorizontal: t.space[8],
  },
  label: { textAlign: 'center' },
}));

/**
 * §8 segmented control: 36 high, radius 8, a selected pill that slides with spring.snappy, selection haptic. The pill
 * moves with transform only; between differently wide segments at a large font its width switches at the start.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  role = 'tablist',
  disabled = false,
  allowNone = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  const motion = useMotion();
  const [width, setWidth] = useState(0);
  const count = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const natural = useStacksAtFontScale();
  const [boxes, setBoxes] = useState<Record<string, { x: number; width: number }>>({});
  const none = allowNone && !options.some((option) => option.value === value);
  const selectedBox = boxes[options[selectedIndex]?.value ?? ''];
  const segmentWidth = width > 0 ? (width - INSET * 2) / count : 0;
  const targetX = natural ? (selectedBox?.x ?? 0) : selectedIndex * segmentWidth;
  const targetWidth = natural ? (selectedBox?.width ?? 0) : segmentWidth;
  const pillX = useSharedValue(targetX);
  const pillWidth = useSharedValue(targetWidth);
  const lastIndex = useRef(selectedIndex);
  const isTab = role === 'tablist';

  useEffect(() => {
    // Only a change of selection slides. A layout change, including the first one, places the pill directly.
    pillX.set(lastIndex.current === selectedIndex ? targetX : motion.springTo(targetX));
    pillWidth.set(targetWidth);
    lastIndex.current = selectedIndex;
  }, [motion, pillWidth, pillX, selectedIndex, targetWidth, targetX]);

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.value === value) return;
    haptics.selection();
    onChange(option.value);
  };

  const enabled = options.map((option) => !disabled && !option.disabled);
  const roving = useRovingKeys(enabled, selectedIndex, select);

  const pill = useAnimatedStyle(() => ({
    width: pillWidth.get(),
    transform: [{ translateX: pillX.get() }],
  }));

  const segments = (
    <>
      {targetWidth > 0 && !none ? <Animated.View style={[styles.pill, natural ? styles.pillInScroller : null, pill]} /> : null}
      {options.map((option, index) => {
        const selected = !none && index === selectedIndex;
        const off = disabled || option.disabled === true;
        const color = off ? 'text.disabled' : selected ? 'text.primary' : 'text.secondary';
        return (
          <WithoutForcedState key={option.value} active={!selected}>
            <PressableScale
              ref={roving.setRef(index)}
              role={isTab ? 'tab' : 'radio'}
              aria-label={option.label}
              {...(isTab ? { 'aria-selected': selected } : { 'aria-checked': selected })}
              disabled={off}
              tabIndex={selected || (none && index === 0) ? 0 : -1}
              ring="inset"
              visualHeight={SEGMENT_HEIGHT}
              onPress={() => select(index)}
              onLayout={(event) => {
                const { x, width: boxWidth } = event.nativeEvent.layout;
                setBoxes((current) => {
                  const old = current[option.value];
                  return old?.x === x && old?.width === boxWidth ? current : { ...current, [option.value]: { x, width: boxWidth } };
                });
              }}
              testID={option.testID ?? (testID ? `${testID}.${option.value}` : undefined)}
              style={natural ? styles.segmentNatural : styles.segment}
              contentStyle={styles.visual}
            >
              <Text variant="labelS" color={color} selectable={false} hyphenate={false} style={styles.label}>
                {option.label}
              </Text>
            </PressableScale>
          </WithoutForcedState>
        );
      })}
    </>
  );

  return (
    <View
      role={role}
      aria-label={label}
      testID={testID}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, style]}
      {...({ onKeyDown: roving.onKeyDown } as object)}
    >
      {natural ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {segments}
        </ScrollView>
      ) : (
        segments
      )}
    </View>
  );
}
