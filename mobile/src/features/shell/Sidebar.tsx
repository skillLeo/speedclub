import { TabTrigger } from 'expo-router/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { isWeb } from '@/lib/platform';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, layout, space, useTheme } from '@/theme';
import { maxFontScale } from '@/theme/tokens.generated';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Hairline } from '@/ui/Hairline';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Text, typeStyle } from '@/ui/Text';
import type { PressableVisualState } from '@/ui/PressableScale';
import { LARGE_FONT_SCALE } from '@/ui/rowParts';
import { useSafeEdge } from '@/ui/safeArea';

import { itemKey, SIDEBAR_ITEMS } from './destinations';
import { SlidingIndicator } from './SlidingIndicator';
import { TabButton } from './TabButton';
import { useAddVehicle } from './useAddVehicle';
import { useTabBadges } from './useTabBadges';
import { useShellBar } from './useShellBar';

const useStyles = createStyles((t) => ({
  sidebar: {
    backgroundColor: t.color.bg.canvas,
    paddingBottom: t.space[16],
    paddingHorizontal: t.space[12],
    width: t.layout.sidebar,
  },
  logo: { marginBottom: t.space[24], marginHorizontal: t.space[12], marginTop: t.space[24] },
  list: { marginBottom: t.space[16] },
  indicator: {
    backgroundColor: t.color.accent.fg,
    borderRadius: t.radius.xs,
    height: t.space[16],
    // On the outer edge of the sidebar, past its padding.
    left: -t.space[12],
    position: 'absolute',
    top: 0,
    width: t.space[2],
  },
  add: { marginBottom: t.space[16] },
  account: { marginTop: 'auto' },
  accountContent: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.single,
    paddingHorizontal: t.space[12],
  },
  hovered: { backgroundColor: t.color.state.hover },
  accountName: { flex: 1 },
  signInLabel: { flex: 1 },
  divider: { bottom: 0, height: '100%', position: 'absolute', right: 0, width: t.size.border.control },
}));

/**
 * DQ-078: above a cap "Nachrichten" hyphenates in the row of 216 and its row grows, which breaks the rhythm of the list: the
 * destinations and the sign-in stop growing, as the labels of the tab bar and the rail do. CARRY-M4.12-18 (amends ADR-162's 1.5):
 * the cap is the web tab role's (`web.tab` maxFontScale, 1.3), one cap for every navigation label on the web; at 1.3 "Nachrichten"
 * ends well inside the row. It does not follow LARGE_FONT_SCALE.
 */
export const SIDEBAR_LABEL_CAP: number = maxFontScale.webSidebar;

/**
 * The account menu slot: the signed-in name opens the profile, a guest gets the sign-in action. DQ-129: a name, unlike the
 * destinations, is not known to fit, so at a large font it gets a second line.
 */
export function AccountSlot() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const router = useRouter();
  const { fontScale } = useTheme();
  const member = useSessionStore((state) => state.member);

  if (!member) {
    return (
      <PressableScale
        role="link"
        aria-label={t('auth.signIn')}
        onPress={() => {
          // Nothing the guest tapped earlier belongs to this sign-in.
          clearAuthIntent();
          router.push('/auth/email');
        }}
        contentStyle={({ hovered }: PressableVisualState) => [styles.accountContent, hovered ? styles.hovered : null]}
        testID="shell.sidebar.signIn"
      >
        <Icon name="sign-in" size={24} color="text.primary" />
        <Text
          variant="webSidebar"
          selectable={false}
          maxFontSizeMultiplier={SIDEBAR_LABEL_CAP}
          style={[styles.signInLabel, isWeb ? typeStyle('webSidebar', Math.min(fontScale, SIDEBAR_LABEL_CAP)) : null]}
        >
          {t('auth.signIn')}
        </Text>
      </PressableScale>
    );
  }
  const name = member.displayName ?? member.username;
  return (
    <PressableScale
      role="link"
      // The label is for native. On web the visible name names the link and the avatar is aria-hidden: a label of the
      // name alone would leave out the initials, which are visible text too (WCAG 2.5.3).
      aria-label={isWeb ? undefined : name}
      onPress={() => router.navigate('/profile')}
      contentStyle={({ hovered }: PressableVisualState) => [styles.accountContent, hovered ? styles.hovered : null]}
      testID="shell.sidebar.account"
    >
      <Avatar name={name} uri={member.avatarUrl} size={32} decorative />
      <Text variant="bodyStrong" numberOfLines={fontScale >= LARGE_FONT_SCALE ? 2 : 1} style={styles.accountName} testID="shell.sidebar.account.name">
        {name}
      </Text>
    </PressableScale>
  );
}

