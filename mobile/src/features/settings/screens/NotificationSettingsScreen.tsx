import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMemberSettings, useUpdateMemberSettings, type NotificationPrefs, type SettingsPatch } from '@/api/queries/settings';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useWebPush, type WebPushState } from '@/features/pwa/useWebPush';
import { HU_AU_FLAG } from '@/features/garage/screens/EditSpecsScreen';
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
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-09';
/** Quiet hours move in half hours; a time the server holds off that grid moves from where it is. */
const TIME_STEP = 30;
const LAST_SLOT = 24 * 60 - TIME_STEP;
/** A time stops moving this long before it is sent, so a run of taps is one request (throttle:account-edits). */
const TIME_SETTLE_MS = 700;

type PushType = keyof NotificationPrefs['types'];
/** The types with an e-mail switch beside push (the reminders); every other type is push only. */
type EmailType = 'hu_au_reminder' | 'event_reminder';

/** 09 §7.9 SET-09: the categories as groups, each type with its flag (a type whose feature is off is not offered). */
type CategoryRow = { type: PushType; flag?: string; email?: boolean };
type Category = { key: 'builds' | 'messages' | 'events' | 'garage'; rows: readonly CategoryRow[]; flag?: string };

export const NOTIFICATION_CATEGORIES: readonly Category[] = [
  {
    key: 'builds',
    rows: [
      { type: 'followed_published' },
      { type: 'reaction', flag: 'build_reactions' },
      { type: 'mention', flag: 'mentions' },
      { type: 'comment', flag: 'build_comments' },
      { type: 'new_follower' },
      { type: 'vehicle_follower', flag: 'vehicle_follow' },
      { type: 'build_saved', flag: SAVED_BUILDS_FLAG },
    ],
  },
  { key: 'messages', rows: [{ type: 'new_message' }, { type: 'message_request' }] },
  { key: 'events', flag: 'events', rows: [{ type: 'event_reminder', email: true }, { type: 'event_update' }] },
  // ADR-441: the key stays `hu_au_reminder` for every maintenance reminder (HU/AU, Service, Reifen, Versicherung).
  { key: 'garage', rows: [{ type: 'hu_au_reminder', email: true }] },
];

/** The flags the matrix reads. */
function useMatrixFlags(): Readonly<Record<string, boolean>> {
  const reactions = useFlag('build_reactions');
  const mentions = useFlag('mentions');
  const comments = useFlag('build_comments');
  const vehicleFollow = useFlag('vehicle_follow');
  const saved = useFlag(SAVED_BUILDS_FLAG);
  const events = useFlag('events');
  const maintenance = useFlag('maintenance');
  const huAu = useFlag(HU_AU_FLAG);
  return {
    build_reactions: reactions,
    mentions,
    build_comments: comments,
    vehicle_follow: vehicleFollow,
    [SAVED_BUILDS_FLAG]: saved,
    events,
    maintenance,
    [HU_AU_FLAG]: huAu,
  };
}

