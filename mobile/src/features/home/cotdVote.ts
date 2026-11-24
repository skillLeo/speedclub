/**
 * R4-2.1 Car of the Day voting (docs/reports/round-4/contract-cotd-voting.md §2, flag `cotd_voting`): the round for the next Car of
 * the Day with its three candidates in the Picker's order, the member's own vote (changeable until `closes_at`) and the last decided
 * round. **No count reaches the app** (V7): nothing here reads, keeps or derives one.
 *
 * The generated schema types the round loosely (`status: string`, `candidates: unknown[]`), so the body is narrowed here; anything
 * the app does not understand hides the module rather than guessing. The hooks live with the module until the lead moves them to
 * `src/api/queries` (shared path).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import { retryUnlessAnswered, usePublicViewer } from '@/api/queries/vehicles';
import { TIME_ZONE } from '@/lib/format';
import { useSessionStore } from '@/state/session';

export const COTD_VOTING_FLAG = 'cotd_voting';

export type VoteStatus = 'open' | 'closed' | 'unavailable';
export type CannotVoteReason = 'closed' | 'account_too_new' | 'email_unverified' | 'restricted' | 'sample_account';

export type VoteCandidate = {
  position: number;
  /** The reader's own car: shown, never votable (V3). */
  own: boolean;
  votable: boolean;
  vehicle: FeedVehicle;
};

export type VoteRound = {
  /** The day the winner is Car of the Day (Y-m-d, Europe/Berlin). */
  day: string;
  status: VoteStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  canVote: boolean;
  cannotVoteReason: CannotVoteReason | null;
  canVoteFrom: Date | null;
  myVote: string | null;
  candidates: VoteCandidate[];
};

export type VoteResult = { day: string; myVote: string | null; winner: FeedVehicle | null; byVote: boolean };

export type VoteState = { round: VoteRound; lastResult: VoteResult | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly VoteStatus[] = ['open', 'closed', 'unavailable'];
const REASONS: readonly CannotVoteReason[] = ['closed', 'account_too_new', 'email_unverified', 'restricted', 'sample_account'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function vehicleOf(value: unknown): FeedVehicle | null {
  return isRecord(value) && typeof value.id === 'string' && typeof value.full_title === 'string' ? (value as FeedVehicle) : null;
}

/** The API's `{round, last_result}` (also inside `data`), or null when it is not a round the app understands. */
export function parseVoteState(body: unknown): VoteState | null {
  const source = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(source) || !isRecord(source.round)) return null;
  const round = source.round;
  if (typeof round.day !== 'string' || !DAY.test(round.day)) return null;
  const status = STATUSES.find((entry) => entry === round.status);
  if (!status) return null;
  const candidates = (Array.isArray(round.candidates) ? round.candidates : [])
    .flatMap((entry): VoteCandidate[] => {
      if (!isRecord(entry)) return [];
      const vehicle = vehicleOf(entry.vehicle);
      if (!vehicle) return [];
      return [{ position: typeof entry.position === 'number' ? entry.position : 0, own: entry.own === true, votable: entry.votable === true && entry.own !== true, vehicle }];
    })
    // The Picker's order (V7: never by votes).
    .sort((a, b) => a.position - b.position);
  const reason = REASONS.find((entry) => entry === round.cannot_vote_reason) ?? null;
  const last = isRecord(source.last_result) ? source.last_result : null;
  return {
    round: {
      day: round.day,
      status,
      opensAt: dateOf(round.opens_at),
      closesAt: dateOf(round.closes_at),
      canVote: round.can_vote === true && status === 'open',
      cannotVoteReason: reason,
      canVoteFrom: dateOf(round.can_vote_from),
      myVote: typeof round.my_vote === 'string' ? round.my_vote : null,
      candidates,
    },
    lastResult:
      last && typeof last.day === 'string'
        ? { day: last.day, myVote: typeof last.my_vote === 'string' ? last.my_vote : null, winner: vehicleOf(last.winner), byVote: last.by_vote === true }
        : null,
  };
}

/** Contract §5: the module shows an open round, and a closed one until the winner is out; never an unavailable one or one without cars. */
export function showsRound(state: VoteState | null | undefined): state is VoteState {
  return !!state && state.round.status !== 'unavailable' && state.round.candidates.length > 0;
}

/** The candidate a member may pick now: the round is open, the account may vote and the car is not theirs. */
export function canPick(state: VoteState, vehicleId: string, online: boolean): boolean {
  const candidate = state.round.candidates.find((entry) => entry.vehicle.id === vehicleId);
  return online && state.round.canVote && state.round.status === 'open' && candidate !== undefined && candidate.votable && !candidate.own;
}

/** The state with the member's vote moved to `vehicleId` (the optimistic step; the server's answer replaces it). */
export function withMyVote(state: VoteState, vehicleId: string): VoteState {
  return { ...state, round: { ...state.round, myVote: vehicleId } };
}

/**
 * The API's body as the cache keeps it: plain JSON. The query cache is persisted (queryClient.ts), and a `Date` there came back as a
 * string after a reload, which `format.time` refused, so Start showed its error screen for a signed-in member (client round 5, R5-1).
 * The round is parsed when it is read (`select`), never stored parsed.
 */
export type VoteBody = unknown;

/** The cached body with the member's vote moved to `vehicleId` (the optimistic step on the stored JSON). */
export function withMyVoteBody(body: VoteBody, vehicleId: string): VoteBody {
  if (!isRecord(body)) return body;
  const source = isRecord(body.data) ? body.data : body;
  if (!isRecord(source.round)) return body;
  const next = { ...source, round: { ...source.round, my_vote: vehicleId } };
  return isRecord(body.data) ? { ...body, data: next } : next;
}

/** "2026-11-22": the Berlin day a moment falls on. */
export function berlinDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whether the round decides tomorrow's Car of the Day (from 18:00) or today's (after midnight, until 17:00). */
export function roundIsTomorrow(state: VoteState, reference: Date): boolean {
  return state.round.day > berlinDay(reference);
}

/** The FeedVehicle a vote is for. */
export function candidateOf(state: VoteState, vehicleId: string | null): VoteCandidate | undefined {
  return vehicleId ? state.round.candidates.find((entry) => entry.vehicle.id === vehicleId) : undefined;
}

/** The flag answered 404 `feature_disabled` (or the route is not there yet): the module hides, it is no error. */
export function isVotingOff(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 401);
}

