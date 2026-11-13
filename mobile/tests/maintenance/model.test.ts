import i18n from '@/i18n';
import {
  distanceText,
  dueModel,
  euroText,
  freeTypes,
  fromUnit,
  heroItem,
  itemValuesFrom,
  maskDay,
  maskDueMonth,
  parseDueMonth,
  parseEuros,
  parseGermanDay,
  parseWhole,
  sortItems,
  toneOf,
  toUnit,
} from '@/features/maintenance/model';
import { encodeRandom, encodeTime, isUlid, newUlid } from '@/lib/ulid';

import { item } from './fixtures';

jest.mock('expo-crypto', () => ({ getRandomBytes: (count: number) => new Uint8Array(count).fill(7), randomUUID: () => 'uuid-1' }));

const t = i18n.getFixedT('de', 'garage');
const en = i18n.getFixedT('en', 'garage');

describe('dueModel (09 §5 MaintenanceCard)', () => {
  it('HU/AU: the month on the plakette, the countdown in days, the ring', () => {
    const model = dueModel(t, item(), 'km', 'de');
    expect(model.title).toBe('HU/AU');
    expect(model.due).toBe('Fällig im März 2027');
    expect(model.countdown).toBe('in 132 Tagen');
    expect(model.figure).toEqual({ value: 132, unit: 'Tage' });
    expect(model.tone).toBe('ok');
    expect(model.progress).toBe(0.82);
    expect(model.glyph).toBe('hu-plakette');
  });

  it('under 30 days is the warning tone, overdue says so in days', () => {
    expect(dueModel(t, item({ days_left: 12 }), 'km', 'de').tone).toBe('soon');
    const overdue = dueModel(t, item({ state: 'overdue', days_left: -12 }), 'km', 'de');
    expect(overdue.tone).toBe('overdue');
    expect(overdue.countdown).toBe('seit 12 Tagen überfällig');
    expect(dueModel(t, item({ days_left: 1 }), 'km', 'de').countdown).toBe('morgen fällig');
    expect(dueModel(t, item({ days_left: 0 }), 'km', 'de').countdown).toBe('heute fällig');
  });

  it('DQ-1097: an overdue hero figure says so in its unit, without repeating it under the figure', () => {
    const overdue = dueModel(t, item({ state: 'overdue', days_left: -53 }), 'km', 'de');
    expect(overdue.figure).toEqual({ value: 53, unit: 'Tage überfällig' });
    expect(overdue.heroCountdown).toBeNull();
    const due = dueModel(t, item({ days_left: 53 }), 'km', 'de');
    expect(due.figure).toEqual({ value: 53, unit: 'Tage' });
    expect(due.heroCountdown).toBe('bis zur Fälligkeit');
    expect(dueModel(t, item({ days_left: 1 }), 'km', 'de').heroCountdown).toBe('morgen fällig');
    expect(dueModel(en, item({ state: 'overdue', days_left: -1 }), 'km', 'en').figure).toEqual({ value: 1, unit: 'day overdue' });
  });

  it('a date or a mileage, in the member’s unit, with the last time', () => {
    const service = item({
      type: 'oil_change',
      next_due: { date: '2027-06-14', month: null, km: 56200, pinned: false, deadline: null },
      last_done: { date: '2026-06-14', km: 41200 },
      days_left: 214,
    });
    const model = dueModel(t, service, 'km', 'de');
    expect(model.due).toBe('Fällig am 14. Juni 2027 oder bei 56.200 km');
    expect(model.last).toBe('Zuletzt 14. Juni 2026 · 41.200 km');
    expect(dueModel(en, service, 'mi', 'en').due).toBe('Due on 14\u00A0June 2027 or at 34,921\u00A0mi');
  });

  it('only km: the countdown counts what is left', () => {
    const model = dueModel(t, item({ type: 'service', next_due: { date: null, month: null, km: 60000, pinned: false, deadline: null }, days_left: null, km_left: 1200 }), 'km', 'de');
    expect(model.countdown).toBe('noch 1.200 km');
    expect(model.figure).toEqual({ value: 1200, unit: 'km' });
  });

  it('tyres name the season, insurance the Stichtag, a switched-off item is quiet', () => {
    expect(dueModel(t, item({ type: 'tyre_change', season: 'winter' }), 'km', 'de').season).toBe('Als Nächstes: Winterreifen');
    expect(dueModel(t, item({ type: 'insurance', next_due: { date: '2026-11-30', month: null, km: null, pinned: false, deadline: null } }), 'km', 'de').due).toBe(
      'Stichtag 30. November 2026',
    );
    expect(dueModel(t, item({ enabled: false, days_left: 3 }), 'km', 'de').tone).toBe('unknown');
  });

  it('toneOf', () => {
    expect(toneOf('unknown', null)).toBe('unknown');
    expect(toneOf('ok', 29)).toBe('soon');
    expect(toneOf('ok', 30)).toBe('ok');
  });
});

