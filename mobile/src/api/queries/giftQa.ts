/**
 * M5.9d: where the bundled QA set of the supporting system plugs into the reads (level, badges, Car of the Day, invites). The set
 * itself lives in features/gift/qaGift.ts and registers here, so the query modules stay free of sample data. Only while the
 * non-production override `qaGift` is set (mobile/src/lib/qa.ts); production has no overrides and never reaches a source.
 */
import { qa } from '@/lib/qa';

import type { Badge } from './badges';
import type { CarOfTheDay } from './carOfTheDay';
import type { InviteLookup, MyInvites } from './invites';
import type { MyLevel } from './level';

export type GiftQaSource = {
  level: () => MyLevel;
  badges: () => Badge[];
  memberBadges: (username: string) => Badge[];
  unseen: () => Badge[];
  carOfTheDay: (me: string | null) => CarOfTheDay | null;
  invites: () => MyInvites;
  inviteLookup: (code: string) => InviteLookup;
};

let source: GiftQaSource | null = null;

export function registerGiftQaSource(next: GiftQaSource | null): void {
  source = next;
}

/** The QA source while `qaGift` is set and the set is installed; null otherwise (the live API answers). */
export function giftQa(): GiftQaSource | null {
  return qa.gift !== undefined ? source : null;
}

/** A read answered from the QA set: `qaGift=error` fails it, as the server would. */
export function fromGiftQa<T>(read: (qaSource: GiftQaSource) => T): Promise<T> {
  const qaSource = giftQa();
  if (!qaSource) return Promise.reject(new Error('qaGift is not active'));
  if (qa.gift === 'error') return Promise.reject(new Error('qaGift=error'));
  return Promise.resolve(read(qaSource));
}
