import { TabTrigger } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import { createStyles, layout, size, space, useTheme } from '@/theme';
import { Hairline } from '@/ui/Hairline';
import { useSafeEdge } from '@/ui/safeArea';

import { RAIL_ITEMS } from './destinations';
import { SlidingIndicator } from './SlidingIndicator';
import { TabButton } from './TabButton';
import { useTabBadges } from './useTabBadges';
import { useShellBar } from './useShellBar';

const useStyles = createStyles((t) => ({
  rail: { backgroundColor: t.color.bg.canvas },
  // No side padding: the hover fill and the inset focus ring take the full width, so the label stays inside them.
  list: { paddingTop: t.space[8] },
  indicator: {
    backgroundColor: t.color.accent.fg,
    borderRadius: t.radius.xs,
    height: t.space[2],
    position: 'absolute',
    top: t.space[4],
    width: t.space[16],
  },
  divider: { bottom: 0, height: '100%', position: 'absolute', right: 0, width: t.size.border.control },
}));

/** With enlarged text "Nachrichten" at the label's cap of 1.3 needs 85, so the rail grows by one step rather than clipping it. */
export function useRailWidth(): number {
  const theme = useTheme();
  const window = useWindowDimensions();
  return theme.fontScale > 1 || window.fontScale > 1 ? layout.rail + space[16] : layout.rail;
}

/** 768 to 1279: 72 wide, icon + label, the same active language as the tab bar. The five tabs + Nachrichten (10 §1). */
export function Rail() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const padding = useSafeEdge('top');
  const width = useRailWidth();
  const badges = useTabBadges();
  const { items, activeKey, activeIndex, tabPress, placePress } = useShellBar(RAIL_ITEMS);

  return (
    <View dataSet={{ qaExempt: 'safe-area' }} style={[styles.rail, { width }, padding]} testID="shell.rail">
      <View
        role="tablist"
        aria-label={t('a11y.mainNavigation')}
        aria-orientation="vertical"
        style={styles.list}
        testID="shell.rail.list"
      >
        <SlidingIndicator
          axis="y"
          offset={space[8] + activeIndex * size.tabBar}
          style={[styles.indicator, { left: (width - space[16]) / 2 }]}
          testID="shell.rail.indicator"
        />
        {items.map((item) =>
          item.kind === 'tab' ? (
            <TabTrigger key={item.tab.name} name={item.tab.name} asChild onPress={tabPress(item.tab.name)}>
              <TabButton
                variant="rail"
                icon={item.tab.icon}
                label={t(item.tab.labelKey)}
                testID={item.tab.testID}
                isFocused={activeKey === item.tab.name}
                dotLabel={item.tab.name === 'home' && badges.home ? t('a11y.unreadNotifications') : undefined}
              />
            </TabTrigger>
          ) : (
            <TabButton
              key={item.place.name}
              variant="rail"
              icon={item.place.icon}
              label={t(item.place.labelKey)}
              testID={item.place.testID}
              isFocused={activeKey === item.place.name}
              count={item.place.name === 'messages' ? badges.messages : undefined}
              onPress={placePress(item.place)}
            />
          ),
        )}
      </View>
      <Hairline style={styles.divider} />
    </View>
  );
}
