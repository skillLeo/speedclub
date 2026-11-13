// DQ-225: the app prints the date of a legal text as its public page does (WEB-08, Carbon `isoFormat('LL')`).
import { formatLegalDate } from '@/features/settings/legalDate';

const NBSP = ' ';

describe('formatLegalDate', () => {
  const date = new Date('2026-11-06T09:00:00Z');

  // DQ-1046: day and month stay together; the year may wrap, so "seit" (bound to the day in the copy) is never left alone.
  it('writes the date out, in German and in English', () => {
    expect(formatLegalDate(date, 'de')).toBe(`6.${NBSP}November 2026`);
    expect(formatLegalDate(date, 'en')).toBe(`November${NBSP}6, 2026`);
  });

  it('takes the day in Berlin, as the public page does', () => {
    expect(formatLegalDate(new Date('2026-11-05T23:30:00Z'), 'de')).toBe(`6.${NBSP}November 2026`);
  });
});
