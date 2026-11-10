import { usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useRequireAuth } from '@/state/session';
import { createStyles, typography, useTheme } from '@/theme';
import { EmptyState, Icon, Text, type EmptyStateAction, type IconName } from '@/ui';

const useStyles = createStyles((t) => ({
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  notice: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[12],
    padding: t.space[12],
  },
  noticeText: { flex: 1 },
}));

/** FS-12's grouped inset list: bg.surface, radius 12, rows inside pass `inset={space[16]}` and `divider` on all but the last. */
export function QrRowGroup({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.group, style]} testID={testID}>
      {children}
    </View>
  );
}

/** The 20 glyph sits on the first line of `supporting` text, whatever the font scale. */
function useFirstLineBox(): ViewStyle {
  const { fontScale } = useTheme();
  return { height: typography.supporting.lineHeight * fontScale, justifyContent: 'center' };
}

export type QrNoticeProps = {
  message: string;
  /** `info` for what the member should know, `error` for what went wrong. */
  tone?: 'info' | 'error';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A calm line that belongs to the whole page: icon and text, never colour alone. */
export function QrNotice({ message, tone = 'info', icon, style, testID }: QrNoticeProps) {
  const styles = useStyles();
  const iconBox = useFirstLineBox();
  const error = tone === 'error';
  return (
    <View style={[styles.notice, style]} role={error ? 'alert' : 'status'} testID={testID}>
      <View style={iconBox}>
        <Icon name={icon ?? (error ? 'warning' : 'info')} size={20} color={error ? 'accent.fg' : 'text.secondary'} />
      </View>
      <Text variant="supporting" style={styles.noticeText}>
        {message}
      </Text>
    </View>
  );
}

/** A guest on an owner page: the auth-required sheet, then back here. */
export function QrSignInState({ routeId }: { routeId: string }) {
  const { t } = useTranslation('qr');
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  return (
    <EmptyState
      icon="qr-code"
      title={t('guest.title')}
      body={t('guest.body')}
      action={{ label: t('guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: pathname }) }}
      testID={`${routeId}.guest`}
    />
  );
}

export type QrStateProps = {
  routeId: string;
  /** `.<name>` after the route ID. */
  name: string;
  icon: IconName;
  title: string;
  body: string;
  action?: EmptyStateAction;
};

/** Unavailable, empty and the other whole-page states of the QR routes. */
export function QrState({ routeId, name, icon, title, body, action }: QrStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      action={action}
      testID={`${routeId}.${name}`}
    />
  );
}
