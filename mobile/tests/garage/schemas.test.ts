import i18n from '@/i18n';
import { modValuesFrom } from '@/features/garage/modForm';
import { basicsValues, specsValues } from '@/features/garage/model';
import { basicsSchema, currentMonth, fieldIssue, fieldMessage, issue, maxModelYear, modSchema, noteSchema, specsSchema } from '@/features/garage/schemas';

import { WHEEL_FIELDS, wheelMod } from './fixtures';

const t = i18n.getFixedT('de', 'garage');

function messages(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((entry) => [entry.path.join('.'), entry.message]));
}

describe('basics', () => {
  const schema = basicsSchema(2027);

  it('needs make, model and a model year between 1886 and next year', () => {
    const empty = messages(schema.safeParse(basicsValues(undefined)));
    expect(empty).toMatchObject({ make: 'validation.makeRequired', model: 'validation.modelRequired', year: 'validation.yearRequired' });
    const base = { ...basicsValues(undefined), make: { id: 1, name: 'BMW' }, model: { id: null, name: 'M3' } };
    expect(schema.safeParse({ ...base, year: '2002' }).success).toBe(true);
    expect(messages(schema.safeParse({ ...base, year: '1885' })).year).toBe(issue('validation.yearRange', { min: 1886, max: 2027 }));
    expect(schema.safeParse({ ...base, year: '2028' }).success).toBe(false);
    expect(schema.safeParse({ ...base, year: '2002', description: 'x'.repeat(501) }).success).toBe(false);
    expect(maxModelYear(new Date('2026-11-03T12:00:00Z'))).toBe(2027);
  });

  it('words a range with its bounds', () => {
    expect(fieldMessage(t, { type: 'custom', message: issue('validation.yearRange', { min: 1886, max: 2027 }) })).toBe(
      'Gib ein Baujahr zwischen 1886 und 2027 ein.',
    );
    expect(fieldMessage(t, { type: 'server', message: 'Vom Server' })).toBe('Vom Server');
    expect(fieldMessage(t, undefined)).toBeUndefined();
  });
});

