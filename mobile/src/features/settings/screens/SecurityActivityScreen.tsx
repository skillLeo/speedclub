import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import {
  newIdempotencyKey,
  useSecureAccount,
  useSecurityEvents,
  type SecurityActivity,
  type SecurityEvent,
} from '@/api/queries/accountSecurity';
import { endLocalSessionQuietly } from '@/api/queries/auth';
import { holdSecuredAccount } from '@/features/auth/securedAccount';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useBack } from '@/features/vehicle/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { hapticFor } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useTheme } from '@/theme';
import {
  Button,
  CollapsingFlashList,
  ContextMenuButton,
  Dialog,
  ErrorState,
  Icon,
  SampleBadge,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
  type IconName,
} from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';
import { RowDivider } from '@/ui/rowParts';
import { metaLineText } from '@/ui/textBreaks';

import { deviceNameText } from '../deviceLines';
import { SettingsSplit, useSettingsSplit } from '../components/SettingsSplit';
import { useFailureMessage } from '../forms';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-21';
const SKELETON_ROWS = 4;
/** How many more pages a deep link (`?event=`) reads to find its row before it stops looking. */
const DEEP_LINK_PAGES = 3;
/** The hairline starts under the text: past the glyph and its gap (the row's padding is the divider's inset). */
const TEXT_LEAD = size.icon.m + space[12];
/** A row id as the server makes it (ULID), lowercase or not. */
const EVENT_ID = /^[0-9A-Za-z]{26}$/;

/** The glyph of each kind of row (Phosphor, monochrome). */
export const ACTIVITY_GLYPHS: Readonly<Record<SecurityActivity, IconName>> = {
  signed_in: 'sign-in',
  new_device: 'device-mobile',
  sign_in_failed: 'warning',
  sign_in_locked: 'lock-simple',
  password_changed: 'lock-key',
  password_reset: 'lock-key',
  email_changed: 'envelope-simple',
  two_factor_enabled: 'shield-check',
  two_factor_disabled: 'shield-warning',
  recovery_codes_regenerated: 'shield-check',
  recovery_code_used: 'shield-warning',
  passkey_added: 'key',
  passkey_removed: 'key',
  passkey_rejected: 'shield-warning',
  provider_linked: 'link',
  provider_unlinked: 'link',
  sessions_revoked: 'sign-out',
  signed_out_everywhere: 'sign-out',
  token_replay_blocked: 'shield-warning',
  account_secured: 'shield-check',
  data_export_requested: 'download-simple',
  deletion_requested: 'trash',
};

/** A sign-in shows the kind of device it came from (a browser is a desktop); every other row its own glyph. */
export function activityGlyph(event: Pick<SecurityEvent, 'type' | 'device'>): IconName {
  if ((event.type === 'new_device' || event.type === 'signed_in') && event.device?.platform) {
    const platform = event.device.platform;
    if (platform === 'web') return 'desktop';
    if (platform === 'android') return 'android-logo';
    if (platform === 'ios') return 'apple-logo';
  }
  return ACTIVITY_GLYPHS[event.type] ?? 'info';
}

/**
 * DQ-1014: the events whose inline "Das war ich nicht" stays visible: a new device, and changes to the ways in or the address.
 * Routine sign-ins keep the action in their "···" menu, so red stays rare and points at the rows that matter.
 */
export const RISKY_ACTIVITY: ReadonlySet<SecurityActivity> = new Set<SecurityActivity>([
  'new_device',
  'email_changed',
  'passkey_added',
  'provider_linked',
  'two_factor_disabled',
  'token_replay_blocked',
]);

/** How a row offers "Das war ich nicht": inline (marked or risky), in its "···" menu, or not at all (not offered, or this device). */
export function secureActionOf(event: Pick<SecurityEvent, 'type' | 'can_secure' | 'this_device'>, marked: boolean): 'inline' | 'menu' | null {
  if (!event.can_secure || event.this_device) return null;
  return marked || RISKY_ACTIVITY.has(event.type) ? 'inline' : 'menu';
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  intro: { marginBottom: t.space[16] },
  state: { paddingTop: t.space[32] },
  more: { alignItems: 'center', paddingVertical: t.space[16] },
  row: { flexDirection: 'row', gap: t.space[12], paddingHorizontal: t.space[8], paddingVertical: t.space[12] },
  // The row a link named (`?event=`): the selected ground, so it is found at a glance.
  marked: { backgroundColor: t.color.state.selected, borderRadius: t.radius.md },
  glyph: { paddingTop: t.space[2] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  action: { alignItems: 'flex-start', marginTop: t.space[4] },
  // The text button S: its label line in its 32 frame.
  skeletonAction: { alignItems: 'stretch', justifyContent: 'center', minHeight: t.size.button.s },
  // The "···" trigger starts on the title's line (its 44 target overhangs the 22 line evenly).
  menu: { marginTop: -t.space[12] + t.space[2] },
  skeletonRow: { flexDirection: 'row', gap: t.space[12], paddingHorizontal: t.space[8], paddingVertical: t.space[12] },
  skeletonText: { flex: 1, gap: t.space[4] },
  sample: { gap: t.space[12] },
  emptyAction: { alignItems: 'flex-start' },
  sampleHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
}));

