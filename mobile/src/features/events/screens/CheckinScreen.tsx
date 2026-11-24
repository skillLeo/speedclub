import '@/features/events/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useCheckinEnabled, type CheckinAnswer } from '@/api/queries/eventCheckin';
import { isUnavailable, useEvent } from '@/api/queries/events';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useHideTabBar, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { EventCardSkeleton } from '@/ui/EventCard';
import { Header } from '@/ui/Header';
import { Icon } from '@/ui/icons/Icon';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { StickyCTABar } from '@/ui/StickyCTABar';
import { Text } from '@/ui/Text';

import { EventCardView } from '../components/EventCardView';
import { useCheckinForm } from '../components/CheckinParts';
import { eventPath } from '../model';

const ROUTE = 'EVT-07';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  column: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: layout.feedColumn, width: '100%' },
  centred: { flexGrow: 1, justifyContent: 'center' },
  intro: { gap: t.space[8] },
  success: { alignItems: 'flex-start', gap: t.space[12] },
  inline: { alignSelf: 'flex-start' },
  // The form's geometry (useCheckinForm): 16 between the field and the switch row; the field's label, field and helper 8 apart.
  skeletonForm: { gap: t.space[16] },
  skeletonField: { gap: t.space[8] },
  // As TextInput's helper: 4 under the field (its note pulls up by 4 from the field's 8 gap), so the switch row lands with the page's.
  skeletonNote: { marginTop: -t.space[4] },
  skeletonSwitchRow: {
    alignItems: 'center',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    padding: t.space[16],
  },
  skeletonSwitchText: { flex: 1, gap: t.space[4], minWidth: 0 },
}));

/**
 * DQ-P5-016: the loaded confirm page in bars: the two-line question and its sentence, the EventCard, the code field (label, the 52
 * field, its helper), the "Auf meinem Profil zeigen" row with its switch, and on a tablet or desktop the inline "Einchecken" (on a
 * phone the sticky bar stands in place, disabled until the event is there).
 */
function CheckinSkeleton({ inlineCta }: { inlineCta: boolean }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column}>
        <View style={styles.intro}>
          <SkeletonText variant="title2" lines={2} lastLineWidth="55%" />
          <SkeletonText variant="body" lines={2} lastLineWidth="70%" />
        </View>
        <EventCardSkeleton />
        <View style={styles.skeletonForm}>
          <View style={styles.skeletonField}>
            <SkeletonText variant="callout" width="35%" />
            <SkeletonBlock height={size.input} corner="sm" />
            <SkeletonText variant="caption" width="50%" style={styles.skeletonNote} />
          </View>
          <View style={styles.skeletonSwitchRow}>
            <View style={styles.skeletonSwitchText}>
              <SkeletonText variant="body" width="60%" />
              <SkeletonText variant="callout" lines={2} lastLineWidth="65%" />
            </View>
            <SkeletonBlock width={size.switch.width} height={size.switch.height} corner="full" />
          </View>
        </View>
        {inlineCta ? <SkeletonBlock width={space[96] * 2} height={size.button.l} corner="sm" testID={`${ROUTE}.skeleton.cta`} /> : null}
      </View>
    </Skeleton>
  );
}

/**
 * M5.6 EVT-07 Check-in `/events/[slug]/checkin?code=` (10 §4; m5.6-contract §5.4), behind `events.checkin`: the page the organiser's
 * QR opens with the phone camera. It shows the event, the code from the link (or a field for it), "Auf meinem Profil zeigen" and
 * "Einchecken"; it never checks in by itself. Then "Du bist eingecheckt" and back to the event. A guest signs in first.
 */
