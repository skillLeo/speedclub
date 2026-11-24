import { useRouter } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import type { FeedVehicle } from '@/api/queries/home';
import { railCardWidth } from '@/features/discover/components/DiscoverSections';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { photoFields } from '@/features/profile/media';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { concentric, createStyles, radius, size, space, typography, useTheme } from '@/theme';
import { SampleBadge, useSampleBadgeLabels } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons/Icon';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { SectionHeader } from '@/ui/SectionHeader';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { estimatedInterWidth } from '@/ui/specLabelMetrics';
import { Text } from '@/ui/Text';
import { handleText, vehicleTitleText } from '@/ui/textBreaks';
import { toast } from '@/ui/toast';

import {
  canPick,
  candidateOf,
  roundIsTomorrow,
  showsRound,
  useCastCotdVote,
  useCotdVote,
  useCotdVoteEnabled,
  voteView,
  type VoteCandidate,
  type VoteState,
} from '../cotdVote';

const GAP = space[12];
const SKELETON_TILES = 3;
/** Three tiles side by side once each is at least this share of a rail card; narrower, they scroll as a rail. */
const ROW_SHARE = 0.8;
/** The ring's inner gap follows the photo's corner inside the 2 ring (09 §4.3 concentric radii). */
const RING_GAP_RADIUS = concentric(radius.md, size.border.focusRing);
/** Up to this font scale a candidate's name keeps to two lines; from a larger one it wraps in full, never cut (R4DQ-02, ADR-128). */
export const NAME_CLAMP_FONT_SCALE = 1.3;
const NAME_LINES = 2;
const INVISIBLE = /[\u2060\u200B]/g;

/**
 * A candidate's name as the tile sets it (R4DQ-02): a hyphenated name and a model designation stay whole ("GT-R", "C 63", DQ-291),
 * and the trailing code stays with the word before it ("GT-R R34", ADR-426 c) where that pair fits the tile at the drawn size.
 */
export function candidateNameText(name: string, width: number, fontScale: number): string {
  const fontSize = typography.headline.fontSize * Math.max(1, fontScale);
  return vehicleTitleText(name, (pair) => estimatedInterWidth(pair.replace(INVISIBLE, ''), fontSize, 0, 'semibold') <= width);
}

/**
 * R4DQ-54: the owner's handle keeps to one line up to NAME_CLAMP_FONT_SCALE; from a larger font it takes two, breaking only after its
 * "." or "_" (handleText), never inside a word and never with a hyphen.
 */
export function candidateHandleLines(fontScale: number): number {
  return fontScale > NAME_CLAMP_FONT_SCALE ? HANDLE_LINES_LARGE : 1;
}
const HANDLE_LINES_LARGE = 2;

/** Two lines up to NAME_CLAMP_FONT_SCALE, all of it from a larger font (and hyphenation only there, where a word can outgrow a tile). */
export function candidateNameLines(fontScale: number): number | undefined {
  return fontScale > NAME_CLAMP_FONT_SCALE ? undefined : NAME_LINES;
}

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  intro: { gap: t.space[4] },
  row: { flexDirection: 'row', gap: GAP },
  rail: { flexDirection: 'row', gap: GAP },
  tile: { gap: t.space[8] },
  // R4DQ-01: the chosen car is a ring on the photo's edge (a radio's checked state), never a colour fill. Photos sit on a dark stage
  // in every theme (ADR-421 b), so the ring is `onPhoto.primary`, with an inner gap of the stage's tone that keeps it apart from a
  // bright photo.
  ring: {
    borderColor: t.color.onPhoto.primary,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.focusRing,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  ringGap: {
    borderColor: t.color.scrim.photoEnd,
    borderRadius: RING_GAP_RADIUS,
    borderWidth: t.size.border.focusRing,
    bottom: t.size.border.focusRing,
    left: t.size.border.focusRing,
    position: 'absolute',
    right: t.size.border.focusRing,
    top: t.size.border.focusRing,
  },
  text: { gap: t.space[2] },
  // ADR-535: "Beispiel" on a sample candidate's photo, where every photo tile carries it (MediaCard: 12 in from the top left).
  badge: { left: t.space[12], position: 'absolute', top: t.space[12] },
  // A sample last winner: the link, then its "Beispiel" on the same line where it fits.
  lastResult: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space[12] },
  mark: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  status: { gap: t.space[8] },
  error: { alignItems: 'flex-start', gap: t.space[8] },
}));

