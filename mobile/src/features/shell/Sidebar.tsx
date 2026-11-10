import { TabTrigger } from 'expo-router/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, layout, size, space, useTheme } from '@/theme';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { Avatar, Button, Hairline, Icon, PressableScale, Text } from '@/ui';
import type { PressableVisualState } from '@/ui/PressableScale';
import { LARGE_FONT_SCALE } from '@/ui/rowParts';
import { typeStyle } from '@/ui/Text';
import { useSafeEdge } from '@/ui/safeArea';

import { TAB_DESTINATIONS } from './destinations';
import { SlidingIndicator } from './SlidingIndicator';
import { TabButton } from './TabButton';
import { useAddVehicle } from './useAddVehicle';
import { useTabBadges } from './useTabBadges';
import { useTabNavigation } from './useTabNavigation';

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
 * DQ-078: at this font scale "Nachrichten" still fits a row of 216. Above it the word hyphenates and its row grows, which breaks the
 * rhythm of the list: the destinations and the sign-in stop growing here, as the labels of the tab bar and the rail do at theirs
 * (ADR-162). A cap of its own: it is measured against the row, and does not follow LARGE_FONT_SCALE.
 */
export const SIDEBAR_LABEL_CAP = 1.5;

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
          router.push('/sign-in');
        }}
        contentStyle={({ hovered }: PressableVisualState) => [styles.accountContent, hovered ? styles.hovered : null]}
        testID="shell.sidebar.signIn"
      >
        <Icon name="sign-in" size={24} color="text.primary" />
        <Text
          variant="label"
          selectable={false}
          maxFontSizeMultiplier={SIDEBAR_LABEL_CAP}
          style={[styles.signInLabel, typeStyle('label', isWeb ? Math.min(fontScale, SIDEBAR_LABEL_CAP) : 1)]}
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
      <Text variant="label" numberOfLines={fontScale >= LARGE_FONT_SCALE ? 2 : 1} style={styles.accountName} testID="shell.sidebar.account.name">
        {name}
      </Text>
    </PressableScale>
  );
}

type RowLayout = { y: number; height: number };

/** The file's ratio gives 35.9 at this width, which would put every row below it on a fractional y. */
const LOGO_HEIGHT = space[32] + space[4];

/** From 1280: 240 wide with the small logo, the five destinations, "Fahrzeug hinzufügen" and the account slot. */
export function Sidebar() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const padding = useSafeEdge('top');
  const badges = useTabBadges();
  const addVehicle = useAddVehicle();
  const { activeIndex, pressHandler } = useTabNavigation();
  // Rows grow with the font scale, so the indicator follows their real positions.
  const [rows, setRows] = useState<Record<number, RowLayout>>({});

  const row = rows[activeIndex];
  const offset = row
    ? row.y + (row.height - space[16]) / 2
    : activeIndex * size.row.single + (size.row.single - space[16]) / 2;

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
        <SlidingIndicator axis="y" offset={offset} style={styles.indicator} testID="shell.sidebar.indicator" />
        {TAB_DESTINATIONS.map((destination, index) => (
          <TabTrigger key={destination.name} name={destination.name} asChild onPress={pressHandler(destination.name)}>
            <TabButton
              variant="sidebar"
              icon={destination.icon}
              label={t(destination.labelKey)}
              labelCap={SIDEBAR_LABEL_CAP}
              testID={destination.testID}
              count={destination.name === 'messages' ? badges.messages : undefined}
              dotLabel={destination.name === 'home' && badges.home ? t('a11y.unreadNotifications') : undefined}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                setRows((current) => ({ ...current, [index]: { y, height } }));
              }}
            />
          </TabTrigger>
        ))}
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