describe('order and choice', () => {
  it('overdue first, then the nearest, switched-off last', () => {
    const a = item({ id: 'a', type: 'service', days_left: 200 });
    const b = item({ id: 'b', type: 'hu_au', state: 'overdue', days_left: -3 });
    const c = item({ id: 'c', type: 'oil_change', days_left: 20, state: 'soon' });
    const d = item({ id: 'd', type: 'brake_fluid', enabled: false, state: 'overdue' });
    expect(sortItems([a, d, c, b]).map((entry) => entry.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(heroItem(sortItems([a, d, c, b]))?.id).toBe('b');
  });

  it('every type but custom once per vehicle', () => {
    expect(freeTypes([item({ type: 'hu_au' }), item({ type: 'custom' })])).toEqual(['service', 'oil_change', 'brake_fluid', 'tyre_change', 'insurance', 'custom']);
  });

  it('the editor starts from the item, a computed due date stays out of the field', () => {
    const values = itemValuesFrom(item({ type: 'service', next_due: { date: '2027-01-01', month: null, km: 60000, pinned: false, deadline: null }, interval: { months: 24, km: 30000 } }), 'service', { huLeadDays: [30] }, 'km');
    expect(values.nextDate).toBe('');
    expect(values.intervalKm).toBe('30000');
    expect(itemValuesFrom(item(), 'hu_au', { huLeadDays: [30] }, 'km').dueMonth).toBe('03/2027');
    expect(itemValuesFrom(null, 'hu_au', { huLeadDays: [60, 14] }, 'km').lead).toEqual([60, 14]);
  });
});

describe('conversions', () => {
  it('km and mi', () => {
    expect(toUnit(16093, 'mi')).toBe(10000);
    expect(fromUnit(10000, 'mi')).toBe(16093);
    expect(distanceText(45000, 'km', 'de')).toBe('45.000 km');
  });

  it('euros', () => {
    expect(euroText(124000, 'de')).toBe('1.240 €');
    expect(euroText(18950, 'de')).toBe('189,50 €');
    expect(parseEuros('189,50', 'de')).toBe(18950);
    expect(parseEuros('1.240', 'de')).toBe(124000);
    expect(parseEuros('1.240,5 €', 'de')).toBe(124050);
    expect(parseEuros('189.50', 'en')).toBe(18950);
    expect(parseEuros('', 'de')).toBeNull();
    expect(parseEuros('zwölf', 'de')).toBeUndefined();
  });

  it('days, months, numbers', () => {
    expect(parseGermanDay('14.06.2026')).toBe('2026-06-14');
    expect(parseGermanDay('31.02.2026')).toBeUndefined();
    expect(parseGermanDay('')).toBeNull();
    expect(parseDueMonth('3/2027')).toBe('2027-03-01');
    expect(parseDueMonth('13/2027')).toBeUndefined();
    expect(parseWhole('45.000')).toBe(45000);
    expect(parseWhole('45k')).toBeUndefined();
    expect(maskDay('14062026')).toBe('14.06.2026');
    expect(maskDueMonth('032027')).toBe('03/2027');
  });
});

describe('client ULIDs (outbox, ADR-441)', () => {
  it('26 characters the API accepts, time first', () => {
    const id = newUlid(1_700_000_000_000);
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(encodeTime(0)).toBe('0000000000');
    expect(encodeRandom(new Uint8Array(10).fill(255))).toBe('zzzzzzzzzzzzzzzz');
    expect(newUlid(1_700_000_000_001) > newUlid(1_700_000_000_000)).toBe(true);
  });
});