export type CotdVoteModuleProps = {
  /** The column's width and how far a rail runs past it on each side (the gutter on a phone, 0 in a column). */
  column: number;
  bleed: number;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
};

/**
 * R4-2.1 HOME-01 "Wähle das Car of the Day von morgen" (contract-cotd-voting §5) under the Car of the Day: the three candidates in
 * the Picker's order (photo, name, owner), one vote per round, changeable until `closes_at` ("Du hast abgestimmt"), then the closed
 * round ("um 18 Uhr steht der Gewinner fest") and, once decided, a line on yesterday's winner. **Never a count, a bar or a leader.**
 * The own car is shown, not votable. A member who may not vote reads why. Hidden while the flag is off, for guests, and for a round
 * that is unavailable. Optimistic with a rollback; one light haptic per vote (none on the web).
 */
export const CotdVoteModule = memo(function CotdVoteModule({ column, bleed, onOpen, testID }: CotdVoteModuleProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const qaState = useQaState();
  const online = useOnline();
  const query = useCotdVote();
  const cast = useCastCotdVote();
  const offline = !online || qaState === 'offline';

  const enabled = useCotdVoteEnabled();
  const view = voteView(query, qaState, enabled);
  if (view === 'hidden') return null;
  if (view === 'loading') return <CotdVoteSkeleton column={column} bleed={bleed} testID={testID} />;
  if (view === 'error') {
    return (
      <View style={styles.error} testID={`${testID}.error`}>
        <SectionHeader title={t('vote.titleNext')} />
        <Text variant="callout" color="text.secondary">
          {offline ? t('vote.offlineLoad') : t('vote.loadError')}
        </Text>
        {offline ? null : (
          <Button label={t('vote.retry')} variant="secondary" size="m" loading={query.isFetching} onPress={() => void query.refetch()} testID={`${testID}.retry`} />
        )}
      </View>
    );
  }
  const state = query.data;
  if (!showsRound(state)) return null;

  const vote = (candidate: VoteCandidate) => {
    if (!canPick(state, candidate.vehicle.id, !offline) || state.round.myVote === candidate.vehicle.id) return;
    haptics.light();
    cast.mutate(
      { day: state.round.day, vehicleId: candidate.vehicle.id, idempotencyKey: newIdempotencyKey() },
      {
        onError: (error) =>
          toast(error instanceof ApiError && error.message && error.kind !== 'network' && error.kind !== 'server' ? error.message : t('vote.failed'), {
            haptic: 'warning',
            testID: `${testID}.toast`,
          }),
      },
    );
  };

  return <RoundView state={state} offline={offline} restrictedQa={qaState === 'restricted'} column={column} bleed={bleed} onVote={vote} onOpen={onOpen} testID={testID} />;
});

