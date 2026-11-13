import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';

import { metaLineText } from '@/ui/textBreaks';

import { deviceMetaText, deviceNameText, platformLabel } from '../deviceLines';
import { formatLegalDate } from '../legalDate';
import { createStyles, size, useBreakpoint, useTheme } from '@/theme';
import { Button, Dialog, EmptyState, ErrorState, Hairline, Icon, Skeleton, SkeletonBlock, SkeletonText, Text, toast, type IconName } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { isReauthCancelled } from '@/api/queries/recentAuth';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';
import { settingsKeys, useDeviceSessions, useRevokeOtherSessions, useRevokeSession, type DeviceSession } from '@/api/queries/settings';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-06';
/** The other devices a loading page holds: most members have one more. */
const SKELETON_ROWS = 1;
/** About the width of "Abmelden" in a secondary M button. */
const SKELETON_BUTTON_WIDTH = size.touchMin * 2;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingHorizontal: ROW_INSET,
    paddingVertical: t.space[12],
  },
  // The platform glyph and the text: they stay together when the button wraps under them.
  lead: { alignItems: 'flex-start', flexBasis: '55%', flexDirection: 'row', flexGrow: 1, gap: t.space[12], minWidth: 0 },
  glyph: { paddingTop: t.space[2] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  groups: { gap: t.space[24] },
  actions: { alignItems: 'flex-start', gap: t.space[8] },
  // RowGroup's anatomy: the header 16 inside, 8 above the card.
  skeletonGroup: { gap: t.space[8] },
  skeletonHeader: { paddingHorizontal: t.space[16] },
  skeletonLink: { alignSelf: 'stretch', justifyContent: 'center', minHeight: t.size.button.m },
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** 09 §7.9 SET-06: the platform glyph of a session (a browser is a desktop). */
export function sessionGlyph(session: Pick<DeviceSession, 'kind' | 'platform'>): IconName {
  if (session.kind === 'web') return 'desktop';
  const platform = session.platform?.toLowerCase();
  return platform === 'android' ? 'android-logo' : platform === 'ios' ? 'apple-logo' : 'device-mobile';
}

/**
 * "iPhone 15 Pro" over "iOS 26.1 · App 1.4.0 · Zuletzt vor 2 Std." and "Angemeldet seit 3. November 2026 · ungefähr München". No IP
 * address ever (ADR-433); the place only when the server knows it (approx_city, OA-33), and then as approximate.
 */
function useDeviceLines() {
  const { t } = useTranslation('settings');
  const format = useFormat();
  const { fontScale } = useTheme();
  return (session: DeviceSession) => {
    const name = session.deviceName ?? t(session.kind === 'web' ? 'sessions.browser' : 'sessions.unknownDevice');
    // DQ-457: the platform as a word ("iOS", "Android"), never the raw value; a web session's name already says the browser and system.
    const platform = session.kind === 'web' ? null : platformLabel(session.platform);
    const system = platform && session.osVersion ? `${platform} ${session.osVersion}` : platform;
    const parts = [system, session.appVersion ? t('sessions.appVersion', { version: session.appVersion }) : null].filter(
      (part): part is string => Boolean(part),
    );
    const used = session.current ? t('sessions.activeNow') : t('sessions.lastUsed', { time: format.relative(new Date(session.lastUsedAt)) });
    // DQ-1084: a month is never hyphenated ("Ok- / tober"); day and month stay together, the year may wrap (formatLegalDate).
    const since = session.signedInAt ? t('sessions.signedInSince', { date: formatLegalDate(new Date(session.signedInAt), format.locale) }) : null;
    const place = session.approxCity ? t('sessions.approxCity', { city: session.approxCity }) : null;
    const detail = [since, place].filter((part): part is string => Boolean(part));
    // DQ-458: the meta line wraps at its "·" and keeps "Zuletzt vor 3 Tagen" whole.
    // DQ-910: the shown name never breaks inside or hyphenates (deviceNameText, hyphenate off); the button names it plainly.
    return {
      name,
      shownName: deviceNameText(name, fontScale),
      meta: deviceMetaText(parts, used),
      detail: detail.length > 0 ? metaLineText(detail.join(' · ')) : null,
    };
  };
}

function SessionRow({ session, divider, onRevoke }: { session: DeviceSession; divider: boolean; onRevoke: (session: DeviceSession) => void }) {
  const { t } = useTranslation('settings');
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const lines = useDeviceLines()(session);
  const testID = `${ROUTE}.row.${session.id}`;
  return (
    <View>
      <View style={styles.row} testID={testID}>
        <View style={styles.lead}>
          <View style={styles.glyph}>
            <Icon name={sessionGlyph(session)} size={20} color="text.secondary" testID={`${testID}.glyph`} />
          </View>
          <View style={styles.text}>
            <Text variant="body" hyphenate={false} testID={`${testID}.name`}>
              {lines.shownName}
            </Text>
            <Text variant="callout" color="text.secondary" testID={`${testID}.meta`}>
              {lines.meta}
            </Text>
            {lines.detail ? (
              <Text variant="callout" color="text.secondary" hyphenate={false} testID={`${testID}.detail`}>
                {lines.detail}
              </Text>
            ) : null}
          </View>
        </View>
        {session.current ? null : (
          <Button
            disabled={readOnly}
            label={t('sessions.signOut')}
            variant="secondary"
            size="m"
            onPress={() => onRevoke(session)}
            accessibilityLabel={t('sessions.signOutNamed', { name: lines.name })}
            testID={`${testID}.revoke`}
          />
        )}
      </View>
      {divider ? <Hairline inset={ROW_INSET} /> : null}
    </View>
  );
}

/** One loading row with the geometry of `SessionRow`: glyph, name and meta line, and "Abmelden" for another device. */
function SkeletonSessionRow({ other, divider }: { other: boolean; divider: boolean }) {
  const styles = useStyles();
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.lead}>
          <View style={styles.glyph}>
            <SkeletonBlock width={size.icon.m} height={size.icon.m} corner="xs" />
          </View>
          <View style={styles.text}>
            <SkeletonText variant="body" width="55%" />
            <SkeletonText variant="callout" width="60%" />
          </View>
        </View>
        {other ? <SkeletonBlock width={SKELETON_BUTTON_WIDTH} height={size.button.m} corner="sm" /> : null}
      </View>
      {divider ? <Hairline inset={ROW_INSET} /> : null}
    </View>
  );
}