type Lines = { title: string; meta: string | null; when: string; detail: string | null };

/** The words of a row: what happened, on which device and how, when (and roughly where), and what else the row counts. */
export function useActivityLines() {
  const { t } = useTranslation('settings');
  const format = useFormat();
  const { fontScale } = useTheme();
  return useCallback(
    (event: SecurityEvent): Lines => {
      const provider = event.details.provider ? t(`signIn.provider.${event.details.provider === 'apple' ? 'apple' : 'google'}`) : null;
      const title = provider && (event.type === 'provider_linked' || event.type === 'provider_unlinked')
        ? t(`activity.types.${event.type}_named`, { provider })
        : t(`activity.types.${event.type}`);
      const device = event.device?.name ? deviceNameText(event.device.name, fontScale) : null;
      const meta = [
        device,
        event.method ? t(`activity.methods.${event.method}`) : null,
        event.details.passkey_provider ?? null,
        event.this_device ? t('activity.thisDevice') : null,
        event.by_staff ? t('activity.byStaff') : null,
      ].filter((part): part is string => Boolean(part));
      const at = new Date(event.occurred_at);
      const when = [
        t('activity.when', { date: format.longDate(at), time: format.time(at) }),
        event.approx_city ? t('activity.approxCity', { city: event.approx_city }) : null,
      ].filter((part): part is string => Boolean(part));
      const details: string[] = [];
      if (event.type === 'sign_in_failed' && typeof event.details.count === 'number') {
        details.push(t('activity.details.failed', { count: event.details.count }));
        if (event.details.last_at) details.push(t('activity.details.lastAt', { time: format.time(new Date(event.details.last_at)) }));
      }
      if (typeof event.details.devices === 'number' && event.details.devices > 0) {
        details.push(t('activity.details.devices', { count: event.details.devices }));
      }
      if (typeof event.details.recovery_codes_left === 'number') {
        details.push(t('activity.details.codesLeft', { count: event.details.recovery_codes_left }));
      }
      return {
        title,
        meta: meta.length > 0 ? metaLineText(meta.join(' · ')) : null,
        when: metaLineText(when.join(' · ')),
        detail: details.length > 0 ? details.join(' · ') : null,
      };
    },
    [fontScale, format, t],
  );
}

type RowProps = {
  event: SecurityEvent;
  marked: boolean;
  divider: boolean;
  disabled: boolean;
  columnStyle: StyleProp<ViewStyle>;
  onSecure: (event: SecurityEvent) => void;
};

/** One row: glyph, what happened, device and method, time and place, counts, and "Das war ich nicht" where the server offers it. */
const ActivityRow = memo(function ActivityRow({ event, marked, divider, disabled, columnStyle, onSecure }: RowProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const lines = useActivityLines()(event);
  const testID = `${ROUTE}.row.${event.id}`;
  const action = secureActionOf(event, marked);
  return (
    <View style={columnStyle}>
      <View style={[styles.row, marked ? styles.marked : null]} testID={marked ? `${testID}.marked` : testID}>
        <View style={styles.glyph}>
          <Icon name={activityGlyph(event)} size={20} color="text.secondary" />
        </View>
        <View style={styles.text}>
          <Text variant="body" hyphenate={false} testID={`${testID}.title`}>
            {lines.title}
          </Text>
          {lines.meta ? (
            <Text variant="callout" color="text.secondary" testID={`${testID}.meta`}>
              {lines.meta}
            </Text>
          ) : null}
          <Text variant="callout" color="text.secondary" numeric testID={`${testID}.when`}>
            {lines.when}
          </Text>
          {lines.detail ? (
            <Text variant="callout" color="text.secondary" numeric testID={`${testID}.detail`}>
              {lines.detail}
            </Text>
          ) : null}
          {action === 'inline' ? (
            <View style={styles.action}>
              <Button
                label={t('activity.notMe')}
                variant="destructive"
                size="s"
                flush="start"
                disabled={disabled}
                accessibilityLabel={t('activity.notMeNamed', { event: lines.title })}
                onPress={() => onSecure(event)}
                testID={`${testID}.notMe`}
              />
            </View>
          ) : null}
        </View>
        {action === 'menu' ? (
          <ContextMenuButton
            label={t('activity.rowActions', { event: lines.title })}
            items={[{ key: 'notMe', label: t('activity.notMe'), icon: 'shield-warning', destructive: true, disabled, onSelect: () => onSecure(event) }]}
            style={styles.menu}
            testID={`${testID}.more`}
          />
        ) : null}
        {divider ? <RowDivider inset={space[8]} lead={TEXT_LEAD} /> : null}
      </View>
    </View>
  );
});