/** What the module draws for the query and the QA state: nothing, the skeleton, the error line, or the round. */
export type VoteView = 'hidden' | 'loading' | 'error' | 'round';

export function voteView(
  query: { status: 'pending' | 'error' | 'success'; fetchStatus: 'fetching' | 'paused' | 'idle'; error: unknown; data: VoteState | null | undefined },
  qaState: string,
  /** The flag is on and a member is signed in: otherwise the module never shows, whatever the QA state. */
  enabled: boolean,
): VoteView {
  if (!enabled || qaState === 'empty') return 'hidden';
  if (qaState === 'loading') return 'loading';
  if (qaState === 'error') return 'error';
  // Flag off, a guest or staff: the query never runs.
  if (query.status === 'pending') return query.fetchStatus === 'idle' ? 'hidden' : 'loading';
  if (query.status === 'error' && !query.data) return isVotingOff(query.error) ? 'hidden' : 'error';
  return showsRound(query.data) ? 'round' : 'hidden';
}

export const cotdVoteKeys = { state: (viewer: string) => ['car-of-the-day', 'vote', viewer] as const };

/** Voting can show at all: the flag is on and a member is signed in (guests and staff hear 401, so they never ask). */
export function useCotdVoteEnabled(): boolean {
  const flag = useFlag(COTD_VOTING_FLAG);
  const member = useSessionStore((state) => state.status === 'member');
  return flag && member;
}

/** GET car-of-the-day/vote while voting can show. */
export function useCotdVote() {
  const viewer = usePublicViewer();
  const enabled = useCotdVoteEnabled();
  return useQuery({
    queryKey: cotdVoteKeys.state(viewer),
    queryFn: async ({ signal }): Promise<VoteBody> => apiData(api.GET('/car-of-the-day/vote', { signal })),
    select: parseVoteState,
    enabled,
    retry: retryUnlessAnswered,
    // The round changes at 17:00 and 18:00; a minute is fresh enough for Start.
    staleTime: 60_000,
  });
}

export type CastVoteInput = { day: string; vehicleId: string; idempotencyKey: string };

/**
 * POST car-of-the-day/vote (Idempotency-Key): the card shows the new vote at once and goes back when the call fails. The answer is the
 * whole state again (`my_vote` set), which replaces the cache.
 */
export function useCastCotdVote() {
  const client = useQueryClient();
  const viewer = usePublicViewer();
  const key = cotdVoteKeys.state(viewer);
  return useMutation({
    scope: { id: 'cotd-vote' },
    mutationFn: async ({ day, vehicleId, idempotencyKey }: CastVoteInput): Promise<VoteBody> =>
      apiData(api.POST('/car-of-the-day/vote', { body: { day, vehicle_id: vehicleId }, ...withIdempotency(idempotencyKey) })),
    onMutate: async ({ vehicleId }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<VoteBody>(key);
      if (before !== undefined && parseVoteState(before)) client.setQueryData<VoteBody>(key, withMyVoteBody(before, vehicleId));
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before !== undefined) client.setQueryData<VoteBody>(key, context.before);
    },
    onSuccess: (body) => {
      if (parseVoteState(body)) client.setQueryData<VoteBody>(key, body);
    },
    // A refused vote (round closed meanwhile, the car no longer a candidate) reads the round again.
    onSettled: (_state, error) => {
      if (error) void client.invalidateQueries({ queryKey: key });
    },
  });
}