/**
 * DQ-1013: the loaded page's geometry: the intro (5 lines on a phone, 3 from 768), "Dieses Gerät" with one row, "Andere Geräte"
 * with one, then the two text actions.
 */
function SessionsSkeleton() {
  const styles = useStyles();
  const { kind } = useBreakpoint();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={kind === 'phone' ? 5 : 3} />
        <View style={styles.groups}>
          <View style={styles.skeletonGroup}>
            <View style={styles.skeletonHeader}>
              <SkeletonText variant="calloutStrong" width="35%" />
            </View>
            <View style={styles.skeletonCard}>
              <SkeletonSessionRow other={false} divider={false} />
            </View>
          </View>
          <View style={styles.skeletonGroup}>
            <View style={styles.skeletonHeader}>
              <SkeletonText variant="calloutStrong" width="40%" />
            </View>
            <View style={styles.skeletonCard}>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <SkeletonSessionRow key={index} other divider={index < SKELETON_ROWS - 1} />
              ))}
            </View>
          </View>
        </View>
        {/* The two text actions: their label lines in their 44 targets. */}
        <View style={styles.actions}>
          <View style={styles.skeletonLink}>
            <SkeletonText variant="body" width="60%" />
          </View>
          <View style={styles.skeletonLink}>
            <SkeletonText variant="body" width="55%" />
          </View>
        </View>
      </View>
    </Skeleton>
  );
}

type Confirm = { kind: 'one'; session: DeviceSession; name: string } | { kind: 'others' } | null;

/**
 * SET-06 /settings/security/sessions (09 §7.9, §8.4): this device as its own group, then the others, newest use first, each with its
 * platform glyph, system and app version, last use, sign-in date and the approximate place when known. Signing one out asks first;
 * "Alle anderen abmelden" asks first and then for recent authentication (the reauth sheet). Ending a device also ends its push.
 */
