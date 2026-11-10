import { checkHuAu, formatCalendarDay, formatDueMonth, huAuState, huAuText, maskHuAu, monthOf, reminderDay } from '@/features/garage/huAu';

/** 8 November 2026, 10:00 in Berlin. */
const TODAY = new Date('2026-11-08T09:00:00Z');

describe('GAR-06 HU/AU month (sig.hu_au_reminder)', () => {
  it('reads the month in Berlin time', () => {
    expect(monthOf(TODAY)).toBe('2026-11');
    // 23:30 UTC on 30 November is already December in Berlin.
    expect(monthOf(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12');
  });

  it('shows the stored month as MM/JJJJ and masks typing', () => {
    expect(huAuText('2027-03')).toBe('03/2027');
    expect(huAuText(null)).toBe('');
    expect(maskHuAu('032027')).toBe('03/2027');
  });

  it('accepts an empty field as "no date" and a month within the bounds', () => {
    expect(checkHuAu('', TODAY)).toEqual({ ok: true, value: null });
    expect(checkHuAu('3/2027', TODAY)).toEqual({ ok: true, value: '2027-03' });
    expect(checkHuAu('11/2029', TODAY)).toEqual({ ok: true, value: '2029-11' });
    expect(checkHuAu('11/2024', TODAY)).toEqual({ ok: true, value: '2024-11' });
  });

  it('refuses what is not a month, too far back or too far ahead', () => {
    expect(checkHuAu('13/2027', TODAY)).toEqual({ ok: false, reason: 'format' });
    expect(checkHuAu('2027', TODAY)).toEqual({ ok: false, reason: 'format' });
    expect(checkHuAu('10/2024', TODAY)).toEqual({ ok: false, reason: 'tooEarly' });
    expect(checkHuAu('12/2029', TODAY)).toEqual({ ok: false, reason: 'tooLate' });
  });

  it('puts the reminder 30 days before the first of the due month', () => {
    expect(reminderDay('2027-03')).toEqual({ year: 2027, month: 1, day: 30 });
    // A leap year: 1 March 2028 minus 30 days is 31 January.
    expect(reminderDay('2028-03')).toEqual({ year: 2028, month: 1, day: 31 });
    expect(reminderDay('2027-01')).toEqual({ year: 2026, month: 12, day: 2 });
    expect(reminderDay('garbage')).toBeNull();
  });

  it('says where the due date stands today', () => {
    expect(huAuState('2027-03', TODAY)).toBe('upcoming');
    // Reminder on 2 December 2026: not passed on 8 November.
    expect(huAuState('2027-01', TODAY)).toBe('upcoming');
    // Reminder on 1 November 2026: passed.
    expect(huAuState('2026-12', TODAY)).toBe('reminderPassed');
    expect(huAuState('2026-11', TODAY)).toBe('dueNow');
    expect(huAuState('2026-09', TODAY)).toBe('overdue');
  });

  it('formats the reminder day and the month for the helper', () => {
    expect(formatCalendarDay({ year: 2027, month: 1, day: 30 }, 'de')).toBe('30.01.2027');
    expect(formatDueMonth('2026-09', 'de')).toBe('September 2026');
  });
});
