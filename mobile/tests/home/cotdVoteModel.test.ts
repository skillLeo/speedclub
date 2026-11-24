/** R4-2.1 Car of the Day voting: the round as the app reads it (contract-cotd-voting §2.1), what shows, and never a count. */
import { ApiError } from '@/api/client';

import {
  berlinDay,
  canPick,
  parseVoteState,
  roundIsTomorrow,
  showsRound,
  voteView,
  withMyVote,
  type VoteState,
} from '@/features/home/cotdVote';

import { GTI, M4, R34, voteCandidate as candidate, voteRoundBody as roundBody } from './fixtures';

const parsed = (round: Record<string, unknown> = {}, last: unknown = null): VoteState => {
  const state = parseVoteState(roundBody(round, last));
  if (!state) throw new Error('no state');
  return state;
};

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('parseVoteState', () => {
  it('reads the round in the Picker order and keeps no count', () => {
    const state = parsed({ votes: 12, candidates: [candidate(2, M4, { votes: 7 }), candidate(1, R34), candidate(3, GTI)] });
    expect(state.round.candidates.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(state.round.closesAt?.toISOString()).toBe('2026-11-22T16:00:00.000Z');
    expect(JSON.stringify(state)).not.toMatch(/"(votes|vote_count|votes_count|count|share|percent|leading)"/);
  });

  it('never makes the own car votable, whatever the server says', () => {
    const state = parsed({ candidates: [candidate(1, R34, { own: true, votable: true })] });
    expect(state.round.candidates[0]).toMatchObject({ own: true, votable: false });
    expect(canPick(state, R34.id, true)).toBe(false);
  });

  it('refuses what it does not understand', () => {
    expect(parseVoteState(null)).toBeNull();
    expect(parseVoteState({ data: { round: { day: 'morgen', status: 'open' } } })).toBeNull();
    expect(parseVoteState({ data: { round: { day: '2026-11-22', status: 'leading' } } })).toBeNull();
  });

  it('reads the last result and its winner', () => {
    const state = parsed({}, { day: '2026-11-21', my_vote: GTI.id, winner: GTI, by_vote: true });
    expect(state.lastResult).toEqual({ day: '2026-11-21', myVote: GTI.id, winner: GTI, byVote: true });
  });
});

describe('what the module shows', () => {
  const query = (over: Partial<Parameters<typeof voteView>[0]>) => ({ status: 'success' as const, fetchStatus: 'idle' as const, error: null, data: parsed(), ...over });

  it('hides an unavailable round and one without cars', () => {
    expect(showsRound(parsed({ status: 'unavailable', candidates: [] }))).toBe(false);
    expect(showsRound(parsed({ candidates: [] }))).toBe(false);
    expect(showsRound(parsed({ status: 'closed', can_vote: false, cannot_vote_reason: 'closed' }))).toBe(true);
  });

  it('is nothing with the flag off or for a guest, also under a QA state', () => {
    expect(voteView(query({ status: 'pending', data: undefined }), 'default', false)).toBe('hidden');
    expect(voteView(query({}), 'loading', false)).toBe('hidden');
    expect(voteView(query({ status: 'pending', fetchStatus: 'fetching', data: undefined }), 'default', true)).toBe('loading');
    expect(voteView(query({}), 'default', true)).toBe('round');
    expect(voteView(query({}), 'empty', true)).toBe('hidden');
  });

  it('hides on 404 feature_disabled, shows the error line on anything else', () => {
    const off = new ApiError({ kind: 'not_found', status: 404, code: 'feature_disabled', message: 'aus' });
    const broken = new ApiError({ kind: 'server', status: 500, code: 'server_error', message: 'kaputt' });
    expect(voteView(query({ status: 'error', error: off, data: undefined }), 'default', true)).toBe('hidden');
    expect(voteView(query({ status: 'error', error: broken, data: undefined }), 'default', true)).toBe('error');
  });

  it('lets a member pick only while the round is open, online and the account may vote', () => {
    expect(canPick(parsed(), M4.id, true)).toBe(true);
    expect(canPick(parsed(), M4.id, false)).toBe(false);
    expect(canPick(parsed({ can_vote: false, cannot_vote_reason: 'account_too_new' }), M4.id, true)).toBe(false);
    expect(canPick(parsed({ status: 'closed' }), M4.id, true)).toBe(false);
    expect(canPick(parsed(), 'not-a-candidate', true)).toBe(false);
  });

  it('moves the vote optimistically', () => {
    expect(withMyVote(parsed({ my_vote: R34.id }), M4.id).round.myVote).toBe(M4.id);
  });
});

describe('the round day', () => {
  it('is tomorrow from 18:00 and today after midnight (Berlin)', () => {
    expect(berlinDay(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22');
    expect(roundIsTomorrow(parsed(), new Date('2026-11-21T19:00:00+01:00'))).toBe(true);
    expect(roundIsTomorrow(parsed(), new Date('2026-11-22T09:00:00+01:00'))).toBe(false);
  });
});