function RoundView({
  state,
  offline,
  restrictedQa,
  column,
  bleed,
  onVote,
  onOpen,
  testID,
}: {
  state: VoteState;
  offline: boolean;
  restrictedQa: boolean;
  column: number;
  bleed: number;
  onVote: (candidate: VoteCandidate) => void;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
}) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const format = useFormat();
  const { fontScale } = useTheme();
  const { round, lastResult } = state;
  const reference = now();
  const tomorrow = roundIsTomorrow(state, reference);
  const title = tomorrow ? t('vote.title') : t('vote.titleToday');
  const closesAt = round.closesAt ? format.time(round.closesAt) : null;
  const open = round.status === 'open';
  const mine = candidateOf(state, round.myVote);
  const [sampleLabel] = useSampleBadgeLabels({ is_sample: true });
  const lastWonLabel = (own: boolean) =>
    lastResult?.winner ? t(own ? 'vote.lastWonMine' : 'vote.lastWon', { vehicle: lastResult.winner.full_title }) : '';
  const reason = restrictedQa ? 'restricted' : round.canVote ? null : round.cannotVoteReason;

  const rail = railCardWidth(column, fontScale);
  const three = Math.floor((column - 2 * GAP) / 3);
  const inRow = three >= rail * ROW_SHARE;
  const width = inRow ? three : rail;

  const tiles = round.candidates.map((candidate) => (
    <CandidateTile
      key={candidate.vehicle.id}
      candidate={candidate}
      width={width}
      chosen={round.myVote === candidate.vehicle.id}
      pickable={!restrictedQa && canPick(state, candidate.vehicle.id, !offline)}
      onVote={() => onVote(candidate)}
      testID={`${testID}.candidate.${candidate.position}`}
    />
  ));

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.intro}>
        <SectionHeader title={title} testID={`${testID}.title`} />
        <Text variant="callout" color="text.secondary" numeric testID={`${testID}.intro`}>
          {open
            ? closesAt
              ? tomorrow
                ? t('vote.introTomorrow', { time: closesAt })
                : t('vote.introToday', { time: closesAt })
              : t('vote.introPlain')
            : t('vote.closed')}
        </Text>
      </View>
      {lastResult?.winner && lastResult.byVote ? (
        <View style={styles.lastResult}>
          <Button
            label={lastWonLabel(lastResult.myVote === lastResult.winner.id)}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            icon="medal"
            onPress={() => lastResult.winner && onOpen(lastResult.winner)}
            accessibilityLabel={lastResult.winner.is_sample ? `${lastWonLabel(lastResult.myVote === lastResult.winner.id)}, ${sampleLabel}` : undefined}
            testID={`${testID}.lastResult`}
          />
          {/* ADR-535: a sample winner (outside production only) is badged as every sample is. */}
          {lastResult.winner.is_sample ? <SampleBadge testID={`${testID}.lastResult.sample`} /> : null}
        </View>
      ) : null}
      <View role="radiogroup" aria-label={title} aria-disabled={!open || reason !== null || offline}>
        {inRow ? (
          <View style={styles.row} testID={`${testID}.candidates`}>
            {tiles}
          </View>
        ) : (
          <View style={{ marginHorizontal: -bleed }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingHorizontal: bleed }]} testID={`${testID}.candidates`}>
              {tiles}
            </ScrollView>
          </View>
        )}
      </View>
      <View style={styles.status} aria-live="polite">
        {mine ? (
          <Text variant="calloutStrong" testID={`${testID}.voted`}>
            {open && closesAt && reason === null ? t('vote.votedChange', { vehicle: mine.vehicle.full_title, time: closesAt }) : t('vote.voted', { vehicle: mine.vehicle.full_title })}
          </Text>
        ) : null}
        {open && reason ? <ReasonNotice reason={reason} canVoteFrom={round.canVoteFrom} testID={testID} /> : null}
        {open && !reason && offline ? <FormNotice tone="info" message={t('vote.offline')} testID={`${testID}.offline`} /> : null}
      </View>
    </View>
  );
}

function ReasonNotice({ reason, canVoteFrom, testID }: { reason: string; canVoteFrom: Date | null; testID: string }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  const format = useFormat();
  const me = useMe();
  const styles = useStyles();
  if (reason === 'closed') return null;
  const restrictions = me.data?.restrictions;
  const decisionId = restrictions?.publishing.restricted ? restrictions.publishing.decision_id : null;
  const message =
    reason === 'account_too_new'
      ? canVoteFrom
        ? t('vote.reason.tooNewFrom', { date: format.dateTime(canVoteFrom) })
        : t('vote.reason.tooNew')
      : reason === 'email_unverified'
        ? t('vote.reason.unverified')
        : reason === 'restricted'
          ? t('vote.reason.restricted')
          : t('vote.reason.sample');
  return (
    <View style={styles.status} testID={`${testID}.reason`}>
      <FormNotice tone="info" message={message} testID={`${testID}.reason.${reason}`} />
      {reason === 'email_unverified' ? (
        <Button label={t('vote.verify')} variant="secondary" size="m" onPress={() => router.push('/verify-email')} testID={`${testID}.verify`} />
      ) : null}
      {reason === 'restricted' && decisionId ? (
        <Button
          label={t('vote.reasons')}
          variant="tertiary"
          size="m"
          role="link"
          flush="start"
          onPress={() => router.push({ pathname: '/decision/[id]', params: { id: decisionId } })}
          testID={`${testID}.decision`}
        />
      ) : null}
    </View>
  );
}

