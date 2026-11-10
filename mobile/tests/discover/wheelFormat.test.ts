import { EMPTY_CELL, loweringCell, partCell, spacerCell, tyreCell, wheelAxles, wheelSizeCell } from '@/features/discover/wheelFormat';

const NBSP = ' ';

describe('the wheel-setup table cells (§3.9)', () => {
  it('writes a wheel as "19″ × 9,5J ET35" in German and with a point in English', () => {
    expect(wheelSizeCell(19, 9.5, 35, 'de')).toBe('19″ × 9,5J ET35');
    expect(wheelSizeCell(19, 9.5, 35, 'en')).toBe('19″ × 9.5J ET35');
    expect(wheelSizeCell(20, null, -12, 'de')).toBe('20″ ET−12');
    expect(wheelSizeCell(null, null, null, 'de')).toBe(EMPTY_CELL);
  });

  it('takes the front diameter for the rear of a square set and keeps a staggered rear (ADR-112)', () => {
    expect(wheelAxles({ diameter: 19, width: 9, offset: 29 }, { diameter: null, width: 10, offset: 40 }, 'de')).toEqual({
      front: '19″ × 9J ET29',
      rear: '19″ × 10J ET40',
    });
    expect(wheelAxles({ diameter: 19, width: 9.5, offset: 35 }, { diameter: null, width: null, offset: null }, 'de').rear).toBe('19″ × 9,5J ET35');
    expect(wheelAxles({ diameter: 20, width: 9, offset: 50 }, { diameter: 21, width: 11.5, offset: 65 }, 'de').rear).toBe('21″ × 11,5J ET65');
  });

  it('writes a tyre as "255/35 R19" whatever spacing was typed, and leaves anything else as it is', () => {
    expect(tyreCell('255/35R19', 'de')).toBe(`255/35${NBSP}R19`);
    expect(tyreCell(' 275 / 30 zr 20 ', 'de')).toBe(`275/30${NBSP}ZR20`);
    expect(tyreCell('Semislicks', 'de')).toBe('Semislicks');
    expect(tyreCell(null, 'de')).toBe(EMPTY_CELL);
  });

  it('shows lowering as a signed change, once when both axles match', () => {
    expect(loweringCell(35, 35, 'de')).toBe(`−35${NBSP}mm`);
    expect(loweringCell(35, 30, 'de')).toBe(`−35 / −30${NBSP}mm`);
    expect(loweringCell(null, 20, 'de')).toBe(`−20${NBSP}mm`);
    expect(loweringCell(null, null, 'de')).toBe(EMPTY_CELL);
  });

  it('shows spacers per axle and none as the dash', () => {
    expect(spacerCell(10, 15, 'de')).toBe(`+10 / +15${NBSP}mm`);
    expect(spacerCell(12, 12, 'de')).toBe(`+12${NBSP}mm`);
    expect(spacerCell(0, null, 'de')).toBe(EMPTY_CELL);
  });

  it('names the part by brand and model', () => {
    expect(partCell('BBS', 'LM')).toBe('BBS LM');
    // DQ-452: the model's words stay together, the line may break between brand and model only.
    expect(partCell('Rays Volk Racing', 'TE37 SL')).toBe('Rays Volk Racing TE37\u00A0SL');
    expect(partCell(null, '  ')).toBe(EMPTY_CELL);
  });
});

describe('partCell long models (DQ-452 round 4)', () => {
  it('keeps the code with its short suffix in the seed names', () => {
    expect(partCell('Rays', 'Volk Racing TE37 SL')).toBe('Rays Volk Racing TE37\u00A0SL');
    expect(partCell('Rays', 'Volk Racing TE37 Saga')).toBe('Rays Volk Racing TE37\u00A0Saga');
  });
});
