/**
 * M5.6 check-in (m5.6-contract §5): the form's rule and what EVT-02 offers a reader while the flag `events.checkin` is on. Pure, so
 * tests/events/m56.test.ts covers it.
 */
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { checkinOf, normaliseCheckinCode, type EventCheckinInfo } from '@/api/queries/eventCheckin';
import type { EventDetail } from '@/api/queries/events';

export type CheckinFormValues = { code: string; profileVisible: boolean };

/** The code as the organiser shows it: six characters of the contract's alphabet, spaces and dashes forgiven. */
export function checkinSchema(t: TFunction) {
  return z.object({
    code: z
      .string()
      .trim()
      .min(1, t('events:checkin.codeRequired'))
      .refine((value) => normaliseCheckinCode(value) !== null, t('events:checkin.codeFormat')),
    profileVisible: z.boolean(),
  });
}

/**
 * What EVT-02's check-in block shows: "War dabei" once checked in, "Einchecken" while the window is open, the opening time for a
 * member who is going before it opens, nothing otherwise (and nothing at all for the organiser, who has EVT-06).
 */
export type CheckinOffer =
  | { kind: 'done'; info: EventCheckinInfo }
  | { kind: 'open'; info: EventCheckinInfo }
  | { kind: 'later'; info: EventCheckinInfo; opensAt: Date }
  | { kind: 'none' };

export function checkinOffer(
  event: Pick<EventDetail, 'checkin' | 'can' | 'my_rsvp'>,
  options: { enabled: boolean; organiser: boolean; now: Date },
): CheckinOffer {
  if (!options.enabled || options.organiser) return { kind: 'none' };
  const info = checkinOf(event);
  if (!info) return { kind: 'none' };
  if (info.mine) return { kind: 'done', info };
  if (info.open && event.can.checkin === true) return { kind: 'open', info };
  const opens = info.opens_at ? new Date(info.opens_at) : null;
  const going = event.my_rsvp === 'going' || event.my_rsvp === 'waitlist';
  if (!info.open && going && opens && Number.isFinite(opens.getTime()) && opens.getTime() > options.now.getTime())
    return { kind: 'later', info, opensAt: opens };
  return { kind: 'none' };
}
