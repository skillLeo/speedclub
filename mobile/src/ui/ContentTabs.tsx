import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint, useMotion, useTheme } from '@/theme';

import { Hairline } from './Hairline';
import { PressableScale } from './PressableScale';
import { WithoutForcedState } from './qaVisualState';
import { Text } from './Text';
import { useRovingKeys } from './useRovingKeys';

export type ContentTab<T extends string> = { value: T; label: string; disabled?: boolean; testID?: string };

export type ContentTabsProps<T extends string> = {
  tabs: readonly ContentTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name of the tablist. */
  label: string;
  /** False removes the gutter, for tabs inside a card. */
  gutter?: boolean;
  /**
   * DQ-158, with `gutter` false: tabs at the top of a column that has no gutter of its own (VEH-01 from 768). The scroller
   * reaches the label padding (12) out past both edges, so the first label lines up with the column's text as it does on
   * a phone; the hairline keeps the column's width.
   */
  bleed?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type Box = { x: number; width: number };

/** DQ-192: up to this many tabs share the width equally once their labels overflow, instead of scrolling. */
const EQUAL_MAX_TABS = 2;

const useStyles = createStyles((t) => ({
  scroller: { flexGrow: 0 },
  scrollerBleed: { marginHorizontal: -t.space[12] },
  list: { flexDirection: 'row', minHeight: t.size.contentTab },
  tab: { justifyContent: 'center' },
  // Equal tabs: each takes half the row and its label wraps at its spaces, so both stay whole on screen.
  tabEqual: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  labelEqual: { textAlign: 'center' },
  // Measures the labels on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
  visual: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    justifyContent: 'center',
    minHeight: t.size.contentTab,
    minWidth: t.size.touchMin,
    paddingHorizontal: t.space[12],
  },
  hover: { backgroundColor: t.color.state.hover },
  // §8 asks for 15/20 at 600: the size of bodyDense, the line and semi-bold family of labelS.
  label: {
    fontSize: t.typography.bodyDense.fontSize * (isWeb ? t.fontScale : 1),
    lineHeight: t.typography.labelS.lineHeight * (isWeb ? t.fontScale : 1),
  },
  // One unit wide, scaled to the label: the slide uses transform only.
  underline: {
    backgroundColor: t.color.accent.fg,
    bottom: 0,
    height: t.size.contentTabIndicator,
    left: 0,
    position: 'absolute',
    width: t.size.border.control,
  },
}));