/** The categories and rows on offer while these flags are on. Fälligkeiten: with maintenance (M4.13) or the v1 HU/AU reminder. */
export function visibleCategories(flags: Readonly<Partial<Record<string, boolean>>>): Category[] {
  return NOTIFICATION_CATEGORIES.filter((category) => (category.key === 'garage' ? flags.maintenance || flags[HU_AU_FLAG] : !category.flag || flags[category.flag]))
    .map((category) => ({ ...category, rows: category.rows.filter((row) => !row.flag || flags[row.flag]) }))
    .filter((category) => category.rows.length > 0);
}

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
        {[5, 2, 1, 3, 1].map((rows, index) => (
          <View key={index} style={styles.skeletonGroup}>
            <SkeletonText variant="callout" width="30%" style={styles.skeletonLabel} />
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

/** The helper line of the browser row for each state (09 §8.13): what is on, or what the member can do. */
const WEB_PUSH_HELPER: Readonly<Record<Exclude<WebPushState['kind'], 'hidden'>, string>> = {
  checking: 'notifications.webPush.helperOff',
  off: 'notifications.webPush.helperOff',
  on: 'notifications.webPush.helperOn',
  denied: 'notifications.webPush.helperDenied',
  needsInstall: 'notifications.webPush.helperInstall',
  unsupported: 'notifications.webPush.helperUnsupported',
  unavailable: 'notifications.webPush.helperUnavailable',
};

/**
 * "In diesem Browser" (ADR-452): one switch for this browser's notifications. The browser asks for permission only after the tap;
 * blocked, unsupported or (iPhone) not installed, the switch stays off and the line under it says what to do.
 */
function BrowserPushGroup({ push, online }: { push: ReturnType<typeof useWebPush>; online: boolean }) {
  const { t } = useTranslation('settings');
  const failure = useFailureMessage();
  const kind = push.state.kind as Exclude<WebPushState['kind'], 'hidden'>;
  const actionable = kind === 'on' || kind === 'off';
  const change = (next: boolean) => {
    const run = next ? push.enable() : push.disable();
    run
      .then((outcome) => {
        if (outcome === 'unavailable') toast(t('notifications.webPush.helperUnavailable'), { testID: `${ROUTE}.webPush.toast` });
        if (outcome === 'noWorker') toast(t('notifications.webPush.noWorker'), { testID: `${ROUTE}.webPush.toast` });
      })
      .catch((error: unknown) => toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.webPush.toast` }));
  };
  return (
    <RowGroup title={t('notifications.webPush.group')} testID={`${ROUTE}.webPush`}>
      <SwitchRow
        title={t('notifications.webPush.title')}
        helper={t(WEB_PUSH_HELPER[kind])}
        value={kind === 'on'}
        onValueChange={change}
        disabled={!actionable || push.busy || !online}
        testID={`${ROUTE}.webPush.${kind}`}
      />
    </RowGroup>
  );
}

function NotificationForm({ prefs }: { prefs: NotificationPrefs }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const online = useOnline();
  const failure = useFailureMessage();
  const update = useUpdateMemberSettings();
  const flags = useMatrixFlags();
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
  // M4.15 (09 §7.9 Web-Push column): with this browser's notifications on, the type switches on the web are its `web_push` channel;
  // otherwise they stay the phone's `push`, as the notice above them says.
  const webPush = useWebPush();
  const channel = isWeb && webPush.state.kind === 'on' ? 'web_push' : 'push';
  const setPush = (type: PushType, next: boolean) => send({ notification_prefs: { types: { [type]: { [channel]: next } } } });
  const setEmail = (type: EmailType, email: boolean) => send({ notification_prefs: { types: { [type]: { email } } } });
  const moveTime = (key: 'from' | 'to', minutes: number) => {
    const next = { ...times, [key]: minutes };
    setTimes(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      send({ notification_prefs: { quiet_hours: { from: timeOf(next.from), to: timeOf(next.to) } } });
    }, TIME_SETTLE_MS);
  };

  const categories = visibleCategories(flags);
  const quiet = prefs.quiet_hours.enabled;

  return (
    <View style={styles.groups}>
      {isWeb && webPush.state.kind !== 'hidden' ? <BrowserPushGroup push={webPush} online={online} /> : null}
      {isWeb ? (
        <FormNotice
          tone="info"
          message={t(
            channel === 'web_push'
              ? 'notifications.webPush.typesNote'
              : webPush.state.kind === 'hidden'
                ? 'notifications.webNote'
                : 'notifications.webPush.phoneNote',
          )}
          testID={`${ROUTE}.webNote`}
        />
      ) : null}
      {categories.map((category) => {
        const rows = category.rows.flatMap((row) => {
          const entries = [{ row, channel: 'push' as const }];
          return row.email ? [...entries, { row, channel: 'email' as const }] : entries;
        });
        return (
          <RowGroup key={category.key} title={t(`notifications.categories.${category.key}`)} testID={`${ROUTE}.${category.key === 'builds' ? 'push' : category.key}`}>
            {rows.map(({ row, channel }, index) => {
              const type = row.type;
              const divider = index < rows.length - 1;
              if (channel === 'email') {
                const emailType = type as EmailType;
                return (
                  <SwitchRow
                    key={`${type}.email`}
                    title={t(`notifications.types.${type}Email`)}
                    helper={t(`notifications.types.${type}EmailHelper`)}
                    value={prefs.types[emailType].email}
                    onValueChange={(next) => setEmail(emailType, next)}
                    disabled={disabled}
                    divider={divider}
                    testID={`${ROUTE}.email.${type}`}
                  />
                );
              }
              return (
                <SwitchRow
                  key={type}
                  title={t(`notifications.types.${type}`)}
                  helper={t(`notifications.types.${type}Helper`)}
                  value={prefs.types[type][channel]}
                  onValueChange={(next) => setPush(type, next)}
                  disabled={disabled}
                  divider={divider}
                  testID={`${ROUTE}.push.${type}`}
                />
              );
            })}
          </RowGroup>
        );
      })}
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
        <Text variant="callout" color="text.secondary" style={styles.note} testID={`${ROUTE}.mandatory`}>
          {t('notifications.mandatory')}
        </Text>
      </RowGroup>
    </View>
  );
}

/**
 * SET-09 /settings/notifications (09 §7.9): per category (Builds & Community · Nachrichten · Treffen · Fälligkeiten) the push switch
 * of each type and, for the reminders, the e-mail switch; message previews (off by default, 08 §1), quiet hours with their times,
 * and the e-mail digest. Types whose feature is off are not offered. Security and moderation mails cannot be switched off, and the
 * page says so. On the web, "In diesem Browser" turns on Web Push (M4.15, ADR-452); the digest frequency waits for the API.
 */
export function NotificationSettingsScreen() {
  const { t } = useTranslation('settings');
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const settings = useMemberSettings();

  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/notifications" />;
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
