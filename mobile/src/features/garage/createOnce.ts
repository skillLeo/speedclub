/**
 * One creating POST with its idempotency key (BH-03, BH-12). The key belongs to the intent, not to the form's current values,
 * and a key that was used with another body answers 409. So after a lost answer the exact body goes out again with the same
 * key: it replays what the server may already hold, or creates it now. If the form has changed since, the caller gets `stale`
 * and PATCHes the rest onto the created entry. Once the server really answered, nothing is stored under the key and the next
 * attempt is a new intent with a new key.
 */
import { useRef } from 'react';

import { newIdempotencyKey } from '@/api/client';

import { mayStillLand } from './errors';

export type Created<Result, Body> = {
  result: Result;
  /** The entry holds an older body than the one asked for. */
  stale: boolean;
  /** The body the entry was created from: what a stale caller compares the form with. */
  sent: Body;
};

const sameBody = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useCreateOnce<Body, Result>(send: (body: Body, idempotencyKey: string) => Promise<Result>) {
  const attempt = useRef<{ key: string; body: Body } | null>(null);

  const create = async (body: Body): Promise<Created<Result, Body>> => {
    const current = attempt.current ?? { key: newIdempotencyKey(), body };
    attempt.current = current;
    const stale = !sameBody(current.body, body);
    try {
      const result = await send(current.body, current.key);
      attempt.current = null;
      return { result, stale, sent: current.body };
    } catch (error) {
      if (mayStillLand(error)) throw error;
      attempt.current = null;
      // The older body was refused, so nothing exists yet: the member's current values get their own attempt. Only after a real
      // refusal: a 429 or a 5xx would spend the next request of the limit on a key that may still hold the first attempt.
      if (stale) return create(body);
      throw error;
    }
  };

  return create;
}
