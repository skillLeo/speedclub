import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { createStyles, space, useBreakpoint } from '@/theme';

import { BrandWordmark } from './BrandWordmark';
import type { HeaderAction } from './Header';
import { IconButton } from './IconButton';
import { useMotionPreference } from './motion/preference';
import { useSafeEdge } from './safeArea';
import { Text } from './Text';
import { UnreadBadge } from './UnreadBadge';
import type { CollapsingHeader } from './useCollapsingHeader';

/** Height of the brush wordmark in the bar (09 §6.2 d). */
export const BRAND_HEADER_LOGO_HEIGHT = space[20];
/** The bundled wide logo's ratio (BrandWordmark FILES.wide). */
const WIDE_RATIO = 1200 / 359;

/**
 * How far the bar is pushed up, from the last offset and the scroll step (09 §6.2 d, "hides on scroll down, returns on scroll
 * up"): a diff clamp between 0 (shown) and the bar's height (hidden). At the top of the list, and in a pull-to-refresh
 * overscroll, it is always shown. Pure and a worklet, so the test and the UI thread run the same rule.
 */
export function nextBrandHeaderOffset(offset: number, previousY: number, y: number, height: number): number {
  'worklet';
  if (y <= 0) return 0;
  return Math.min(height, Math.max(0, offset + (y - previousY)));
}

export type BrandHeaderProps = {
  /** From `useCollapsingHeader()`; without it the bar stays. */
  scroll?: CollapsingHeader;
  /** The bell (and nothing much else): icon buttons on the trailing edge, with their unread dot or pill. */
  actions?: readonly HeaderAction[];
  /**
   * The wordmark; defaults to the bundled brush logo. Screens pass AppWordmark for the published one. `false` draws `title` as the
   * visible page title instead (the desktop pane, where the sidebar carries the brand already).
   */
  logo?: ReactNode | false;
  /** The page's name ("Start"): the heading's accessible name over the wordmark, or the visible title with `logo={false}`. */
  title?: string;
  /**
   * A row under the bar that stays when the bar hides (09 §7.3: the sticky "Für dich · Folge ich"): the bar slides up by its own
   * row only, and a canvas band keeps the status bar clear.
   */
  accessory?: ReactNode;
  /** Centres the row (and the accessory) in this width plus the gutters, on the content column of a wide pane. */
  contentWidth?: number;
  /** The bar's height including the status bar, for the list's top padding (the bar floats over it). */
  onHeight?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.logo`. */
  testID?: string;
};

const useStyles = createStyles((t) => ({
  bar: {
    backgroundColor: t.color.bg.canvas,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: t.zIndex.header,
  },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: t.size.header },
  logo: { justifyContent: 'center', minHeight: t.size.iconButton },
  actions: { alignItems: 'center', flexDirection: 'row' },
  action: { pointerEvents: 'box-none' },
  dot: { pointerEvents: 'none', position: 'absolute', right: t.space[8], top: t.space[8] },
  content: { alignSelf: 'center', width: '100%' },
  // The status bar's band: it stays put while the row slides under it, so the wordmark never shows behind the clock.
  statusBand: { backgroundColor: t.color.bg.canvas, left: 0, position: 'absolute', right: 0, top: 0, zIndex: t.zIndex.sticky },
}));

/**
 * 09 §6.2 pattern (d), the Home header: the small brush wordmark (20 high) on the leading edge, the bell with its badge on the
 * trailing one. It floats over the list, slides away while the list scrolls down and comes back on the first scroll up. With
 * reduced motion it fades instead of sliding (09 §4.7). The brand mark only here and at the other brand moments (SKILL §1).
 */
export function BrandHeader({ scroll, actions, logo, title, accessory, contentWidth, onHeight, style, testID }: BrandHeaderProps) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const safe = useSafeEdge('top');
  const motion = useMotionPreference();
  const reduced = motion.preference !== 'full';
  const [height, setHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  // With an accessory only the brand row hides; with reduced motion that row stays (a fading row would leave an empty band).
  const travel = accessory ? (reduced ? 0 : rowHeight) : height;
  const offset = useSharedValue(0);

  useAnimatedReaction(
    () => scroll?.scrollY.get() ?? 0,
    (y, previous) => {
      offset.set(nextBrandHeaderOffset(offset.get(), previous ?? y, y, travel));
    },
    [travel],
  );

  const slide = useAnimatedStyle(() => {
    if (travel <= 0) return {};
    const hidden = offset.get() / travel;
    return reduced ? { opacity: 1 - hidden } : { transform: [{ translateY: -offset.get() }] };
  });
  const band = useAnimatedStyle(() => (travel <= 0 || reduced ? {} : { transform: [{ translateY: offset.get() }] }));
  const fade = useAnimatedStyle(() => (travel <= 0 || !accessory ? {} : { opacity: 1 - offset.get() / travel }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeight(next);
    onHeight?.(next);
  };
  const width = contentWidth === undefined ? null : { maxWidth: contentWidth + 2 * gutter };

  const mark =
    logo === false ? (
      <Text variant="title2" role="heading" aria-level={1} numberOfLines={1} testID={testID ? `${testID}.title` : undefined}>
        {title}
      </Text>
    ) : (
      <View role={title ? 'heading' : undefined} aria-level={title ? 1 : undefined} aria-label={title}>
        {logo ?? <BrandWordmark width={BRAND_HEADER_LOGO_HEIGHT * WIDE_RATIO} height={BRAND_HEADER_LOGO_HEIGHT} />}
      </View>
    );

  return (
    <Animated.View
      dataSet={{ qaExempt: 'safe-area' }}
      style={[styles.bar, safe, style, slide]}
      onLayout={onLayout}
      testID={testID}
    >
      {accessory ? <Animated.View style={[styles.statusBand, safe, band]} /> : null}
      <View style={[styles.content, width]}>
        {/* Gutter minus the 12 of air inside a 44 target: the bell's glyph lines up with the content, like Header's actions. */}
        <Animated.View
          style={[styles.row, { paddingLeft: gutter, paddingRight: gutter - space[12] }, fade]}
          onLayout={(event) => setRowHeight(event.nativeEvent.layout.height)}
        >
          <View style={styles.logo} testID={testID ? `${testID}.logo` : undefined}>
            {mark}
          </View>
          <View style={styles.actions}>
            {actions?.map((action) => (
              <View key={action.label} style={styles.action}>
                <IconButton
                  icon={action.icon}
                  label={action.unread ? `${action.label}, ${action.unread.label}` : action.label}
                  onPress={action.onPress}
                  selected={action.selected}
                  disabled={action.disabled}
                  locked={action.locked}
                  testID={action.testID}
                />
                {action.unread ? <UnreadBadge count={action.unread.count} style={styles.dot} /> : null}
              </View>
            ))}
          </View>
        </Animated.View>
        {accessory ? <View style={{ paddingHorizontal: gutter }}>{accessory}</View> : null}
      </View>
    </Animated.View>
  );
}
