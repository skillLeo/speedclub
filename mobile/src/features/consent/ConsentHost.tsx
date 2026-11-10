import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, onApiGateEvent } from '@/api/client';
import { isViewAsTab } from '@/api/clientViewAs';
import { appConfigKey, useAppConfig } from '@/api/queries/appConfig';
import { useSignOut } from '@/api/queries/auth';
import { consentKeys, useAcceptConsents, useConsentState, type RequiredConsent } from '@/api/queries/legal';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useFormat } from '@/lib/useFormat';
import {
  clearsConsent,
  forgetConsentClearance,
  hydrateConsentClearance,
  rememberConsentClearance,
  useConsentClearance,
} from '@/state/consent';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Dialog, Hairline, Sheet, Text } from '@/ui';

const ID = 'CONSENT';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  document: { gap: t.space[4] },
  footer: { gap: t.space[8] },
}));

/** While the member reads a document from the sheet, it steps aside; any other route brings it back. */
export function isLegalReading(pathname: string): boolean {
  return /^\/settings\/legal\/(terms|privacy)\/?$/.test(pathname);
}

/**
 * Re-consent (M3.5 ADM-31, ADR-236 f, ADR-245): when app-config names a re-consent version of AGB or Datenschutz, a signed-in member is
 * asked (`GET me/consents`) and, while `required` lists something, a blocking sheet stands over the app: what changed (the summary),
 * links to SET-18, "Zustimmen" (`POST me/consents`) and "Ablehnen", which explains and signs out. Never in a view-as tab: the staff
 * member cannot accept for the member, and the member's state stays untouched.
 *
 * It never fails open (code review M3.3-app SF-5): when the state cannot be read (an error, or a first start offline), the sheet stays
 * with "Erneut versuchen" and Abmelden. A write the server refused with 403 `consent_required` brings it up too, also before this
 * app's config names the version (the config is then read again).
 *
 * Offline, a member the server already cleared for this version pair is not blocked (code review phase-3-final MF-2): each
 * `required: []` is remembered on the device per member and pair (state/consent.ts), and while the state cannot be read for want of a
 * connection, a matching record lets the app through. Without one (another pair, another member, never asked) the sheet stays. A
 * server error online keeps the sheet whatever the record says (ADR-245).
 */
export function ConsentHost() {
  const { config } = useAppConfig();
  const client = useQueryClient();
  const member = useSessionStore((state) => state.status === 'member');
  const memberId = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? '') : null));
  const viewAs = isViewAsTab();
  // The member a 403 `consent_required` was answered for: another member, or none, is not refused by it.
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const forced = memberId !== null && refusedFor === memberId;
  const active = member && !viewAs;
  const { terms, privacy } = config.legal_reconsent;
  const named = terms !== null || privacy !== null;
  const query = useConsentState(config.legal_reconsent, active, forced);
  const clearance = useConsentClearance();
  const answered = query.data?.required;

  useEffect(() => {
    if (active) void hydrateConsentClearance();
  }, [active]);
  // The data belongs to the pair of its query key, which is app-config's pair now.
  useEffect(() => {
    if (!active || !memberId || !answered) return;
    if (answered.length === 0) rememberConsentClearance(memberId, { terms, privacy });
    else void forgetConsentClearance();
  }, [active, answered, memberId, privacy, terms]);

  useEffect(
    () =>
      onApiGateEvent((event) => {
        if (event !== 'consent_required' || isViewAsTab()) return;
        const { status, member: current } = useSessionStore.getState();
        if (status !== 'member') return;
        // The server says this member has not accepted: whatever the device remembered no longer holds.
        void forgetConsentClearance();
        setRefusedFor(current?.id ?? '');
        void client.invalidateQueries({ queryKey: consentKeys.all });
        void client.invalidateQueries({ queryKey: appConfigKey });
      }),
    [client],
  );
  if (!active || (!named && !forced)) return null;
  if (answered) return answered.length === 0 ? null : <ConsentSheet required={answered} />;
  // From the first failed attempt on, not only after the retries: the member must not write past it in the meantime.
  const paused = query.isPending && query.fetchStatus === 'paused';
  if (!query.isError && query.failureCount === 0 && !paused) return null;
  // `failureReason` from the first failed attempt on, `error` once the retries are spent.
  const failure: unknown = query.error ?? query.failureReason;
  const unreachable = paused || (failure instanceof ApiError && failure.kind === 'network');
  if (unreachable && !forced) {
    if (clearsConsent(clearance.record, memberId, { terms, privacy })) return null;
    // The device's record is still being read: a moment, and nothing can be written meanwhile.
    if (!clearance.loaded) return null;
  }
  return <ConsentUnavailableSheet offline={paused} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
}