describe('specs', () => {
  const schema = specsSchema('de');

  it('takes German numbers and keeps the server bounds', () => {
    const values = specsValues(undefined, 'de');
    expect(schema.safeParse({ ...values, powerValue: '368,5', torque: '540', displacement: '2.568' }).success).toBe(true);
    expect(messages(schema.safeParse({ ...values, powerValue: '0' })).powerValue).toBe(issue('validation.range', { min: 1, max: 9999 }));
    expect(messages(schema.safeParse({ ...values, torque: '540,5' })).torque).toBe('validation.integer');
    expect(messages(schema.safeParse({ ...values, displacement: 'viel' })).displacement).toBe('validation.integer');
    expect(messages(schema.safeParse({ ...values, powerValue: 'viel' })).powerValue).toBe('validation.number');
    expect(schema.safeParse({ ...values, engineCode: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('mods', () => {
  const field = (key: string) => WHEEL_FIELDS.find((entry) => entry.key === key)!;

  it('checks a field as ModFields does: bounds, step, pattern, required', () => {
    expect(fieldIssue(field('diameter'), '19,5', 'de')).toBeNull();
    expect(fieldIssue(field('diameter'), '19,3', 'de')).toBe(issue('validation.step', { step: '0,5' }));
    expect(fieldIssue(field('diameter'), '25', 'de')).toBe(issue('validation.range', { min: 13, max: 24 }));
    expect(fieldIssue(field('et_front'), '-51', 'de')).toBe(issue('validation.range', { min: -50, max: 70 }));
    expect(fieldIssue(field('tyre_size_front'), '255/35 R19', 'de')).toBeNull();
    expect(fieldIssue(field('tyre_size_front'), '255/35R19', 'de')).toBe(issue('validation.pattern', { example: '255/35 R19' }));
    expect(fieldIssue(field('staggered'), true, 'de')).toBeNull();
    expect(fieldIssue({ ...field('wheel_model'), required: true }, '', 'de')).toBe(issue('validation.fieldRequired', { field: 'Felgenmodell' }));
  });

  it('refuses a month in the future and an amount that is not one', () => {
    const schema = modSchema(WHEEL_FIELDS, 'de', '2026-11');
    const values = modValuesFrom(wheelMod(), WHEEL_FIELDS, 'de');
    expect(schema.safeParse(values).success).toBe(true);
    expect(messages(schema.safeParse({ ...values, installedOn: '12/2026' })).installedOn).toBe('validation.monthFuture');
    expect(messages(schema.safeParse({ ...values, installedOn: '2026' })).installedOn).toBe('validation.month');
    expect(schema.safeParse({ ...values, status: 'planned', installedOn: '12/2030' }).success).toBe(true);
    expect(messages(schema.safeParse({ ...values, cost: 'teuer' })).cost).toBe('validation.cost');
    expect(messages(schema.safeParse({ ...values, fields: { ...values.fields, diameter: '30' } }))['fields.diameter']).toBe(issue('validation.range', { min: 13, max: 24 }));
    expect(currentMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12');
  });

  it('needs a note to have words', () => {
    expect(noteSchema.safeParse({ note: '   ' }).success).toBe(false);
    expect(noteSchema.safeParse({ note: 'Erster Trackday' }).success).toBe(true);
  });
});

describe('numbers with the wrong mark (BH-01)', () => {
  const de = specsSchema('de');
  const en = specsSchema('en');
  const specs = { ...specsValues(undefined, 'de') };

  it.each(['110.5', '540.5', '1.2.3'])('refuses power %s in German with the message that says what to do', (text) => {
    expect(messages(de.safeParse({ ...specs, powerValue: text })).powerValue).toBe('validation.number');
  });

  it.each(['110,5', '1,2,3'])('refuses power %s in English', (text) => {
    expect(messages(en.safeParse({ ...specs, powerValue: text })).powerValue).toBe('validation.number');
  });

  it('refuses a displacement of 2.0 instead of storing 20, without advising a decimal mark it cannot take', () => {
    expect(messages(de.safeParse({ ...specs, displacement: '2.0' })).displacement).toBe('validation.integer');
  });

  // An integer-only field must not say "Nutze ein Komma": the comma then fails as "not a whole number", a circle.
  it.each([
    ['de', 'displacement', '1.99'],
    ['de', 'torque', '540.5'],
    ['en', 'displacement', '1,99'],
    ['en', 'torque', '540,5'],
  ] as const)('in %s a whole-number field (%s) refuses %s with its own message', (locale, key, text) => {
    const schema = locale === 'de' ? de : en;
    expect(messages(schema.safeParse({ ...specs, [key]: text }))[key]).toBe('validation.integer');
    expect(fieldMessage(i18n.getFixedT(locale, 'garage'), { type: 'custom', message: 'validation.integer' })).not.toMatch(/Komma|comma|point|Punkt/);
  });

  it('a mod field that only takes whole steps says the same', () => {
    const whole = { ...WHEEL_FIELDS.find((entry) => entry.key === 'et_front')!, step: 1, min: -50 };
    expect(fieldIssue(whole, '35.5', 'de')).toBe('validation.integer');
    expect(fieldIssue(whole, '35,5', 'de')).toBe(issue('validation.step', { step: '1' }));
    const half = WHEEL_FIELDS.find((entry) => entry.key === 'diameter')!;
    expect(fieldIssue(half, '19.5', 'de')).toBe('validation.number');
  });

  it('tells the member which mark to use, in both languages', () => {
    expect(fieldMessage(t, { type: 'custom', message: 'validation.number' })).toBe('Gib eine Zahl ein. Nutze ein Komma für Dezimalstellen.');
    expect(fieldMessage(i18n.getFixedT('en', 'garage'), { type: 'custom', message: 'validation.number' })).toBe('Enter a number. Use a point for decimals.');
    expect(fieldMessage(t, { type: 'custom', message: 'validation.cost' })).toMatch(/Komma/);
    expect(fieldMessage(i18n.getFixedT('en', 'garage'), { type: 'custom', message: 'validation.cost' })).toMatch(/point/);
  });

  it('refuses a rim width of 9.5 and a cost of 1234.50 in a mod', () => {
    const schema = modSchema(WHEEL_FIELDS, 'de', '2026-11');
    const values = modValuesFrom(undefined, WHEEL_FIELDS, 'de');
    const errors = messages(schema.safeParse({ ...values, cost: '1234.50', fields: { ...values.fields, width_front: '9.5' } }));
    expect(errors['fields.width_front']).toBe('validation.number');
    expect(errors.cost).toBe('validation.cost');
  });
});

describe('a hidden rear diameter (BH-11)', () => {
  const schema = modSchema(WHEEL_FIELDS, 'de', '2026-11');
  const values = modValuesFrom(undefined, WHEEL_FIELDS, 'de');

  it('does not block the save while Mischbereifung is off, because the payload leaves it out', () => {
    expect(schema.safeParse({ ...values, fields: { ...values.fields, staggered: false, diameter_rear: '19,3' } }).success).toBe(true);
    expect(schema.safeParse({ ...values, fields: { ...values.fields, staggered: false, diameter_rear: 'abc' } }).success).toBe(true);
  });

  it('is checked while Mischbereifung is on', () => {
    const errors = messages(schema.safeParse({ ...values, fields: { ...values.fields, staggered: true, diameter_rear: '19,3' } }));
    expect(errors['fields.diameter_rear']).toBe(issue('validation.step', { step: '0,5' }));
    expect(schema.safeParse({ ...values, fields: { ...values.fields, staggered: true, diameter_rear: '19,5' } }).success).toBe(true);
  });
});

describe('the German calendar decides (BH-07, BH-48)', () => {
  it('counts the model year in Europe/Berlin, whatever the device says', () => {
    // New Year's night in Germany, still the old year in UTC and further west.
    expect(maxModelYear(new Date('2026-12-31T22:59:59Z'))).toBe(2027);
    expect(maxModelYear(new Date('2026-12-31T23:00:00Z'))).toBe(2028);
    expect(maxModelYear(new Date('2027-06-30T12:00:00Z'))).toBe(2028);
  });

  it('counts the install month the same way, also in summer time', () => {
    expect(currentMonth(new Date('2026-11-30T22:59:59Z'))).toBe('2026-11');
    expect(currentMonth(new Date('2026-11-30T23:00:00Z'))).toBe('2026-12');
    expect(currentMonth(new Date('2027-05-31T21:59:59Z'))).toBe('2027-05');
    expect(currentMonth(new Date('2027-05-31T22:00:00Z'))).toBe('2027-06');
  });

  it('follows a frozen clock (qaNow)', () => {
    jest.useFakeTimers({ now: new Date('2026-12-31T23:30:00Z') });
    try {
      expect(maxModelYear(new Date())).toBe(2028);
    } finally {
      jest.useRealTimers();
    }
  });
});
