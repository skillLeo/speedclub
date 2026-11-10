import { BlurView } from 'expo-blur';
import { TabTrigger } from 'expo-router/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { isIOS, isWeb } from '@/lib/platform';
import { createStyles, size, space, useTheme } from '@/theme';
import { Hairline, Text } from '@/ui';
import { useSafeEdge } from '@/ui/safeArea';

import { TAB_DESTINATIONS } from './destinations';
import { SlidingIndicator } from './SlidingIndicator';
import { NARROW_CELL_CAP, TabButton } from './TabButton';
import { useTabBadges } from './useTabBadges';
import { useTabNavigation } from './useTabNavigation';

/**
 * Below this cell width "Nachrichten" at the token's cap of 1.3 runs into "Garage", so the labels stay at their base
 * size there. The long-press label is the way to read them larger.
 */
const COMPACT_CELL = 72;

/** The font-scale cap of a tab label at this cell width; undefined leaves the token's. */
export function tabLabelCap(cell: number): number | undefined {
  if (cell < COMPACT_CELL) return 1;
  return cell === COMPACT_CELL ? NARROW_CELL_CAP : undefined;
}

/**
 * BlurView takes an intensity from 0 to 100, not a radius. This factor gives the blur token the same frosted read on
 * iOS as the CSS radius on web, without losing the 92 % background token on top.
 */
const BLUR_INTENSITY = size.tabBarBlur * 2.5;

const useStyles = createStyles((t) => ({
  bar: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: t.zIndex.tabBar,
  },
  // §8: tabBar.background over the blur. Android has no blur and is solid: its own surface colour, the token's opaque
  // twin. Web blurs through CSS, because BlurView on web adds a tint colour of its own that is not a token.
  background: {
    backgroundColor: isIOS || isWeb ? t.color.tabBar.background : t.color.bg.surface,
    ...(isWeb ? { backdropFilter: `blur(${t.size.tabBarBlur}px)` } : {}),
  },
  // Over the iOS BlurView; the bar itself stays transparent there, or the blur would have nothing to show.
  iosBar: { backgroundColor: 'transparent' },
  hairline: { left: 0, position: 'absolute', right: 0, top: 0 },
  // 6 above the 24 icon, whose top sits at 12.
  indicator: {
    backgroundColor: t.color.accent.fg,
    borderRadius: t.radius.xs,
    height: t.space[2],
    left: 0,
    position: 'absolute',
    top: t.space[4],
    width: t.space[16],
  },
  row: { flexDirection: 'row', height: t.size.tabBar },
  largeLabel: {
    alignItems: 'center',
    bottom: '100%',
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
  },
  largeLabelBubble: {
    backgroundColor: t.color.bg.overlay,
    borderRadius: t.radius.sm,
    marginBottom: t.space[8],
    paddingHorizontal: t.space[16],
    paddingVertical: t.space[8],
  },
}));

/** §8 bottom tab bar, below 768. It floats over the content, which pads itself with useTabBarPadding(). */
export function TabBar() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const window = useWindowDimensions();
  const padding = useSafeEdge('bottom');
  const badges = useTabBadges();
  const { activeIndex, pressHandler } = useTabNavigation();
  const [width, setWidth] = useState(window.width);
  const [largeLabel, setLargeLabel] = useState<string | null>(null);

  const cell = width / TAB_DESTINATIONS.length;

  return (
    <View
      dataSet={{ qaExempt: 'safe-area' }}
      style={[styles.bar, isIOS ? styles.iosBar : styles.background, padding]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      testID="shell.tabbar"
    >
      {isIOS ? (
        <>
          <BlurView
            intensity={BLUR_INTENSITY}
            tint={theme.colorScheme === 'light' ? 'light' : 'dark'}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, styles.background]} />
        </>
      ) : null}
      <Hairline style={styles.hairline} />
      <View role="tablist" aria-label={t('a11y.mainNavigation')} style={styles.row} testID="shell.tabbar.list">
        <SlidingIndicator
          axis="x"
          offset={(activeIndex + 0.5) * cell - space[16] / 2}
          style={styles.indicator}
          testID="shell.tabbar.indicator"
        />
        {TAB_DESTINATIONS.map((destination, index) => {
          const label = t(destination.labelKey);
          return (
            <TabTrigger key={destination.name} name={destination.name} asChild onPress={pressHandler(destination.name)}>
              <TabButton
                variant="bar"
                labelCap={tabLabelCap(cell)}
                edge={index === 0 || index === TAB_DESTINATIONS.length - 1}
                icon={destination.icon}
                label={label}
                testID={destination.testID}
                count={destination.name === 'messages' ? badges.messages : undefined}
                dotLabel={destination.name === 'home' && badges.home ? t('a11y.unreadNotifications') : undefined}
                onLongPress={(event) => {
                  // Large-content label: the capped label, readable. It must not also switch the tab.
                  event?.preventDefault?.();
                  setLargeLabel(label);
                }}
                onPressOut={() => setLargeLabel(null)}
              />
            </TabTrigger>
          );
        })}
      </View>
      {largeLabel ? (
        <View aria-hidden style={styles.largeLabel} testID="shell.tabbar.largeLabel">
          <View style={styles.largeLabelBubble}>
            <Text variant="titleM" selectable={false}>
              {largeLabel}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
