/**
 * One creating POST per intent (BH-03, BH-12): the key rotates only on an answer that refuses this body. A 429, a 5xx or a
 * 401 after a lost answer says nothing about what the lost attempt stored, so the retry must keep its key.
 */
import { renderHook } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { useCreateOnce } from '@/features/garage/createOnce';
import { mayStillLand, refusesBody } from '@/features/garage/errors';

jest.mock('expo-crypto', () => {
  let next = 0;
  return { randomUUID: jest.fn(() => `uuid-${(next += 1)}`) };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

type Kind = ApiError['kind'];
const error = (status: number, kind: Kind, code: string = kind) => new ApiError({ kind, status, code, message: 'x' });
const network = () => error(0, 'network');

const keeps: [string, () => ApiError][] = [
  ['no answer', network],
  ['the 409 of the attempt still running', () => error(409, 'conflict', 'conflict')],
  ['a 429 from the throttle, which runs before the key is looked at', () => error(429, 'rate_limited')],
  ['a 500', () => error(500, 'server')],
  ['a 503 for maintenance', () => error(503, 'server')],
  ['a 401', () => error(401, 'unauthenticated')],
];

const refusals: [string, () => ApiError][] = [
  ['a 422', () => error(422, 'validation', 'validation_failed')],
  ['a 403', () => error(403, 'forbidden')],
  ['a restriction', () => error(403, 'restricted', 'account_restricted')],
  ['a 404', () => error(404, 'not_found')],
  ['the 409 of a reused key', () => error(409, 'conflict', 'idempotency_key_reused')],
];

async function sequence(answers: (() => ApiError | null)[], bodies: { a: number }[]) {
  const sent: { key: string; body: { a: number } }[] = [];
  let call = 0;
  const send = jest.fn(async (body: { a: number }, key: string) => {
    sent.push({ key, body });
    const answer = answers[call]?.() ?? null;
    call += 1;
    if (answer) throw answer;
    return { id: 'created' };
  });
  const { result } = await renderHook(() => useCreateOnce(send));
  const outcomes: unknown[] = [];
  for (const body of bodies) {
    try {
      outcomes.push(await result.current(body));
    } catch (thrown) {
      outcomes.push(thrown);
    }
  }
  return { sent, outcomes };
}

describe('mayStillLand', () => {
  it.each(keeps)('keeps the key after %s', (_name, make) => {
    expect(mayStillLand(make())).toBe(true);
    expect(refusesBody(make())).toBe(false);
  });

  it.each(refusals)('drops the key after %s', (_name, make) => {
    expect(mayStillLand(make())).toBe(false);
    expect(refusesBody(make())).toBe(true);
  });
});

describe('useCreateOnce', () => {
  it.each(keeps)('a lost answer, then %s, then a retry: the retry keeps the first key', async (_name, make) => {
    const { sent } = await sequence([network, make, () => null], [{ a: 1 }, { a: 1 }, { a: 1 }]);
    expect(sent).toHaveLength(3);
    expect(sent[1]?.key).toBe(sent[0]?.key);
    expect(sent[2]?.key).toBe(sent[0]?.key);
  });

  it.each(refusals)('after %s the next attempt is a new intent with a new key', async (_name, make) => {
    const { sent } = await sequence([make, () => null], [{ a: 1 }, { a: 1 }]);
    expect(sent[1]?.key).not.toBe(sent[0]?.key);
  });

  it('a changed body after a lost answer, then a 429: nothing is re-sent at once under a new key', async () => {
    const { sent, outcomes } = await sequence([network, () => error(429, 'rate_limited'), () => null], [{ a: 1 }, { a: 2 }, { a: 2 }]);
    // The 429 is thrown to the caller; the old body went out under the old key, and so does the retry.
    expect(outcomes[1]).toBeInstanceOf(ApiError);
    expect(sent.map((entry) => entry.key)).toEqual([sent[0]?.key, sent[0]?.key, sent[0]?.key]);
    expect(sent.map((entry) => entry.body.a)).toEqual([1, 1, 1]);
    expect(outcomes[2]).toEqual({ result: { id: 'created' }, stale: true, sent: { a: 1 } });
  });

  it('a changed body after a lost answer, then a refusal of the old body: the new body goes at once under a new key', async () => {
    const { sent, outcomes } = await sequence([network, () => error(422, 'validation', 'validation_failed'), () => null], [{ a: 1 }, { a: 2 }]);
    expect(sent.map((entry) => entry.body.a)).toEqual([1, 1, 2]);
    expect(sent[2]?.key).not.toBe(sent[0]?.key);
    expect(outcomes[1]).toEqual({ result: { id: 'created' }, stale: false, sent: { a: 2 } });
  });
});
