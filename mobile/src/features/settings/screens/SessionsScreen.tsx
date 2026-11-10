import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { GuestInvitation } from '@/features/profile/components/GuestInvitation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { metaLineText } from '@/ui/textBreaks';

import { platformLabel } from '../deviceLines';
import { createStyles, size } from '@/theme';
import { Button, Dialog, EmptyState, ErrorState, Hairline, Skeleton, SkeletonBlock, SkeletonText, StatusPill, Text, toast } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';
import { settingsKeys, useDeviceSessions, useRevokeOtherSessions, useRevokeSession, type DeviceSession } from '@/api/queries/settings';

const ROUTE = 'SET-06';
const SKELETON_ROWS = 3;

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
  text: { flexBasis: '55%', flexGrow: 1, gap: t.space[2], minWidth: 0 },
  title: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  skeletonRow: { gap: t.space[4], justifyContent: 'center', minHeight: t.size.row.withThumb, paddingHorizontal: ROW_INSET },
}));

/** "iPhone 15 · iOS · App 0.4.0" or "Browser · Web"; never an IP address or a place (§3.1). */
function useDeviceLines() {
  const { t } = useTranslation('settings');
  const format = useFormat();
  return (session: DeviceSession) => {
    const name = session.deviceName ?? t(session.kind === 'web' ? 'sessions.browser' : 'sessions.unknownDevice');
    // DQ-457: the platform as a word ("iOS", "Android"), never the raw value; a web session's name already says the browser and system.
    const platform = session.kind === 'web' ? null : platformLabel(session.platform);
    const parts = [platform, session.appVersion ? t('sessions.appVersion', { version: session.appVersion }) : null].filter(
      (part): part is string => Boolean(part),
    );
    const used = session.current ? t('sessions.activeNow') : t('sessions.lastUsed', { time: format.relative(new Date(session.lastUsedAt)) });
    // DQ-458: the meta line wraps at its "·" and keeps "Zuletzt vor 3 Tagen" whole.
    return { name, meta: metaLineText([...parts, used].join(' · '), used.length, 'starts') };
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
        <View style={styles.text}>
          <View style={styles.title}>
            <Text variant="body" hyphenate={false}>
              {lines.name}
            </Text>
            {session.current ? <StatusPill label={t('sessions.thisDevice')} testID={`${testID}.current`} /> : null}
          </View>
          <Text variant="supporting" color="text.secondary">
            {lines.meta}
          </Text>
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

function SessionsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="bodyDense" lines={2} />
        <RowGroup>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <View key={index}>
              <View style={styles.skeletonRow}>
                <SkeletonText variant="body" width="45%" />
                <SkeletonText variant="supporting" width="60%" />
              </View>
              {index < SKELETON_ROWS - 1 ? <Hairline inset={ROW_INSET} /> : null}
            </View>
          ))}
        </RowGroup>
        <SkeletonBlock height={size.button.m} width="60%" corner="sm" />
      </View>
    </Skeleton>
  );
}

type Confirm = { kind: 'one'; session: DeviceSession; name: string } | { kind: 'others' } | null;

/**
 * SET-06 /settings/security/sessions: this device first and marked, then the others, newest use first. Signing one out, or all
 * others, asks first; ending a device also ends its push. Only device, platform, app version and last use (§3.1).
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
      toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });
    }
  };

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestInvitation routeId={ROUTE} returnTo="/settings/security/sessions" />;
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
    body = (
      <View style={styles.body}>
        <Text variant="bodyDense" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('sessions.intro')}
        </Text>
        <RowGroup testID={`${ROUTE}.list`}>
          {sessions.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              divider={index < sessions.length - 1}
              onRevoke={(target) => setConfirm({ kind: 'one', session: target, name: lines(target).name })}
            />
          ))}
        </RowGroup>
        {others.length > 0 ? (
          <Button
            disabled={readOnly}
            label={t('sessions.signOutOthers')}
            variant="destructive"
            size="m"
            onPress={() => setConfirm({ kind: 'others' })}
            testID={`${ROUTE}.signOutOthers`}
          />
        ) : (
          <Text variant="supporting" color="text.secondary" testID={`${ROUTE}.onlyThis`}>
            {t('sessions.onlyThis')}
          </Text>
        )}
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
