/**
 * The internal appeal of a decision (08_LEGAL_COMPLIANCE §4, Art. 20 DSA): within 6 months of the notice, one appeal per person and
 * decision, for the affected member and for a reporter (m2.6-api-handover §2, §8.7). The server decides through `can_appeal`.
 *
 * The period counts in Europe/Berlin calendar months, as §§ 187(1), 188(2), 188(3) BGB do: the day of the notice does not count,
 * the period ends at the end of the day that carries the same number 6 months later, and at the end of that month when it has no
 * such day (31 August → 28 February). The server's `appeal_until` (the last second of that day) wins whenever it is there; the count
 * here is the same rule, for a decision without it.
 */
import type { DecisionDetail } from './model';

export const APPEAL_PERIOD_MONTHS = 6;

const TIME_ZONE = 'Europe/Berlin';
const MINUTE_MS = 60 * 1000;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

type BerlinParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function berlinParts(date: Date): BerlinParts {
  const parts = partsFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** Berlin's offset from UTC at this instant, in minutes (60 in winter, 120 in summer). */
function berlinOffsetMinutes(instant: number): number {
  const p = berlinParts(new Date(instant));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE_MS);
}

/** 00:00 Berlin time of that calendar day, as an instant. `month` is 1-based and may overflow into the next year. */
function berlinMidnight(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - berlinOffsetMinutes(guess) * MINUTE_MS;
  // Across a DST change the offset at the result can differ from the one at the guess.
  return new Date(guess - berlinOffsetMinutes(first) * MINUTE_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The end of the appeal period for a notice at `notifiedAt`: `endsAt` is the first instant at which an appeal is late (00:00 Berlin
 * after the last day), `lastDay` an instant on the last day itself, for "bis zum 15.05.2027".
 */
export function appealDeadline(notifiedAt: Date): { endsAt: Date; lastDay: Date } {
  const notified = berlinParts(notifiedAt);
  const total = notified.month - 1 + APPEAL_PERIOD_MONTHS;
  const year = notified.year + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(notified.day, daysInMonth(year, month));
  const endsAt = berlinMidnight(year, month, day + 1);
  return { endsAt, lastDay: new Date(endsAt.getTime() - 1) };
}

const SECOND_MS = 1000;

/**
 * The deadline that applies to this decision: the server's `appeal_until` (its last second, so the period ends one second later), or
 * 6 months from the notice. Null before the member was told.
 */
export function decisionDeadline(decision: Pick<DecisionDetail, 'appealUntil' | 'notifiedAt'>): { endsAt: Date; lastDay: Date } | null {
  if (decision.appealUntil) {
    const lastDay = new Date(decision.appealUntil);
    if (!Number.isNaN(lastDay.getTime())) return { endsAt: new Date(lastDay.getTime() + SECOND_MS), lastDay };
  }
  if (!decision.notifiedAt) return null;
  const notified = new Date(decision.notifiedAt);
  return Number.isNaN(notified.getTime()) ? null : appealDeadline(notified);
}

/**
 * What SAFE-01 offers for the appeal:
 * - `open`: "Einspruch einlegen" works (`can_appeal`);
 * - `pending`, `upheld`, `reversed`: the viewer has appealed;
 * - `expired`: the period is over;
 * - `waiting`: nobody has been notified yet, so the period has not started;
 * - `none`: no internal complaint is offered here.
 */
export type AppealOption = 'none' | 'open' | 'pending' | 'upheld' | 'reversed' | 'expired' | 'waiting';

export function appealOption(decision: DecisionDetail, now: Date): AppealOption {
  if (decision.appeal) return decision.appeal.status === 'open' ? 'pending' : decision.appeal.status;
  if (!decision.redress.includes('internal_complaint')) return 'none';
  if (decision.canAppeal) return 'open';
  const deadline = decisionDeadline(decision);
  if (!deadline) return 'waiting';
  return now.getTime() >= deadline.endsAt.getTime() ? 'expired' : 'none';
}
