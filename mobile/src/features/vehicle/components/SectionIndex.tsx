import { useEffect, useRef, type ComponentRef } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useScreenReader } from '@/features/messages/useScreenReader';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, fontScaleCap, size } from '@/theme';
import { Hairline } from '@/ui/Hairline';
import { PressableScale, type PressableVisualState } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';
import { useMotionPreference } from '@/ui/motion';

import type { ProfileSection } from '../sections';

export type SectionIndexItem = { key: ProfileSection; label: string };

export type SectionIndexProps = {
  items: readonly SectionIndexItem[];
  /** The section in view (scroll-spy), or null above the first one. */
  current: ProfileSection | null;
  /** `focus`: the link was used with a keyboard or a screen reader, so focus follows to the section's heading (review SF-4). */
  onSelect: (section: ProfileSection, options: { focus: boolean }) => void;
  /** `row`: the sticky chip row (phones, tablets, desktop to 1439); `column`: the desktop's vertical list from 1440. */
  orientation: 'row' | 'column';
  /** "Abschnitte": the navigation's name, WEB-01's nav label word for word. */
  label: string;
  /** The row's side padding (the page gutter on a phone). */
  gutter?: number;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

const useStyles = createStyles((t) => ({
  // Opaque: pinned, it covers the content scrolling under it (no glass on content, 09 §4.3).
  rowRoot: { backgroundColor: t.color.bg.canvas },
  rowList: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], paddingVertical: t.space[4] },
  chipBox: { alignSelf: 'flex-start' },
  // 09 §5 chip: pill 32, border.default; the section in view is inverted (text.primary fill, canvas label), as a selected chip.
  chip: {
    alignItems: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    minHeight: t.size.chip,
    minWidth: t.size.touchMin,
    paddingHorizontal: t.space[12],
  },
  chipCurrent: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
  hover: { backgroundColor: t.color.state.hover },
  columnList: { gap: t.space[2] },
  // The side list: text links on a hairline spine; the current one in text.primary with the 2 indicator on the spine.
  link: { alignSelf: 'stretch', flexDirection: 'row', minHeight: t.size.touchMin },
  linkVisual: { alignItems: 'center', borderRadius: t.radius.sm, flex: 1, flexDirection: 'row', gap: t.space[12], paddingRight: t.space[8] },
  indicator: { alignSelf: 'stretch', backgroundColor: t.color.border.default, width: t.size.border.control },
  indicatorCurrent: { backgroundColor: t.color.text.primary, width: t.size.contentTabIndicator },
  linkText: { flexShrink: 1 },
}));

/**
 * VEH-01's section index (10 §5.5, ADR-505): links that scroll to a section and mark the one in view. A navigation aid, not tabs:
 * a `navigation` landmark holding a list of links, the current one `aria-current="location"` on web and selected for native screen
 * readers. The row keeps the current chip in view as the reader scrolls (no animation under reduced motion).
 */
export function SectionIndex({ items, current, onSelect, orientation, label, gutter = 0, style, testID }: SectionIndexProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const boxes = useRef<Partial<Record<ProfileSection, { x: number; width: number }>>>({});
  const viewport = useRef(0);

  useEffect(() => {
    if (orientation !== 'row' || !current) return;
    const box = boxes.current[current];
    if (!box || viewport.current === 0) return;
    // The current chip in the middle third of the row, or as close as the row's ends allow.
    const x = Math.max(0, box.x + box.width / 2 - viewport.current / 2);
    scrollRef.current?.scrollTo({ x, y: 0, animated: motion.enabled && !motion.reduced });
  }, [current, motion, orientation]);

  const screenReader = useScreenReader();
  const select = (section: ProfileSection, event?: { nativeEvent?: unknown }) => {
    haptics.selection();
    // Web: a click from Enter or Space has no click count (`detail` 0); native: the screen reader activated it.
    const detail = (event?.nativeEvent as { detail?: unknown } | undefined)?.detail;
    onSelect(section, { focus: isWeb ? detail === 0 : screenReader });
  };

  const currentProps = (selected: boolean) =>
    selected ? (isWeb ? ({ 'aria-current': 'location' } as object) : { 'aria-selected': true }) : {};

  if (orientation === 'column') {
    return (
      <View role="navigation" aria-label={label} style={style} testID={testID}>
        <View role="list" style={styles.columnList} testID={`${testID}.list`}>
          {items.map((item) => {
            const selected = item.key === current;
            return (
              <View key={item.key} role="listitem">
                <PressableScale
                  role="link"
                  {...currentProps(selected)}
                  aria-label={isWeb ? undefined : item.label}
                  onPress={(event) => select(item.key, event)}
                  style={styles.link}
                  contentStyle={(state: PressableVisualState) => [styles.linkVisual, !selected && state.hovered ? styles.hover : null]}
                  testID={`${testID}.${item.key}`}
                >
                  <View style={[styles.indicator, selected ? styles.indicatorCurrent : null]} />
                  <Text variant={selected ? 'calloutStrong' : 'callout'} color={selected ? 'text.primary' : 'text.secondary'} selectable={false} style={styles.linkText}>
                    {item.label}
                  </Text>
                </PressableScale>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View role="navigation" aria-label={label} style={[styles.rowRoot, style]} testID={testID}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event: LayoutChangeEvent) => {
          viewport.current = event.nativeEvent.layout.width;
        }}
        contentContainerStyle={{ paddingHorizontal: gutter }}
        testID={`${testID}.scroll`}
      >
        <View role="list" style={styles.rowList} testID={`${testID}.list`}>
          {items.map((item) => {
            const selected = item.key === current;
            return (
              <View
                key={item.key}
                role="listitem"
                style={styles.chipBox}
                onLayout={(event: LayoutChangeEvent) => {
                  boxes.current[item.key] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width };
                }}
              >
                <PressableScale
                  role="link"
                  {...currentProps(selected)}
                  aria-label={isWeb ? undefined : item.label}
                  tone={selected ? 'inverse' : 'default'}
                  visualHeight={size.chip}
                  onPress={(event) => select(item.key, event)}
                  contentStyle={(state: PressableVisualState) => [styles.chip, selected ? styles.chipCurrent : null, !selected && state.hovered ? styles.hover : null]}
                  testID={`${testID}.${item.key}`}
                >
                  {/* DQ-M53-12: navigation chrome, capped at the pill's 1.3 (as the segments, DQ-M54-02). */}
                  <Text variant="callout" color={selected ? 'text.inverse' : 'text.primary'} selectable={false} hyphenate={false} numberOfLines={1} fontScaleCap={fontScaleCap.pill}>
                    {item.label}
                  </Text>
                </PressableScale>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Hairline />
    </View>
  );
}
