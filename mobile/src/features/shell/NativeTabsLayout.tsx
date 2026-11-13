import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { hapticFor } from '@/lib/haptics';
import { isAndroid } from '@/lib/platform';
import { useShellStore } from '@/state/shell';
import { useTheme } from '@/theme';
import { unreadCountText } from '@/ui';

import { TAB_DESTINATIONS } from './destinations';
import { setNativeTabsActive } from './navMode';
import { ANDROID_TAB_ICONS } from './nativeTabIcons';
import { runRetap } from './retap';
import { useTabBadges } from './useTabBadges';

type TabPressProps = {
  navigation: { isFocused: () => boolean };
  route: { state?: { routes: readonly unknown[] } };
};

/**
 * What a press on a tab does besides switching (09 §4.8, §9): a selection haptic on a change; on Android a re-tap of the
 * active tab scrolls its screen to the top, then pops its stack (`runRetap`). iOS does both natively (UITabBarController),
 * so it only gets the haptic. Exported for the unit test.
 */
export function onNativeTabPress({ navigation, route }: TabPressProps, android: boolean = isAndroid): void {
  if (!navigation.isFocused()) {
    hapticFor('tabChange');
    return;
  }
  if (android) runRetap(route.state?.routes.length ?? 1, () => router.dismissAll());
}

/**
 * 09 §6.1 native tabs (`expo-router/native-tabs`, stable in SDK 58): Liquid Glass on iOS, the Material 3 navigation bar on
 * Android with labels always visible. The five destinations, labels and badges come from the same config as the JS shell
 * (TAB_DESTINATIONS, useTabBadges). Platform symbols only here (SKILL §5): SF Symbols on iOS; on Android the Phosphor pair as
 * PNGs until expo-symbols brings the Material Symbols (destinations.ts `md`).
 *
 * Content insets are native: Android puts the bar below the content (useTabBarPadding stays 0), iOS insets the first
 * scroll view of a tab. The toast host learns the bar's height through navMode (measured in the shared stack layout).
 */
export function NativeTabsLayout() {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const badges = useTabBadges();
  const hidden = useShellStore((state) => state.tabBarHidden);

  useEffect(() => {
    setNativeTabsActive(true);
    return () => setNativeTabsActive(false);
  }, []);

  const { color } = theme;
  return (
    <NativeTabs
      hidden={hidden}
      // iOS 26+: the bar shrinks while the content scrolls down (Start, Entdecken and the rest alike: the prop is per bar).
      minimizeBehavior="onScrollDown"
      tintColor={color.text.primary}
      badgeBackgroundColor={color.accent.fill}
      // Android: the Material 3 bar in the theme's surface, labels always shown, a neutral indicator pill (red stays rare).
      labelVisibilityMode="labeled"
      backgroundColor={isAndroid ? color.bg.surface : undefined}
      indicatorColor={color.bg.raised}
      rippleColor={color.state.pressed}
      badgeTextColor={color.text.onAccent}
      iconColor={isAndroid ? { default: color.text.secondary, selected: color.text.primary } : undefined}
      labelStyle={isAndroid ? { default: { color: color.text.secondary }, selected: { color: color.text.primary } } : undefined}
      screenListeners={(props) => ({ tabPress: () => onNativeTabPress(props as unknown as TabPressProps) })}
    >
      {TAB_DESTINATIONS.map((destination) => {
        const messages = destination.name === 'messages' && badges.messages > 0 ? unreadCountText(badges.messages) : null;
        const dot = destination.name === 'home' && badges.home;
        const label = t(destination.labelKey);
        // As TabButton names it: the label, then what the badge says (the native default is the label alone).
        const unread = messages !== null ? t('a11y.unreadCount', { count: messages }) : dot ? t('a11y.unreadNotifications') : null;
        return (
          <NativeTabs.Trigger
            key={destination.name}
            name={destination.route}
            testID={destination.testID}
            accessibilityLabel={unread ? `${label}, ${unread}` : undefined}
          >
            <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={destination.sf} src={ANDROID_TAB_ICONS[destination.name]} />
            {/* A Badge without text is the dot (unread notifications on Start); none at all hides it. */}
            {messages !== null ? <NativeTabs.Trigger.Badge>{messages}</NativeTabs.Trigger.Badge> : null}
            {dot ? <NativeTabs.Trigger.Badge /> : null}
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}