export function SessionsScreen() {
  const { t } = useTranslation('settings');
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const client = useQueryClient();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const failure = useFailureMessage();
  const query = useDeviceSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const lines = useDeviceLines();
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);

  const sessions = qaState === 'empty' ? [] : [...(query.data ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt),
  );
  const others = sessions.filter((session) => !session.current);
  const busy = revoke.isPending || revokeOthers.isPending;

  const settle = (message: string) => {
    setConfirm(null);
    toast(message, { testID: `${ROUTE}.toast` });
    void client.invalidateQueries({ queryKey: settingsKeys.sessions });
  };
  const run = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'one') {
        await revoke.mutateAsync(confirm.session.id);
        settle(t('sessions.signedOutOne', { name: confirm.name }));
      } else {
        await revokeOthers.mutateAsync();
        settle(t('sessions.signedOutOthers'));
      }
    } catch (error) {
      setConfirm(null);
      // M4.6: closing the reauth sheet changes nothing, so it says nothing.
      if (isReauthCancelled(error)) return;
      toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });
    }
  };

  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/security/sessions" />;
  } else if (qaState === 'loading' || status === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'empty')) {
    body = <SessionsSkeleton />;
  } else if (qaState === 'error' || (!query.data && qaState !== 'empty')) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('sessions.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (sessions.length === 0) {
    body = <EmptyState icon="device-mobile" title={t('sessions.emptyTitle')} body={t('sessions.emptyBody')} testID={`${ROUTE}.empty`} />;
  } else {
    const current = sessions.filter((session) => session.current);
    const row = (session: DeviceSession, index: number, list: readonly DeviceSession[]) => (
      <SessionRow
        key={session.id}
        session={session}
        divider={index < list.length - 1}
        onRevoke={(target) => setConfirm({ kind: 'one', session: target, name: lines(target).name })}
      />
    );
    body = (
      <View style={styles.body}>
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('sessions.intro')}
        </Text>
        {/* 09 §7.9: this device first, as a card of its own, then the others with "Abmelden" each. */}
        <View style={styles.groups} testID={`${ROUTE}.list`}>
          {current.length > 0 ? (
            <RowGroup title={t('sessions.thisDevice')} testID={`${ROUTE}.current`}>
              {current.map(row)}
            </RowGroup>
          ) : null}
          {others.length > 0 ? (
            <RowGroup title={t('sessions.otherDevices')} testID={`${ROUTE}.others`}>
              {others.map(row)}
            </RowGroup>
          ) : null}
        </View>
        <View style={styles.actions}>
          {others.length > 0 ? (
            <Button
              disabled={readOnly}
              label={t('sessions.signOutOthers')}
              variant="destructive"
              size="m"
              flush="start"
              onPress={() => setConfirm({ kind: 'others' })}
              testID={`${ROUTE}.signOutOthers`}
            />
          ) : (
            <Text variant="callout" color="text.secondary" testID={`${ROUTE}.onlyThis`}>
              {t('sessions.onlyThis')}
            </Text>
          )}
          <Button
            label={t('sessions.activity')}
            variant="tertiary"
            size="m"
            flush="start"
            role="link"
            onPress={() => router.push('/settings/security/activity')}
            testID={`${ROUTE}.activity`}
          />
        </View>
      </View>
    );
  }

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('sessions.title')}
      fallback="/settings"
      offlineLabel={t('sessions.offlineBanner')}
      section="sessions"
      overlays={
        <Dialog
          visible={confirm !== null}
          onClose={busy ? undefined : () => setConfirm(null)}
          title={confirm?.kind === 'one' ? t('sessions.confirmOneTitle', { name: confirm.name }) : t('sessions.confirmOthersTitle')}
          body={confirm?.kind === 'one' ? t('sessions.confirmOneBody') : t('sessions.confirmOthersBody', { count: others.length })}
          testID={`${ROUTE}.dialog`}
          actions={[
            { label: t('common.cancel'), variant: 'secondary', disabled: busy, onPress: () => setConfirm(null), testID: `${ROUTE}.dialog.cancel` },
            {
              label: confirm?.kind === 'one' ? t('sessions.signOut') : t('sessions.signOutOthersShort'),
              destructive: true,
              loading: busy,
              onPress: () => void run(),
              testID: `${ROUTE}.dialog.confirm`,
            },
          ]}
        />
      }
    >
      {body}
    </SettingsPage>
  );
}