/** The state could not be read: the sheet still blocks, with a retry and the way out. */
function ConsentUnavailableSheet({ offline, retrying, onRetry }: { offline: boolean; retrying: boolean; onRetry: () => void }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const online = useOnline();
  const router = useRouter();
  const signOut = useSignOut();
  const away = offline || !online;
  const leave = () => signOut.mutate(undefined, { onSettled: () => router.replace('/welcome') });
  return (
    <Sheet
      visible
      onClose={() => undefined}
      dismissable={false}
      expandable={false}
      title={t('consent.title')}
      testID={`${ID}.unavailable`}
      footer={
        <View style={styles.footer}>
          <Button label={t('consent.retry')} fullWidth loading={retrying} disabled={!online} onPress={onRetry} testID={`${ID}.retry`} />
          <Button
            label={t('consent.signOut')}
            variant="tertiary"
            fullWidth
            loading={signOut.isPending}
            onPress={leave}
            testID={`${ID}.unavailable.signOut`}
          />
        </View>
      }
    >
      <View style={styles.body}>
        <FormNotice
          tone={away ? 'info' : 'error'}
          message={away ? t('consent.loadOffline') : t('consent.loadFailed')}
          testID={`${ID}.unavailable.notice`}
        />
      </View>
    </Sheet>
  );
}

function ConsentSheet({ required }: { required: readonly RequiredConsent[] }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const pathname = usePathname();
  const router = useRouter();
  const accept = useAcceptConsents();
  const signOut = useSignOut();
  const [declining, setDeclining] = useState(false);
  const reading = isLegalReading(pathname);

  const error = accept.error;
  const notice =
    error instanceof ApiError
      ? error.kind === 'validation'
        ? t('consent.outdated')
        : error.kind === 'network'
          ? t('consent.network')
          : error.message || t('consent.failed')
      : null;

  const read = (key: RequiredConsent['key']) => router.push({ pathname: '/settings/legal/[doc]', params: { doc: key } });
  const leave = () =>
    signOut.mutate(undefined, {
      onSettled: () => {
        setDeclining(false);
        router.replace('/welcome');
      },
    });

  return (
    <>
      <Sheet
        visible={!reading && !declining}
        onClose={() => undefined}
        dismissable={false}
        expandable={false}
        title={t('consent.title')}
        testID={`${ID}.sheet`}
        footer={
          <View style={styles.footer}>
            <Button
              label={t('consent.accept')}
              fullWidth
              loading={accept.isPending}
              disabled={!online}
              onPress={() => accept.mutate(required)}
              testID={`${ID}.accept`}
            />
            <Button label={t('consent.decline')} variant="tertiary" fullWidth onPress={() => setDeclining(true)} testID={`${ID}.decline`} />
          </View>
        }
      >
        <View style={styles.body}>
          <Text variant="bodyDense" color="text.secondary">
            {t('consent.intro')}
          </Text>
          {notice ? <FormNotice message={notice} testID={`${ID}.notice`} /> : null}
          {!online ? <FormNotice tone="info" message={t('consent.offline')} testID={`${ID}.offline`} /> : null}
          {required.map((item, index) => (
            <View key={item.key} style={styles.document} testID={`${ID}.document.${item.key}`}>
              {index > 0 ? <Hairline /> : null}
              <Text variant="bodyStrong" role="heading" {...({ 'aria-level': 3 } as object)}>
                {t(`consent.documents.${item.key}`)}
              </Text>
              <Text variant="caption" color="text.tertiary">
                {item.published_at
                  ? t('consent.versionDate', { version: item.version, date: format.date(new Date(item.published_at)) })
                  : t('consent.version', { version: item.version })}
              </Text>
              <Text variant="bodyDense" testID={`${ID}.document.${item.key}.summary`}>
                {item.summary?.trim() || t('consent.noSummary')}
              </Text>
              <Button
                label={t(`consent.read.${item.key}`)}
                variant="tertiary"
                size="m"
                role="link"
                icon="arrow-right"
                flush="start"
                onPress={() => read(item.key)}
                testID={`${ID}.read.${item.key}`}
              />
            </View>
          ))}
        </View>
      </Sheet>
      <Dialog
        visible={declining}
        onClose={signOut.isPending ? undefined : () => setDeclining(false)}
        title={t('consent.declineTitle')}
        body={t('consent.declineBody')}
        testID={`${ID}.declineDialog`}
        actions={[
          { label: t('consent.back'), variant: 'secondary', onPress: () => setDeclining(false), disabled: signOut.isPending, testID: `${ID}.declineDialog.back` },
          { label: t('consent.signOut'), destructive: true, onPress: leave, loading: signOut.isPending, testID: `${ID}.declineDialog.signOut` },
        ]}
      />
    </>
  );
}