const SAMPLE_DEVICE: SecurityEvent['device'] = { name: null, platform: 'ios' };

/** Never an empty grey list: the shape of a real row, badged Beispiel (09 §8.19), and what will appear here. */
function ActivitySample() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  return (
    <View style={styles.sample} testID={`${ROUTE}.empty`}>
      <View style={styles.row} testID={`${ROUTE}.sample`}>
        <View style={styles.glyph}>
          {/* DQ-1021: the glyph a real iPhone sign-in row shows. */}
          <Icon name={activityGlyph({ type: 'signed_in', device: SAMPLE_DEVICE })} size={20} color="text.secondary" />
        </View>
        <View style={styles.text}>
          <View style={styles.sampleHead}>
            <Text variant="body">{t('activity.types.signed_in')}</Text>
            <SampleBadge />
          </View>
          {/* DQ-1046: the same "·" rule as the real rows; the date's day, month and year stay together, the time may wrap. */}
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.sample.meta`}>
            {metaLineText(t('activity.sampleMeta'))}
          </Text>
        </View>
      </View>
      <Text variant="callout" color="text.secondary">
        {t('activity.emptyBody')}
      </Text>
      {/* DQ-1021: sample + one action (09 §5 EmptyState). */}
      <View style={styles.emptyAction}>
        <Button
          label={t('activity.emptyAction')}
          variant="tertiary"
          size="m"
          flush="start"
          onPress={() => router.push('/settings/security/sessions')}
          testID={`${ROUTE}.empty.sessions`}
        />
      </View>
    </View>
  );
}

/**
 * SET-21 /settings/security/activity "Sicherheitsaktivität" (09 §7.9, §8.4): what happened in the account in the last 12 months,
 * newest first: sign-ins with device and method, new devices, failed attempts per day, changes to password, e-mail, two-factor,
 * passkeys and providers, devices signed out. No IP address; a place only when the server knows it roughly (OA-33). A link from a
 * login alert or HOME-02 (`?event=<id>`) marks its row and scrolls to it. "Das war ich nicht" asks first, then secures the whole
 * account (signs out everywhere, this device too, opens a support request) and shows the result on /auth/secure.
 */
export function SecurityActivityScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const readOnly = useViewAsReadOnly();
  const failure = useFailureMessage();
  const status = useSessionStore((state) => state.status);
  const back = useBack('/settings');
  const split = useSettingsSplit();
  const focused = useScreenFocused();
  const params = useLocalSearchParams<{ event?: string | string[] }>();
  const target = typeof params.event === 'string' && EVENT_ID.test(params.event) ? params.event.toLowerCase() : null;
  const query = useSecurityEvents();
  const secure = useSecureAccount();
  const [confirming, setConfirming] = useState<SecurityEvent | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const listRef = useRef<FlashListRef<SecurityEvent>>(null);
  const { forget } = useRetainedListScroll(listRef);
  const rows = useMemo(() => (qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])), [qaState, query.data]);
  const markedIndex = target ? rows.findIndex((row) => row.id.toLowerCase() === target) : -1;
  const searched = useRef(0);
  const scrolled = useRef<string | null>(null);

  // A deep link to an older row: read on a few pages to find it, then scroll it into view once.
  useEffect(() => {
    if (!target || markedIndex !== -1 || !query.hasNextPage || query.isFetchingNextPage || searched.current >= DEEP_LINK_PAGES) return;
    searched.current += 1;
    void query.fetchNextPage();
  }, [markedIndex, query, target]);
  useEffect(() => {
    if (markedIndex < 0 || scrolled.current === target) return;
    scrolled.current = target;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index: markedIndex, animated: false, viewPosition: 0.3 }), 0);
    return () => clearTimeout(timer);
  }, [markedIndex, target]);

  const ask = useCallback((event: SecurityEvent) => {
    hapticFor('longPressMenu');
    setConfirming(event);
  }, []);
  const run = async () => {
    const event = confirming;
    if (!event) return;
    try {
      const result = await secure.mutateAsync({ eventId: event.id, idempotencyKey: key });
      hapticFor('destructiveConfirm');
      holdSecuredAccount(result);
      setConfirming(null);
      // The server signed out every device, this one too: the result screen says what happened, then the way back in. It is a
      // guest path, so the session may end here once the screen is there.
      router.replace('/auth/secure');
      await endLocalSessionQuietly();
    } catch (error) {
      setConfirming(null);
      setKey(newIdempotencyKey());
      toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });
    }
  };

  let state: ReactNode = null;
  let loading = false;
  if (status === 'guest') {
    state = <SettingsGuest routeId={ROUTE} returnTo="/settings/security/activity" />;
  } else if (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    loading = true;
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        {/* DQ-1013: the rows as they load: title, device and method, time; the first (newest, often a new device) with the line of
            its inline action (DQ-1014). The "···" of routine rows is a glyph, not content, and is not drawn. */}
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonBlock width={size.icon.m} height={size.icon.m} corner="xs" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="body" width="45%" />
              <SkeletonText variant="callout" width="70%" />
              <SkeletonText variant="callout" width="55%" />
              {index === 0 ? (
                <View style={[styles.action, styles.skeletonAction]}>
                  <SkeletonText variant="body" width="40%" />
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </Skeleton>
    );
  } else if (qaState === 'error' || (!query.data && qaState !== 'empty')) {
    const offline = !online || query.fetchStatus === 'paused';
    state = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('activity.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = <ActivitySample />;
  }

  return (
    <SettingsSplit routeId={ROUTE} section="activity">
      <PushedListPage
        routeId={ROUTE}
        title={t('activity.title')}
        onBack={split ? undefined : back}
        offlineLabel={t('activity.offlineBanner')}
        onScrollToTop={(animated) => {
          forget();
          listRef.current?.scrollToOffset({ offset: 0, animated });
        }}
        overlays={
          <Dialog
            visible={confirming !== null}
            onClose={secure.isPending ? undefined : () => setConfirming(null)}
            title={t('activity.confirmTitle')}
            // DQ-1015: one text with AUTH-17, so both name every consequence (ADR-435).
            body={t('secure.what', { ns: 'auth' })}
            testID={`${ROUTE}.dialog`}
            actions={[
              {
                label: t('common.cancel'),
                variant: 'secondary',
                disabled: secure.isPending,
                onPress: () => setConfirming(null),
                testID: `${ROUTE}.dialog.cancel`,
              },
              {
                label: t('activity.confirm'),
                destructive: true,
                loading: secure.isPending,
                onPress: () => void run(),
                testID: `${ROUTE}.dialog.confirm`,
              },
            ]}
          />
        }
        renderList={(frame) => (
          <CollapsingFlashList
            ref={listRef}
            {...frame.scrollProps}
            data={state ? [] : rows}
            keyExtractor={(event: SecurityEvent) => event.id}
            extraData={markedIndex}
            style={styles.list}
            contentContainerStyle={frame.contentContainerStyle}
            ListHeaderComponent={
              status === 'guest' ? null : (
                <View style={frame.columnStyle}>
                  <Text variant="body" color="text.secondary" style={styles.intro} testID={`${ROUTE}.intro`}>
                    {t('activity.intro')}
                  </Text>
                </View>
              )
            }
            ListEmptyComponent={state ? <View style={[frame.columnStyle, loading ? null : styles.state]}>{state}</View> : null}
            ListFooterComponent={
              <View style={[frame.columnStyle, frame.endStyle]}>
                {query.isFetchingNextPage ? (
                  <View style={styles.more}>
                    <Spinner testID={`${ROUTE}.more`} />
                  </View>
                ) : null}
              </View>
            }
            onEndReached={() => {
              if (focused && query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
            }}
            onEndReachedThreshold={0.5}
            renderItem={({ item, index }: { item: SecurityEvent; index: number }) => (
              <ActivityRow
                event={item}
                marked={index === markedIndex}
                divider={index < rows.length - 1}
                disabled={readOnly || !online || secure.isPending}
                columnStyle={frame.columnStyle}
                onSecure={ask}
              />
            )}
            testID={`${ROUTE}.list`}
          />
        )}
      />
    </SettingsSplit>
  );
}