/** §8 content tabs: 44 high, 2-pt accent.fg underline sliding in 140 ms, scrolls when it overflows. */
export function ContentTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  gutter = true,
  bleed = false,
  style,
  testID,
}: ContentTabsProps<T>) {
  const styles = useStyles();
  const motion = useMotion();
  const theme = useTheme();
  const breakpoint = useBreakpoint();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [rowWidth, setRowWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const selectedKey = tabs[selectedIndex]?.value;
  const box = selectedKey === undefined ? undefined : boxes[selectedKey];
  const padding = theme.space[12];
  // The label padding counts towards the gutter, so the first label aligns with the screen's left edge.
  const edge = gutter ? breakpoint.gutter - padding : 0;
  // With one or two tabs whose labels do not fit the row on one line, the tabs share the row and wrap: a scroller would
  // hide the second label, and with it the count of the tab that opened (DQ-192).
  const natural = tabs.reduce((sum, tab) => sum + (labelWidths[tab.value] ?? 0) + padding * 2, 2 * edge);
  const measured = rowWidth > 0 && tabs.every((tab) => labelWidths[tab.value] !== undefined);
  const equal = tabs.length <= EQUAL_MAX_TABS && measured && natural > rowWidth + (bleed && !gutter ? padding * 2 : 0);
  const measureLabel = (key: string) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setLabelWidths((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };

  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (!box) return;
    const labelWidth = Math.max(0, Math.min(box.width - padding * 2, equal ? (labelWidths[selectedKey ?? ''] ?? box.width) : box.width));
    const centre = box.x + box.width / 2;
    if (placed.current) {
      x.set(motion.timingTo(centre, 'micro'));
      width.set(motion.timingTo(labelWidth, 'micro'));
      scroller.current?.scrollTo({ x: Math.max(0, box.x - breakpoint.gutter), animated: motion.enabled && !motion.reduced });
    } else {
      x.set(centre);
      width.set(labelWidth);
      placed.current = true;
      // DQ-192: a tab chosen before the first frame (the one that opened by itself) is in view from the start.
      scroller.current?.scrollTo({ x: Math.max(0, box.x - breakpoint.gutter), animated: false });
    }
  }, [box, breakpoint.gutter, equal, labelWidths, motion, padding, selectedKey, width, x]);

  const underline = useAnimatedStyle(() => ({
    opacity: width.get() > 0 ? 1 : 0,
    transform: [{ translateX: x.get() - theme.size.border.control / 2 }, { scaleX: width.get() }],
  }));

  const select = (index: number) => {
    const tab = tabs[index];
    if (tab && tab.value !== value) onChange(tab.value);
  };
  const roving = useRovingKeys(
    tabs.map((tab) => !tab.disabled),
    selectedIndex,
    select,
  );

  const list = (
        <View
          role="tablist"
          aria-label={label}
          testID={testID ? `${testID}.list` : undefined}
          style={styles.list}
          {...({ onKeyDown: roving.onKeyDown } as object)}>
          {tabs.map((tab, index) => {
            const selected = index === selectedIndex;
            const color = tab.disabled ? 'text.disabled' : selected ? 'text.primary' : 'text.secondary';
            return (
              <WithoutForcedState key={tab.value} active={!selected}>
                <PressableScale
                  ref={roving.setRef(index)}
                  role="tab"
                  aria-label={tab.label}
                  aria-selected={selected}
                  disabled={tab.disabled}
                  feedback={false}
                  ring="inset"
                  tabIndex={selected ? 0 : -1}
                  onPress={() => select(index)}
                  onLayout={(event) => {
                    const next = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width };
                    setBoxes((current) => {
                      const old = current[tab.value];
                      return old?.x === next.x && old?.width === next.width ? current : { ...current, [tab.value]: next };
                    });
                  }}
                  testID={tab.testID ?? (testID ? `${testID}.${tab.value}` : undefined)}
                  style={[styles.tab, equal ? styles.tabEqual : null]}
                  contentStyle={(state) => [styles.visual, state.hovered ? styles.hover : null]}
                >
                  <Text variant="labelS" color={color} selectable={false} hyphenate={false} style={[styles.label, equal ? styles.labelEqual : null]}>
                    {/* DQ-282: sharing the row equally, a label may wrap between its words, so a no-break space (label + count,
                        DQ-279) turns back into a normal one here; the measuring copy keeps it to measure the one-line width. */}
                    {equal ? tab.label.replace(/\u00A0/g, ' ') : tab.label}
                  </Text>
                </PressableScale>
              </WithoutForcedState>
            );
          })}
          <Animated.View style={[styles.underline, underline]} />
        </View>
  );

  return (
    <View style={style} testID={testID} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {equal ? (
        <View style={[bleed && !gutter ? styles.scrollerBleed : null, { paddingHorizontal: edge }]} testID={testID ? `${testID}.equal` : undefined}>
          {list}
        </View>
      ) : (
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.scroller, bleed && !gutter ? styles.scrollerBleed : null]}
          contentContainerStyle={{ paddingHorizontal: edge }}
        >
          {list}
        </ScrollView>
      )}
      <Hairline />
      {tabs.length <= EQUAL_MAX_TABS ? (
        <View aria-hidden style={styles.measure}>
          {tabs.map((tab) => (
            <Text key={tab.value} variant="labelS" hyphenate={false} selectable={false} style={styles.label} onLayout={measureLabel(tab.value)}>
              {tab.label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
