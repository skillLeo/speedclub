import * as WebBrowser from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppConfig, type Announcement } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { useFirstLineBox } from '@/features/auth/components/lineBox';
import { now } from '@/lib/clock';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Icon, IconButton, Text } from '@/ui';

import { dismissAnnouncement, hydrateDismissals, useDismissalStore } from './dismissals';
import { announcementLink, isWarning, visibleAnnouncements, type AnnouncementViewer } from './model';

const useStyles = createStyles((t) => ({
  card: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.md,
    flexDirection: 'row',
    gap: t.space[12],
    paddingBottom: t.space[12],
    paddingLeft: t.space[16],
    paddingTop: t.space[12],
  },
  text: { flex: 1, gap: t.space[4], minWidth: 0, paddingTop: t.space[4] },
  textEnd: { paddingRight: t.space[16] },
  iconTop: { marginTop: t.space[4] },
  // The 44 target sits in the card's corner, centred on the title's line (12 + 4 + 10 = 12 − 8 + 22).
  dismiss: { marginTop: -t.space[8] },
}));

/** The announcements this viewer sees now (app-config, audience, schedule, this device's dismissals). */
export function useAnnouncements(): Announcement[] {
  const { config } = useAppConfig();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const ids = useDismissalStore((state) => state.ids);
  const hydrated = useDismissalStore((state) => state.hydrated);
  useEffect(() => {
    void hydrateDismissals();
  }, []);
  const memberSince = me.data?.member_since ?? null;
  // A partial Me (an older cache) has no stats: no vehicles then.
  const vehicles = me.data?.stats?.vehicles ?? 0;
  return useMemo(() => {
    const viewer: AnnouncementViewer = status === 'member' ? { memberSince, vehicles } : null;
    const shown = visibleAnnouncements(config.announcements, viewer, new Set(ids), now());
    // Until the device's dismissals are read, a dismissible one waits: it must not flash and vanish.
    return hydrated ? shown : shown.filter((announcement) => announcement.dismissible === false);
  }, [config.announcements, hydrated, ids, memberSince, status, vehicles]);
}

export type AnnouncementBannerProps = {
  /** The route that shows it, for the testIDs: `<routeId>.announcement.<id>`. */
  routeId: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The announcement on Start (M3.5 ADM-30): the first one this viewer sees, warnings first. Neutral raised card (§8 notices) with a
 * megaphone; only a warning takes the accent, on its glyph alone (§3 red budget). Title, body, an optional action (an internal path
 * in the app, an https link in the in-app browser) and "Ausblenden" when it is dismissible, remembered on this device.
 */
export function AnnouncementBanner({ routeId, style }: AnnouncementBannerProps) {
  const [first] = useAnnouncements();
  if (!first) return null;
  return <AnnouncementCard key={first.id} announcement={first} routeId={routeId} style={style} />;
}

function AnnouncementCard({ announcement, routeId, style }: { announcement: Announcement; routeId: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  const iconBox = useFirstLineBox('bodyStrong');
  const warning = isWarning(announcement);
  const link = announcementLink(announcement.link);
  const dismissible = announcement.dismissible !== false;
  const testID = `${routeId}.announcement.${announcement.id}`;
  const open = () => {
    if (!link) return;
    if (link.kind === 'internal') {
      router.push(link.path as Href);
      return;
    }
    WebBrowser.openBrowserAsync(link.url).catch(() => Linking.openURL(link.url).catch(() => undefined));
  };
  return (
    <View
      role={warning ? 'alert' : 'region'}
      aria-label={warning ? t('announcements.warningLabel', { title: announcement.title }) : announcement.title}
      style={[styles.card, style]}
      testID={testID}
    >
      <View style={[styles.iconTop, iconBox]}>
        <Icon name={warning ? 'warning' : 'megaphone-simple'} size={20} color={warning ? 'accent.fg' : 'text.secondary'} />
      </View>
      <View style={[styles.text, dismissible ? null : styles.textEnd]}>
        <Text variant="bodyStrong" testID={`${testID}.title`}>
          {announcement.title}
        </Text>
        {announcement.body.trim() ? (
          <Text variant="body" color="text.secondary" testID={`${testID}.body`}>
            {announcement.body}
          </Text>
        ) : null}
        {link ? (
          <Button
            label={announcement.cta_label?.trim() || t('announcements.more')}
            variant="tertiary"
            size="m"
            role="link"
            icon={link.kind === 'external' ? 'arrow-square-out' : 'arrow-right'}
            flush="start"
            onPress={open}
            accessibilityLabel={link.kind === 'external' ? t('announcements.externalLabel', { label: announcement.cta_label?.trim() || t('announcements.more') }) : undefined}
            testID={`${testID}.cta`}
          />
        ) : null}
      </View>
      {dismissible ? (
        <IconButton
          icon="x"
          label={t('announcements.dismiss')}
          color="text.secondary"
          onPress={() => dismissAnnouncement(announcement.id)}
          style={styles.dismiss}
          testID={`${testID}.dismiss`}
        />
      ) : null}
    </View>
  );
}