function CandidateTile({
  candidate,
  width,
  chosen,
  pickable,
  onVote,
  testID,
}: {
  candidate: VoteCandidate;
  width: number;
  chosen: boolean;
  pickable: boolean;
  onVote: () => void;
  testID: string;
}) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { vehicle, own } = candidate;
  const lines = candidateNameLines(fontScale);
  const owner = vehicle.owner?.username ?? null;
  const note = own ? t('vote.ownCar') : chosen ? t('vote.yourChoice') : null;
  const badges = useSampleBadgeLabels({ is_sample: vehicle.is_sample });
  const label = [...badges, vehicle.full_title, owner ? `@${owner}` : null, note].filter(Boolean).join(', ');
  return (
    <PressableScale
      role="radio"
      aria-checked={chosen}
      aria-disabled={!pickable}
      aria-label={label}
      disabled={!pickable}
      feedback={pickable}
      onPress={onVote}
      style={{ width }}
      contentStyle={styles.tile}
      testID={testID}
    >
      <Photo {...photoFields(vehicle.cover, width)} aspect="3:4" corner="md" testID={`${testID}.photo`}>
        {/* ADR-535: one "Beispiel" per sample candidate, on the photo's dark stage in every theme. */}
        {vehicle.is_sample ? <SampleBadge tone="onPhoto" style={styles.badge} testID={`${testID}.sample`} /> : null}
        {chosen ? (
          <View style={styles.ring} testID={`${testID}.ring`}>
            <View style={styles.ringGap} />
          </View>
        ) : null}
      </Photo>
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={lines} hyphenate={lines === undefined} testID={`${testID}.name`}>
          {candidateNameText(vehicle.full_title, width, fontScale)}
        </Text>
        {owner ? (
          <Text variant="caption" color="text.secondary" hyphenate={false} numberOfLines={candidateHandleLines(fontScale)} testID={`${testID}.owner`}>
            {handleText(`@${owner}`)}
          </Text>
        ) : null}
        {note ? (
          <View style={styles.mark} testID={`${testID}.${own ? 'own' : 'chosen'}`}>
            {chosen ? <Icon name="check-circle" size={size.icon.s} weight="fill" color="text.primary" /> : null}
            <Text variant="caption" color={chosen ? 'text.primary' : 'text.secondary'}>
              {note}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** The module while the round loads: the header lines and three tiles in their geometry. */
export function CotdVoteSkeleton({ column, bleed, testID }: { column: number; bleed: number; testID: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const rail = railCardWidth(column, fontScale);
  const three = Math.floor((column - 2 * GAP) / 3);
  const width = three >= rail * ROW_SHARE ? three : rail;
  return (
    <Skeleton testID={`${testID}.skeleton`}>
      <View style={styles.root}>
        <View style={styles.intro}>
          <SkeletonText variant="headline" width="70%" />
          <SkeletonText variant="callout" width="50%" />
        </View>
        <View style={[styles.row, { marginRight: -bleed }]}>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <View key={index} style={[styles.tile, { width }]}>
              <SkeletonBlock width={width} height={Math.round((width * 4) / 3)} corner="md" />
              <SkeletonText variant="headline" width="80%" />
              <SkeletonText variant="caption" width="50%" />
            </View>
          ))}
        </View>
      </View>
    </Skeleton>
  );
}
