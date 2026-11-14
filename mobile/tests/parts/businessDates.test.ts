import { berlinDayKey, shortDate, withClientToday } from '@/features/parts/components/business/dates';

const NBSP = ' ';

describe('business dates (DQ-1148, DQ-1155)', () => {
  it('names the Berlin weekday, also across midnight UTC', () => {
    expect(berlinDayKey(new Date('2026-11-02T10:00:00Z'))).toBe('mon');
    // 23:30 UTC on Sunday is already Monday in Berlin (CET, UTC+1).
    expect(berlinDayKey(new Date('2026-11-01T23:30:00Z'))).toBe('mon');
    expect(berlinDayKey(new Date('2026-11-08T12:00:00Z'))).toBe('sun');
  });

  it('marks today by the given clock, whatever the server said', () => {
    const days = [
      { day: 'mon', ranges: [], today: false },
      { day: 'fri', ranges: [], today: true },
    ];
    const marked = withClientToday(days, new Date('2026-11-02T10:00:00Z'));
    expect(marked.map((day) => [day.day, day.today])).toEqual([
      ['mon', true],
      ['fri', false],
    ]);
  });

  it('writes a list date in words, with the year only when it is not this year', () => {
    const reference = new Date('2026-11-02T10:00:00Z');
    expect(shortDate(new Date('2026-11-12T09:00:00Z'), 'de', reference)).toBe(`12.${NBSP}Nov.`);
    expect(shortDate(new Date('2026-05-03T09:00:00Z'), 'de', reference)).toBe(`3.${NBSP}Mai`);
    expect(shortDate(new Date('2026-11-12T09:00:00Z'), 'en', reference)).toBe(`12${NBSP}Nov`);
    expect(shortDate(new Date('2025-11-12T09:00:00Z'), 'de', reference)).toBe(`12.${NBSP}Nov. 2025`);
  });
});
