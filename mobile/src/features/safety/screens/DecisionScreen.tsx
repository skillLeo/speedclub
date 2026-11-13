import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { FormNotice } from '@/features/auth/components/FormNotice';
import { useCloseModal } from '@/features/garage/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { paramOf } from '@/features/vehicle/navigation';
import { now as clockNow } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import {
  Button,
  DiscardGuardDialog,
  EmptyState,
  ErrorState,
  Hairline,
  Header,
  OfflineBanner,
  Screen,
  Skeleton,
  SkeletonText,
  Text,
} from '@/ui';

import { appealOption, decisionDeadline } from '../appeal';
import { AppealSheet } from '../components/AppealSheet';
import { SafetySignIn, useAccountRestricted, useAccountRestrictionKind } from '../components/states';
import { isUnavailable, useSafety } from '../data';
import { affectedOutcome, automatedKeys, decisionSections, isReversal, reporterOutcome, scopeLine, type DecisionSection } from '../decisionView';
import { labelText, targetLabel } from '../labels';
import type { DecisionDetail } from '../model';
import { REPORTS_PATH } from '../ReportSheet';
import { SlotText, slot } from '@/ui/SlotText';

const ROUTE = 'SAFE-01';

/** The Commission's list (Art. 21 DSA): the system's in-app browser on native, a new tab on the web. */
function openExternal(url: string): void {
  if (!url) return;
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[48], paddingTop: t.space[8] },
  column: { alignSelf: 'center', maxWidth: layout.feedColumn, width: '100%' },
  centred: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[32] },
  head: { gap: t.space[8], marginBottom: t.space[24] },
  notice: { marginBottom: t.space[24] },
  section: { gap: t.space[8], paddingVertical: t.space[20] },
  option: { alignItems: 'flex-start', gap: t.space[4], marginTop: t.space[8] },
  optionButton: { marginTop: t.space[8] },
}));

/**
 * DQ-422: the body's own geometry from the top of the column: the head, then sections with the same 20 padding and hairlines
 * between them as `Section`.
 */
function DecisionSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.head}>
        <SkeletonText variant="caption" width="35%" />
        <SkeletonText variant="title1" width="80%" />
      </View>
      {[2, 1, 3].map((lines, index) => (
        <View key={index} testID={`${ROUTE}.skeleton.section`}>
          {index === 0 ? null : <Hairline />}
          <View style={styles.section}>
            <SkeletonText variant="headline" width="45%" />
            <SkeletonText variant="body" lines={lines} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

function Section({ title, children, first, testID }: { title: string; children: ReactNode; first: boolean; testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID}>
      {first ? null : <Hairline />}
      <View style={styles.section}>
        <Text variant="headline" role="heading" {...({ 'aria-level': 2 } as object)}>
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/** The ways to challenge a decision (Art. 17(3)(f), 20, 21 DSA), as the server lists them, with the internal appeal first. */
function Redress({ decision, onAppeal }: { decision: DecisionDetail; onAppeal: () => void }) {
  const { t } = useTranslation('safety');
  const { t: authT } = useTranslation('auth');
  // View-as (m3.2-contract §3): an appeal would be a write in the member's name.
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const format = useFormat();
  const option = appealOption(decision, clockNow());
  const deadline = decisionDeadline(decision);
  const lastDay = deadline ? format.date(deadline.lastDay) : '';
  const appealDate = (at: string | null | undefined) => (at ? format.date(new Date(at)) : '');
  let appealText: string;
  switch (option) {
    case 'open':
      appealText = t('decision.appealOpen', { date: lastDay });
      break;
    case 'expired':
      appealText = t('decision.appealExpired', { date: lastDay });
      break;
    case 'pending':
      appealText = t('decision.appealPending', { date: appealDate(decision.appeal?.createdAt) });
      break;
    case 'upheld':
      appealText = t('decision.appealUpheld', { date: appealDate(decision.appeal?.decidedAt ?? decision.appeal?.createdAt) });
      break;
    case 'reversed':
      appealText = t('decision.appealReversed', { date: appealDate(decision.appeal?.decidedAt ?? decision.appeal?.createdAt) });
      break;
    default:
      appealText = t('decision.appealWaiting');
  }
  const showButton = option === 'open' || option === 'expired' || option === 'pending' || option === 'waiting';
  return (
    <>
      {option === 'none' ? null : (
        <View style={styles.option} testID={`${ROUTE}.appeal`}>
          <Text variant="bodyStrong">{t('decision.appealTitle')}</Text>
          <Text variant="body" color="text.secondary" testID={`${ROUTE}.appeal.${option}`}>
            {appealText}
          </Text>
          {showButton ? (
            <Button
              label={t('decision.appealButton')}
              variant="secondary"
              size="m"
              disabled={option !== 'open' || readOnly}
              onPress={onAppeal}
              style={styles.optionButton}
              testID={`${ROUTE}.appealButton`}
            />
          ) : null}
          {showButton && readOnly ? (
            <Text variant="callout" color="text.secondary" testID={`${ROUTE}.appealViewAs`}>
              {authT('viewAs.readOnly')}
            </Text>
          ) : null}
        </View>
      )}
      {decision.redress.includes('out_of_court') ? (
        <View style={styles.option} testID={`${ROUTE}.dispute`}>
          <Text variant="bodyStrong">{t('decision.disputeTitle')}</Text>
          <Text variant="body" color="text.secondary">
            {t('decision.disputeBody')}
          </Text>
          {decision.disputeSettlementUrl ? (
            <Button
              label={t('decision.disputeLink')}
              variant="tertiary"
              size="m"
              role="link"
              icon="link"
              flush="start"
              onPress={() => openExternal(decision.disputeSettlementUrl ?? '')}
              testID={`${ROUTE}.disputeLink`}
            />
          ) : null}
        </View>
      ) : null}
      {decision.redress.includes('court') ? (
        <View style={styles.option} testID={`${ROUTE}.court`}>
          <Text variant="bodyStrong">{t('decision.courtTitle')}</Text>
          <Text variant="body" color="text.secondary">
            {t('decision.courtBody')}
          </Text>
        </View>
      ) : null}
    </>
  );
}

type DecisionBodyProps = {
  decision: DecisionDetail;
  onAppeal: () => void;
  onLegal: (doc: string) => void;
  /** ADR-224: a reversal opens the decision it lifted. */
  onOriginal: (decisionId: string) => void;
};

function DecisionBody({ decision, onAppeal, onLegal, onOriginal }: DecisionBodyProps) {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const format = useFormat();
  const restricted = useAccountRestricted();
  // DQ-564: the notice names what still applies; a reversal says first that this measure is lifted.
  const restrictionKind = useAccountRestrictionKind();
  const reporter = decision.viewer === 'reporter';
  const sections = decisionSections(decision);
  const statement = decision.statement;
  // NH-R4-2: the target's name in its own span that never hyphenates ("Nissan Skyline GT-R R34"); the copy around it may.
  const label = targetLabel(t, decision.target, () => slot('label'));
  const labelSlots = decision.target.label ? { label: labelText(decision.target.label) } : undefined;
  const groundDocument = decision.groundDocument;

  const render = (section: DecisionSection): ReactNode => {
    switch (section) {
      case 'decided': {
        if (reporter) {
          return (
            <>
              <SlotText variant="body" text={t(reporterOutcome(decision) as never, { label })} slots={labelSlots} testID={`${ROUTE}.outcome`} />
              <Text variant="body" color="text.secondary" testID={`${ROUTE}.reporterNote`}>
                {t('decision.reporterNote')}
              </Text>
            </>
          );
        }
        const outcome = affectedOutcome(decision);
        const scope = scopeLine(decision);
        // A calendar day in Berlin, as the decision mail writes it (d.m.Y): the measure ends with that day, not at a clock time.
        const day = (at: string | null) => (at ? format.date(new Date(at)) : '');
        return (
          <>
            <SlotText variant="body" text={t(outcome.key as never, { label, until: day(outcome.until) })} slots={labelSlots} testID={`${ROUTE}.outcome`} />
            {scope ? (
              <Text variant="body" color="text.secondary" testID={`${ROUTE}.scope`}>
                {t(scope.key as never, { date: day(scope.until) })}
              </Text>
            ) : null}
            {isReversal(decision) ? (
              <>
                <Text variant="body" color="text.secondary" testID={`${ROUTE}.reverseNote`}>
                  {t('decision.reverseNote')}
                </Text>
                {decision.reversesDecisionId ? (
                  <Button
                    label={t('decision.reverseOriginal')}
                    variant="tertiary"
                    size="m"
                    role="link"
                    icon="arrow-right"
                    flush="start"
                    onPress={() => onOriginal(decision.reversesDecisionId ?? '')}
                    testID={`${ROUTE}.original`}
                  />
                ) : null}
              </>
            ) : null}
          </>
        );
      }
      case 'content':
        return (
          <>
            <Text variant="caption" color="text.tertiary">
              {t(`targets.${decision.target.type}`)}
            </Text>
            <SlotText variant="bodyStrong" hyphenate={false} text={label} slots={labelSlots} testID={`${ROUTE}.target`} />
          </>
        );
      case 'facts':
        return (
          <Text variant="body" testID={`${ROUTE}.facts`}>
            {statement?.facts ?? ''}
          </Text>
        );
      case 'ground':
        // M3.5 (A1 probe): a reversal rests on the review, not on a rule. Its ground is the team's reason when it gave one, else what
        // the review found; never a lone link to the rule the earlier decision applied.
        if (isReversal(decision)) {
          return (
            <Text variant="body" testID={`${ROUTE}.groundText`}>
              {statement?.ground?.trim() || t('decision.reverseGround')}
            </Text>
          );
        }
        return (
          <>
            <Text variant="body" testID={`${ROUTE}.groundText`}>
              {statement?.ground ?? ''}
            </Text>
            {groundDocument ? (
              <Button
                label={t(`decision.groundLink.${groundDocument}`)}
                variant="tertiary"
                size="m"
                role="link"
                icon="scales"
                flush="start"
                onPress={() => onLegal(groundDocument)}
                testID={`${ROUTE}.groundLink`}
              />
            ) : null}
          </>
        );
      case 'automated': {
        const [detection, decided] = automatedKeys(decision);
        return (
          <Text variant="body" testID={`${ROUTE}.automatedText`}>
            {`${t(detection as never)} ${t(decided as never)}`}
          </Text>
        );
      }
      case 'redress':
        return <Redress decision={decision} onAppeal={onAppeal} />;
    }
  };

  return (
    <>
      <View style={styles.head}>
        <Text variant="caption" color="text.secondary" testID={`${ROUTE}.eyebrow`}>
          {t('decision.eyebrow', { date: format.date(new Date(decision.decidedAt)) })}
        </Text>
        <Text variant="title1" role="heading" {...({ 'aria-level': 1 } as object)} testID={`${ROUTE}.title`}>
          {reporter || !decision.action ? t('decision.titleReporter') : t(`decision.titleAffected.${decision.action}`)}
        </Text>
      </View>
      {restricted && !reporter ? (
        <View style={styles.notice}>
          <FormNotice
            tone="info"
            message={
              restrictionKind
                ? isReversal(decision)
                  ? `${t('decision.restrictedNow.reversalPrefix')} ${t(`decision.restrictedNow.${restrictionKind}`)}`
                  : t(`decision.restrictedNow.${restrictionKind}`)
                : t('decision.restricted')
            }
            testID={`${ROUTE}.restricted`}
          />
        </View>
      ) : null}
      {sections.map((section, index) => (
        <Section key={section} title={section === 'ground' && isReversal(decision) ? t('decision.reverseGroundTitle') : t(`decision.${section}`)} first={index === 0} testID={`${ROUTE}.section.${section}`}>
          {render(section)}
        </Section>
      ))}
    </>
  );
}

/**
 * SAFE-01 (modals)/decision/[id]: the statement of reasons of Art. 17 DSA for the affected member (what was decided, the facts, the
 * ground with its rule, automated means, redress with the appeal deadline), the outcome alone for a reporter. "Einspruch einlegen"
 * opens the appeal sheet while the period runs and no appeal exists.
 */
export function DecisionScreen() {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const { gutter } = useBreakpoint();
  const status = useSessionStore((state) => state.status);
  const close = useCloseModal(REPORTS_PATH);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const decisionId = paramOf(params.id);
  const query = useSafety().useDecision(status === 'member' ? decisionId : undefined);
  const decision = qaState === 'empty' ? undefined : query.data;
  const [appealing, setAppealing] = useState(false);
  const [appealDirty, setAppealDirty] = useState(false);

  /** The modal closes, then the page opens in the tab underneath, as GAR-04 does. */
  const leaveTo = (path: string) => {
    close();
    router.push(path as never);
  };

  let body: ReactNode = null;
  // DQ-276: the skeleton stands where the body will, at the top of the column; only empty, error and offline are centred.
  let loading = false;
  if (status === 'guest') {
    body = <SafetySignIn routeId={ROUTE} returnTo={decisionId ? `/decision/${decisionId}` : REPORTS_PATH} />;
  } else if (qaState === 'loading' || status === 'loading' || (!decision && query.isPending && !query.isPaused && qaState === 'default')) {
    loading = true;
    body = <DecisionSkeleton />;
  } else if (qaState === 'empty' || (!decision && (!decisionId || isUnavailable(query.error) || query.error?.kind === 'not_found' || query.error?.kind === 'forbidden'))) {
    body = (
      <EmptyState
        icon="info"
        title={t('decision.notFoundTitle')}
        body={t('decision.notFoundBody')}
        action={{ label: t('decision.toList'), onPress: () => leaveTo(REPORTS_PATH), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'error' || qaState === 'offline' || !decision) {
    const offline = qaState === 'offline' || !online || query.isPaused;
    body = (
      <ErrorState
        title={offline ? t('decision.offlineTitle') : t('decision.errorTitle')}
        message={offline ? t('decision.offlineBody') : undefined}
        onRetry={query.refetch}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  }

  const ready = body === null && decision !== undefined;
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} testID={`${ROUTE}.header`} />
      {ready && !online ? <OfflineBanner testID={`${ROUTE}.offlineBanner`} /> : null}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]} testID={`${ROUTE}.scroll`}>
        <View style={[styles.column, ready || loading ? null : styles.centred]} testID={`${ROUTE}.column`}>
          {ready ? (
            <DecisionBody
              decision={decision}
              onAppeal={() => setAppealing(true)}
              onOriginal={(id) => router.push({ pathname: '/decision/[id]', params: { id } })}
              onLegal={(doc) => leaveTo(decision.groundSection ? `/settings/legal/${doc}?section=${encodeURIComponent(decision.groundSection)}` : `/settings/legal/${doc}`)} />
          ) : (
            body
          )}
        </View>
      </ScrollView>
      {ready ? (
        <AppealSheet
          visible={appealing}
          decisionId={decision.id}
          onClose={() => setAppealing(false)}
          onChanged={query.refetch}
          onDirtyChange={setAppealDirty}
          testID={`${ROUTE}.appealSheet`}
        />
      ) : null}
      <DiscardGuardDialog
        dirty={appealDirty}
        title={t('appeal.discardTitle')}
        body={t('appeal.discardBody')}
        keepLabel={t('appeal.discardKeep')}
        discardLabel={t('appeal.discardConfirm')}
        testID={`${ROUTE}.discard`}
      />
    </Screen>
  );
}
