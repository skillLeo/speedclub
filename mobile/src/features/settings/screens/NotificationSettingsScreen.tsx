import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMemberSettings, useUpdateMemberSettings, type NotificationPrefs, type SettingsPatch } from '@/api/queries/settings';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { GuestInvitation } from '@/features/profile/components/GuestInvitation';
import { SAVED_BUILDS_FLAG } from '@/features/vehicle/save';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { ErrorState, Hairline, Skeleton, SkeletonBlock, SkeletonText, Stepper, Text, toast } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { SwitchRow } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';

const ROUTE = 'SET-09';
/** Quiet hours move in half hours; a time the server holds off that grid moves from where it is. */
const TIME_STEP = 30;
const LAST_SLOT = 24 * 60 - TIME_STEP;
/** A time stops moving this long before it is sent, so a run of taps is one request (throttle:account-edits). */
const TIME_SETTLE_MS = 700;

type PushType = 'new_follower' | 'message_request' | 'new_message' | 'followed_published' | 'build_saved';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
  note: { paddingHorizontal: ROW_INSET, paddingVertical: t.space[12] },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[12],
    justifyContent: 'space-between',
    minHeight: t.size.row.single,
    paddingHorizontal: ROW_INSET,
    paddingVertical: t.space[8],
  },
}));

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function timeOf(minutes: number): string {
  const clamped = Math.min(Math.max(0, minutes), 24 * 60 - 1);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function NotificationsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.groups}>
        {[4, 2, 3, 1].map((rows, index) => (
          <View key={index} style={styles.skeletonGroup}>
            <SkeletonText variant="labelS" width="30%" style={styles.skeletonLabel} />
            <SkeletonBlock height={size.row.withThumb * rows} corner="md" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

function TimeRow({ label, value, onChange, disabled, testID }: { label: string; value: number; onChange: (next: number) => void; disabled: boolean; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.timeRow} testID={testID}>
      <Text variant="body" color={disabled ? 'text.disabled' : 'text.primary'}>
        {label}
      </Text>
      <Stepper
        value={value}
        onChange={onChange}
        label={label}
        min={0}
        max={LAST_SLOT}
        step={TIME_STEP}
        formatValue={timeOf}
        disabled={disabled}
        testID={`${testID}.stepper`}
      />
    </View>
  );
}

function NotificationForm({ prefs }: { prefs: NotificationPrefs }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const online = useOnline();
  const failure = useFailureMessage();
  const update = useUpdateMemberSettings();
  const savedBuilds = useFlag(SAVED_BUILDS_FLAG);
  const disabled = !online;
  const [times, setTimes] = useState({ from: minutesOf(prefs.quiet_hours.from), to: minutesOf(prefs.quiet_hours.to) });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server's answer wins once nothing is waiting to be sent.
  const serverFrom = prefs.quiet_hours.from;
  const serverTo = prefs.quiet_hours.to;
  useEffect(() => {
    if (timer.current === null) setTimes({ from: minutesOf(serverFrom), to: minutesOf(serverTo) });
  }, [serverFrom, serverTo]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const send = (patch: SettingsPatch) =>
    update.mutate(patch, { onError: (error) => toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` }) });
  const setPush = (type: PushType, push: boolean) => send({ notification_prefs: { types: { [type]: { push } } } });
  const moveTime = (key: 'from' | 'to', minutes: number) => {
    const next = { ...times, [key]: minutes };
    setTimes(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      send({ notification_prefs: { quiet_hours: { from: timeOf(next.from), to: timeOf(next.to) } } });
    }, TIME_SETTLE_MS);
  };

  const pushRows: { type: PushType; on: boolean }[] = [
    { type: 'new_follower', on: prefs.types.new_follower.push },
    { type: 'message_request', on: prefs.types.message_request.push },
    { type: 'new_message', on: prefs.types.new_message.push },
    { type: 'followed_published', on: prefs.types.followed_published.push },
    ...(savedBuilds ? [{ type: 'build_saved' as const, on: prefs.types.build_saved.push }] : []),
  ];
  const quiet = prefs.quiet_hours.enabled;

  return (
    <View style={styles.groups}>
      {isWeb ? <FormNotice tone="info" message={t('notifications.webNote')} testID={`${ROUTE}.webNote`} /> : null}
      <RowGroup title={t('notifications.pushGroup')} testID={`${ROUTE}.push`}>
        {pushRows.map((row, index) => (
          <SwitchRow
            key={row.type}
            title={t(`notifications.types.${row.type}`)}
            helper={t(`notifications.types.${row.type}Helper`)}
            value={row.on}
            onValueChange={(next) => setPush(row.type, next)}
            disabled={disabled}
            divider={index < pushRows.length - 1}
            testID={`${ROUTE}.push.${row.type}`}
          />
        ))}
      </RowGroup>
      <RowGroup title={t('notifications.previewGroup')} testID={`${ROUTE}.previewGroup`}>
        <SwitchRow
          title={t('notifications.previews')}
          helper={t('notifications.previewsHelper')}
          value={prefs.message_previews}
          onValueChange={(next) => send({ notification_prefs: { message_previews: next } })}
          disabled={disabled}
          testID={`${ROUTE}.previews`}
        />
      </RowGroup>
      <RowGroup title={t('notifications.quietGroup')} testID={`${ROUTE}.quiet`}>
        <SwitchRow
          title={t('notifications.quiet')}
          helper={t('notifications.quietHelper')}
          value={quiet}
          onValueChange={(next) => send({ notification_prefs: { quiet_hours: { enabled: next } } })}
          disabled={disabled}
          divider
          testID={`${ROUTE}.quietEnabled`}
        />
        <TimeRow label={t('notifications.from')} value={times.from} onChange={(next) => moveTime('from', next)} disabled={disabled || !quiet} testID={`${ROUTE}.from`} />
        <Hairline inset={ROW_INSET} />
        <TimeRow label={t('notifications.to')} value={times.to} onChange={(next) => moveTime('to', next)} disabled={disabled || !quiet} testID={`${ROUTE}.to`} />
      </RowGroup>
      <RowGroup title={t('notifications.emailGroup')} testID={`${ROUTE}.email`}>
        <SwitchRow
          title={t('notifications.digest')}
          helper={t('notifications.digestHelper')}
          value={prefs.types.new_message.email_digest}
          onValueChange={(next) => send({ notification_prefs: { types: { new_message: { email_digest: next } } } })}
          disabled={disabled}
          divider
          testID={`${ROUTE}.digest`}
        />
        <Text variant="supporting" color="text.secondary" style={styles.note} testID={`${ROUTE}.mandatory`}>
          {t('notifications.mandatory')}
        </Text>
      </RowGroup>
    </View>
  );
}

/**
 * SET-09 /settings/notifications: push per type from `notification_prefs` (02 §7), message previews (off by default, 08 §1),
 * quiet hours with their times, and the e-mail digest. Security and moderation mails cannot be switched off, and the page says so.
 */
export function NotificationSettingsScreen() {
  const { t } = useTranslation('settings');
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const settings = useMemberSettings();

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestInvitation routeId={ROUTE} returnTo="/settings/notifications" />;
  } else if (qaState === 'loading' || status === 'loading' || (settings.isPending && settings.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = <NotificationsSkeleton />;
  } else if (qaState === 'error' || !settings.data) {
    const offline = !online || settings.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('common.loadErrorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    body = <NotificationForm prefs={settings.data.notification_prefs} />;
  }

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('notifications.title')}
      fallback="/settings"
      offlineLabel={t('notifications.offlineBanner')}
      section="notifications"
    >
      {body}
    </SettingsPage>
  );
}