/**
 * DQ-P5-004: the indicator's y for the active item: the heights of the rows above it (each measured row by its item's key; a row not
 * measured yet counts as the 56 single row) plus the half of its own. By key, never by index: the Treffen and Forum flags arrive
 * after the first layout and move every row below them, while react-native-web reports a row's layout only when its size changes,
 * not when it moves. Null until the active row and every row above it are measured, so the indicator never slides from a stale y.
 */
export function sidebarIndicatorOffset(keys: readonly string[], activeKey: string, heights: Readonly<Record<string, number>>): number | null {
  const index = keys.indexOf(activeKey);
  if (index === -1) return null;
  let y = 0;
  for (const key of keys.slice(0, index)) {
    const height = heights[key];
    if (height === undefined) return null;
    y += height;
  }
  const own = heights[activeKey];
  if (own === undefined) return null;
  return y + (own - space[16]) / 2;
}

/** The file's ratio gives 35.9 at this width, which would put every row below it on a fractional y. */
const LOGO_HEIGHT = space[32] + space[4];

/**
 * From 1280: 240 wide with the small logo, the destinations of 10 §1 (Start · Entdecken · Treffen · Forum · Garage · Shop · Nachrichten ·
 * Profil; Treffen and Forum while their flags are on), "Fahrzeug hinzufügen" and the account slot.
 */
export function Sidebar() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const padding = useSafeEdge('top');
  const badges = useTabBadges();
  const addVehicle = useAddVehicle();
  const { items, activeKey, tabPress, placePress } = useShellBar(SIDEBAR_ITEMS);
  // Rows grow with the font scale, so the indicator follows their real heights, kept by item (DQ-P5-004).
  const [heights, setHeights] = useState<Record<string, number>>({});
  const keys = items.map(itemKey);
  const offset = sidebarIndicatorOffset(keys, activeKey, heights);

  return (
    <View dataSet={{ qaExempt: 'safe-area' }} style={[styles.sidebar, padding]} testID="shell.sidebar">
      <AppWordmark width={layout.sidebar / 2} height={LOGO_HEIGHT} style={styles.logo} testID="shell.sidebar.logo" />
      <View
        role="tablist"
        aria-label={t('a11y.mainNavigation')}
        aria-orientation="vertical"
        style={styles.list}
        testID="shell.sidebar.list"
      >
        {offset === null ? null : <SlidingIndicator axis="y" offset={offset} style={styles.indicator} testID="shell.sidebar.indicator" />}
        {items.map((item) => {
          const key = itemKey(item);
          const onLayout = (event: LayoutChangeEvent) => {
            const { height } = event.nativeEvent.layout;
            setHeights((current) => (current[key] === height ? current : { ...current, [key]: height }));
          };
          if (item.kind === 'place') {
            return (
              <TabButton
                key={itemKey(item)}
                variant="sidebar"
                icon={item.place.icon}
                label={t(item.place.labelKey)}
                labelCap={SIDEBAR_LABEL_CAP}
                testID={item.place.testID}
                isFocused={activeKey === item.place.name}
                count={item.place.name === 'messages' ? badges.messages : undefined}
                onPress={placePress(item.place)}
                onLayout={onLayout}
              />
            );
          }
          const { tab } = item;
          return (
            <TabTrigger key={tab.name} name={tab.name} asChild onPress={tabPress(tab.name)}>
              <TabButton
                variant="sidebar"
                icon={tab.icon}
                label={t(tab.labelKey)}
                labelCap={SIDEBAR_LABEL_CAP}
                testID={tab.testID}
                isFocused={activeKey === tab.name}
                dotLabel={tab.name === 'home' && badges.home ? t('a11y.unreadNotifications') : undefined}
                onLayout={onLayout}
              />
            </TabTrigger>
          );
        })}
      </View>
      <Button
        label={t('shell.addVehicle')}
        variant="secondary"
        size="m"
        fullWidth
        onPress={addVehicle}
        style={styles.add}
        testID="shell.sidebar.addVehicle"
      />
      <View style={styles.account}>
        <AccountSlot />
      </View>
      <Hairline style={styles.divider} />
    </View>
  );
}
