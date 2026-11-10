import { segmentsFit } from '@/features/garage/components/fields';
import { maskTyre } from '@/features/garage/components/ModFieldInputs';
import {
  automaticTitle,
  costText,
  formFields,
  maskMonth,
  modLayout,
  modPayload,
  modValuesFrom,
  monthText,
  parseCost,
  parseMonth,
  previewLine,
  unitOf,
  type LayoutRow,
} from '@/features/garage/modForm';

import { SUSPENSION_FIELDS, WHEEL_FIELDS, wheelMod } from './fixtures';

function keys(rows: LayoutRow[]): string[] {
  return rows.map((row) => (row.kind === 'pair' ? `${row.fields[0].key}+${row.fields[1].key}` : row.kind === 'switch' ? `switch:${row.field.key}` : row.field.key));
}

describe('GAR-10 layout', () => {
  it('lays Räder & Reifen out as FS-6: rims first with front/rear side by side, then tyres', () => {
    const [rims, tyres] = modLayout('wheels_tires', WHEEL_FIELDS, false);
    expect(rims?.key).toBe('rims');
    expect(keys(rims?.rows ?? [])).toEqual([
      'wheel_brand',
      'wheel_model',
      'diameter',
      'width_front+width_rear',
      'et_front+et_rear',
      'bolt_pattern',
      'spacer_front+spacer_rear',
      'finish',
      'switch:staggered',
    ]);
    expect(tyres?.key).toBe('tyres');
    expect(keys(tyres?.rows ?? [])).toEqual(['tyre_brand', 'tyre_model', 'tyre_size_front+tyre_size_rear']);
  });

  it('adds the rear diameter beside the front once Mischbereifung is on (ADR-112)', () => {
    const [rims] = modLayout('wheels_tires', WHEEL_FIELDS, true);
    expect(keys(rims?.rows ?? [])[2]).toBe('diameter+diameter_rear');
  });

  it('lists any other category in its schema order with pairs and switches', () => {
    const groups = modLayout('suspension', SUSPENSION_FIELDS, false);
    expect(groups).toHaveLength(1);
    expect(keys(groups[0]?.rows ?? [])).toEqual(['type', 'brand', 'model', 'lowering_front+lowering_rear', 'switch:adjustable_damping']);
  });

  it('writes rim width in J and diameters in ″', () => {
    expect(unitOf({ key: 'width_front', unit: 'in' })).toBe('J');
    expect(unitOf({ key: 'diameter', unit: 'in' })).toBe('″');
    expect(unitOf({ key: 'lowering_front', unit: 'mm' })).toBe('mm');
    expect(unitOf({ key: 'et_front', unit: null })).toBeUndefined();
  });
});

describe('GAR-10 values', () => {
  it('reads months and amounts as people type them', () => {
    expect(monthText('2023-03')).toBe('03/2023');
    expect(monthText(null)).toBe('');
    expect(parseMonth('3/2023')).toBe('2023-03');
    expect(parseMonth('03.2023')).toBe('2023-03');
    expect(parseMonth('13/2023')).toBeNull();
    expect(parseMonth('2023')).toBeNull();
    expect(maskMonth('032023')).toBe('03/2023');
    expect(maskMonth('03/20')).toBe('03/20');
    expect(maskMonth('0')).toBe('0');
    expect(parseCost('1.234,50', 'de')).toBe(123450);
    expect(parseCost('2.400 €', 'de')).toBe(240000);
    expect(parseCost('1,234.50', 'en')).toBe(123450);
    expect(Number.isNaN(parseCost('-5', 'de'))).toBe(true);
    expect(costText(123450, 'de')).toBe('1.234,50');
    expect(costText(240000, 'de')).toBe('2.400');
    expect(costText(null, 'de')).toBe('');
  });

  it('masks a tyre size to 255/35 R19', () => {
    expect(maskTyre('2553519')).toBe('255/35 R19');
    expect(maskTyre('255/35R19')).toBe('255/35 R19');
    expect(maskTyre('2553')).toBe('255/3');
    expect(maskTyre('25')).toBe('25');
  });

  it('fills the form from the stored mod, numbers in the member’s format', () => {
    const values = modValuesFrom(wheelMod(), WHEEL_FIELDS, 'de');
    expect(values.fields).toMatchObject({ wheel_brand: 'BBS', diameter: '19', width_front: '9,5', et_front: '35', staggered: false, width_rear: '' });
    expect(values).toMatchObject({ status: 'installed', installedOn: '03/2023', cost: '2.400', costPublic: false, notes: 'Neu lackiert', title: '' });
    expect(modValuesFrom(wheelMod({ title: 'Meine Sommerräder' }), WHEEL_FIELDS, 'de').title).toBe('Meine Sommerräder');
    expect(modValuesFrom(undefined, WHEEL_FIELDS, 'de')).toMatchObject({ status: 'installed', costPublic: false, fields: { staggered: false, diameter: '' } });
  });

  it('sends fields as strict JSON: numbers in the schema unit, true for a switch, empty left out', () => {
    const values = modValuesFrom(wheelMod(), WHEEL_FIELDS, 'de');
    values.fields = { ...values.fields, et_front: '-12', diameter_rear: '20', staggered: false, finish: '  ' };
    const payload = modPayload(values, WHEEL_FIELDS, 'de', { titleTouched: false, staggered: false });
    expect(payload.fields).toEqual({ wheel_brand: 'BBS', wheel_model: 'LM', diameter: 19, width_front: 9.5, et_front: -12, tyre_size_front: '255/35 R19' });
    expect(payload).toMatchObject({ status: 'installed', installed_on: '2023-03', cost_cents: 240000, cost_public: false, notes: 'Neu lackiert' });
    expect('title' in payload).toBe(false);
    const staggered = modPayload({ ...values, fields: { ...values.fields, staggered: true } }, WHEEL_FIELDS, 'de', { titleTouched: true, staggered: true });
    expect(staggered.fields).toMatchObject({ diameter_rear: 20, staggered: true });
    expect(staggered.title).toBeNull();
  });

  it('drops the installation month of a planned part', () => {
    const values = { ...modValuesFrom(wheelMod(), WHEEL_FIELDS, 'de'), status: 'planned' as const };
    expect(modPayload(values, WHEEL_FIELDS, 'de', { titleTouched: false, staggered: false }).installed_on).toBeNull();
  });

  it("builds FS-6's live line from the form", () => {
    const values = modValuesFrom(wheelMod(), WHEEL_FIELDS, 'de').fields;
    expect(previewLine('wheels_tires', WHEEL_FIELDS, values, 'de')).toBe('BBS LM · 19″ × 9,5J ET35 · 255/35 R19');
    expect(previewLine('wheels_tires', WHEEL_FIELDS, { ...values, width_rear: '10,5', et_rear: '40', tyre_size_rear: '285/30 R19' }, 'de')).toBe(
      'BBS LM · 19″ × 9,5J ET35 / 19″ × 10,5J ET40 · 255/35 R19 / 285/30 R19',
    );
    expect(previewLine('suspension', SUSPENSION_FIELDS, { type: 'coilover', brand: 'KW', model: 'V3', lowering_front: '35' }, 'de')).toBe(
      'KW V3 · Gewindefahrwerk · 35 mm',
    );
    expect(previewLine('wheels_tires', WHEEL_FIELDS, {}, 'de')).toBe('');
    expect(automaticTitle({ title: 'Folierung matt' })).toBe('Folierung matt');
  });
});