export function CheckinScreen() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; code?: string }>();
  const slug = paramOf(params.slug) ?? '';
  const code = paramOf(params.code) ?? null;
  const back = useBack(slug ? `/events/${slug}` : '/events');
  // p5r1 capture (EVT-07 High): a focused flow like the editors (§9): the floating tab bar steps aside, so the sticky "Einchecken" bar
  // is the bottom of the screen and nothing lies over it (it was painted under the bar, which took the tap).
  useHideTabBar();
  const qaState = useQaState();
  const online = useOnline();
  const enabled = useCheckinEnabled();
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const padding = useTabBarPadding();
  const { gutter, kind } = useBreakpoint();
  const query = useEvent(slug);
  const event = qaState === 'default' || qaState === 'restricted' ? query.data : undefined;
  const [done, setDone] = useState<CheckinAnswer | null>(null);
  const form = useCheckinForm({ slug, defaultCode: code, routeId: ROUTE, onDone: setDone });
  const returnTo = `/events/${slug}/checkin${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  const sticky = kind === 'phone';

  let body: ReactNode;
  let centred = true;
  let cta = false;
  let loadingCta = false;
  if (!enabled && qaState === 'default') {
    body = (
      <EmptyState
        icon="meet"
        title={t('checkin.screen.unavailableTitle')}
        body={t('checkin.screen.unavailableBody')}
        action={{ label: t('detail.toEvents'), onPress: back, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.unavailable`}
      />
    );
  } else if (qaState === 'loading' || (qaState === 'default' && !query.data && query.isPending && query.fetchStatus !== 'paused')) {
    centred = false;
    // DQ-P5-016: the confirm page's geometry while it loads, so it does not grow by half a screen when the event arrives.
    cta = true;
    loadingCta = true;
    body = <CheckinSkeleton inlineCta={!sticky} />;
  } else if (qaState === 'empty' || isUnavailable(query.error)) {
    body = (
      <EmptyState
        icon="meet"
        title={t('detail.goneTitle')}
        body={t('detail.goneBody')}
        action={{ label: t('detail.toEvents'), onPress: () => router.replace('/events'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (!event) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    body = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('detail.errorTitle')}
        message={offline ? t('checkin.screen.offline') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (done) {
    body = (
      <View style={styles.success} testID={`${ROUTE}.success`}>
        <Icon name="check-circle" size={24} color="text.primary" />
        <Text variant="title2" role="heading" aria-level={1} testID={`${ROUTE}.success.title`}>
          {t('checkin.screen.successTitle')}
        </Text>
        <Text variant="body" color="text.secondary">
          {done.profile_visible ? t('checkin.screen.successBody') : t('checkin.screen.successBodyHidden')}
        </Text>
        <Button
          label={t('checkin.screen.toEvent')}
          variant="secondary"
          size="m"
          onPress={() => router.replace(eventPath(slug))}
          testID={`${ROUTE}.toEvent`}
        />
      </View>
    );
  } else if (status !== 'member') {
    body = (
      <View style={styles.intro}>
        <EventCardView event={event} routeId={ROUTE} trailing={<View />} />
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.signIn`}>
          {t('checkin.screen.signIn')}
        </Text>
        <Button
          label={t('checkin.screen.signInButton')}
          variant="secondary"
          size="m"
          onPress={() => requireAuth(undefined, { returnTo })}
          style={styles.inline}
          testID={`${ROUTE}.signInButton`}
        />
      </View>
    );
  } else {
    centred = false;
    cta = true;
    body = (
      <>
        <View style={styles.intro}>
          <Text variant="title2" role="heading" aria-level={1} testID={`${ROUTE}.title`}>
            {t('checkin.screen.confirmTitle', { title: event.title })}
          </Text>
          <Text variant="body" color="text.secondary">
            {code ? t('checkin.screen.confirmBody') : t('checkin.screen.missingCode')}
          </Text>
        </View>
        <EventCardView event={event} routeId={ROUTE} trailing={<View />} />
        {form.fields}
        {sticky ? null : (
          <Button
            label={t('checkin.submit')}
            size="l"
            loading={form.busy}
            disabled={form.disabled}
            onPress={form.submit}
            style={styles.inline}
            testID={`${ROUTE}.cta.primary`}
          />
        )}
      </>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('checkin.title')} onBack={back} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('checkin.screen.offline')} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, centred ? styles.centred : null, { paddingHorizontal: gutter }, sticky && cta ? null : padding]}
        keyboardShouldPersistTaps="handled"
        testID={`${ROUTE}.scroll`}
      >
        <View style={styles.column}>{body}</View>
      </ScrollView>
      {sticky && cta ? (
        <StickyCTABar
          label={t('checkin.submit')}
          onPress={form.submit}
          loading={form.busy}
          // While the event loads the bar holds its place, not yet usable.
          disabled={form.disabled || loadingCta}
          testID={`${ROUTE}.cta`}
        />
      ) : null}
    </Screen>
  );
}