describe('segmentsFit (DQ-155)', () => {
  it('keeps the segmented control while the widest label and its padding fit a third of the track', () => {
    // (350 − 4) / 3 = 115.3 per segment, 16 of it label padding.
    expect(segmentsFit(350, [60, 62, 99])).toBe(true);
    expect(segmentsFit(350, [60, 62, 100])).toBe(false);
  });

  it('waits for the track and every label', () => {
    expect(segmentsFit(0, [60, 62, 70])).toBeNull();
    expect(segmentsFit(350, [60, 0, 70])).toBeNull();
    expect(segmentsFit(350, [])).toBeNull();
  });
});

describe('stored numbers round-trip without loss (BH-04)', () => {
  const options = { titleTouched: false, staggered: false };
  const mod = (value: number) => wheelMod({ category: { key: 'suspension', name: 'Fahrwerk', icon: 'suspension' }, fields: { lowering_front: value } });

  it.each([
    [27.25, 'de', '27,25'],
    [27.1255, 'de', '27,1255'],
    [27, 'de', '27'],
    [1500, 'de', '1500'],
    [-35.5, 'de', '-35,5'],
    [27.25, 'en', '27.25'],
    [27.1255, 'en', '27.1255'],
    [1500, 'en', '1500'],
  ] as const)('%d in %s shows as %s and goes back out unchanged', (value, locale, text) => {
    const values = modValuesFrom(mod(value), SUSPENSION_FIELDS, locale);
    expect(values.fields.lowering_front).toBe(text);
    expect(modPayload(values, SUSPENSION_FIELDS, locale, options).fields?.lowering_front).toBe(value);
  });

  it('keeps one decimal in the display-only line', () => {
    const values = modValuesFrom(mod(27.25), SUSPENSION_FIELDS, 'de');
    expect(previewLine('suspension', SUSPENSION_FIELDS, values.fields, 'de')).toContain('27,3');
  });
});

describe('a refused number never clears the field silently (BH-01)', () => {
  it('reads as no amount, so only the schema can pass it on', () => {
    expect(parseCost('1234.50', 'de')).toBeNaN();
    expect(parseCost('1234,50', 'en')).toBeNaN();
    expect(parseCost('1.234,50', 'de')).toBe(123450);
    expect(parseCost('1,234.50', 'en')).toBe(123450);
  });
});

describe('GAR-10 archived fields (M3.3 catalogue)', () => {
  const archived = { ...SUSPENSION_FIELDS[1]!, key: 'old_note', archived: true };
  const fields = [...SUSPENSION_FIELDS, archived];

  it('offers no archived field for a new modification', () => {
    expect(formFields(fields, undefined).map((field) => field.key)).not.toContain('old_note');
  });

  it('keeps an archived field on an existing modification while it holds a value', () => {
    expect(formFields(fields, { fields: { old_note: 'KW V3' } }).map((field) => field.key)).toContain('old_note');
    expect(formFields(fields, { fields: { old_note: '' } }).map((field) => field.key)).not.toContain('old_note');
  });
});
