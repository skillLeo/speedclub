import {
  convertPower,
  formatDisplacement,
  formatDisplacementShort,
  formatLowering,
  formatPower,
  formatTorque,
  formatTyre,
  formatWheel,
} from '@/lib/units';

describe('power', () => {
  it('uses the exact factors from the product spec', () => {
    expect(convertPower(1, 'kw', 'ps')).toBeCloseTo(1.35962, 5);
    expect(convertPower(1, 'hp', 'ps')).toBeCloseTo(1.01387, 5);
    expect(convertPower(1.35962, 'ps', 'kw')).toBeCloseTo(1, 5);
  });

  it('keeps the entered unit unconverted', () => {
    expect(convertPower(510.4, 'ps', 'ps')).toBe(510.4);
    expect(convertPower(375, 'kw', 'kw')).toBe(375);
  });

  it('shows PS (kW) by default', () => {
    expect(formatPower(510, 'ps')).toBe('510\u00A0PS (375\u00A0kW)');
    expect(formatPower(375, 'kw')).toBe('510\u00A0PS (375\u00A0kW)');
  });

  it('follows the display setting', () => {
    expect(formatPower(510, 'ps', 'kw_ps')).toBe('375\u00A0kW (510\u00A0PS)');
    expect(formatPower(510, 'ps', 'hp')).toBe('503\u00A0hp');
    expect(formatPower(503, 'hp', 'ps_kw')).toBe('510\u00A0PS (375\u00A0kW)');
    expect(formatPower(503, 'hp', 'hp')).toBe('503\u00A0hp');
  });

  it('rounds to integers, half away from zero', () => {
    expect(formatPower(100.5, 'ps', 'ps_kw')).toBe('101\u00A0PS (74\u00A0kW)');
    expect(formatPower(100.4, 'ps', 'ps_kw')).toBe('100\u00A0PS (74\u00A0kW)');
    expect(formatPower(-100.5, 'ps', 'ps_kw')).toBe('−101\u00A0PS (−74\u00A0kW)');
  });

  it('groups thousands per locale', () => {
    expect(formatPower(1500, 'ps', 'ps_kw', 'de')).toBe('1.500\u00A0PS (1.103\u00A0kW)');
    expect(formatPower(1500, 'ps', 'ps_kw', 'en')).toBe('1,500\u00A0PS (1,103\u00A0kW)');
  });
});

describe('torque', () => {
  it('formats newton metres', () => {
    expect(formatTorque(650)).toBe('650\u00A0Nm');
    expect(formatTorque(1200, 'de')).toBe('1.200\u00A0Nm');
    expect(formatTorque(1200, 'en')).toBe('1,200\u00A0Nm');
    expect(formatTorque(649.5)).toBe('650\u00A0Nm');
  });
});

describe('wheels and tyres', () => {
  it('formats the wheel line', () => {
    expect(formatWheel({ diameter: 19, width: 9.5, offset: 35 }, 'de')).toBe('19″ × 9,5J ET35');
    expect(formatWheel({ diameter: 19, width: 9.5, offset: 35 }, 'en')).toBe('19″ × 9.5J ET35');
    expect(formatWheel({ diameter: 18.5, width: 8, offset: 0 }, 'de')).toBe('18,5″ × 8J ET0');
  });

  it('uses a real minus for a negative offset', () => {
    expect(formatWheel({ diameter: 17, width: 10, offset: -12 })).toBe('17″ × 10J ET−12');
  });

  it('omits empty parts', () => {
    expect(formatWheel({ diameter: 19 })).toBe('19″');
    expect(formatWheel({ width: 9.5, offset: 35 })).toBe('9,5J ET35');
    expect(formatWheel({})).toBe('');
  });

  it('formats tyres', () => {
    expect(formatTyre({ width: 255, aspect: 35, rim: 19 })).toBe('255/35 R19');
    expect(formatTyre({ width: 245, aspect: 45, rim: 19.5 }, 'de')).toBe('245/45 R19,5');
    expect(formatTyre({ width: 245, aspect: 45, rim: 19.5 }, 'en')).toBe('245/45 R19.5');
  });
});

describe('lowering', () => {
  it('uses U+2212, not a hyphen', () => {
    expect(formatLowering(-35)).toBe('−35\u00A0mm');
    expect(formatLowering(-35).charCodeAt(0)).toBe(0x2212);
  });

  it('signs a raise and leaves zero bare', () => {
    expect(formatLowering(20)).toBe('+20\u00A0mm');
    expect(formatLowering(0)).toBe('0\u00A0mm');
    expect(formatLowering(-0.4)).toBe('0\u00A0mm');
  });
});

describe('displacement', () => {
  it('formats cm³ per locale', () => {
    expect(formatDisplacement(2568, 'de')).toBe('2.568\u00A0cm³');
    expect(formatDisplacement(2568, 'en')).toBe('2,568\u00A0cm³');
    expect(formatDisplacement(998)).toBe('998\u00A0cm³');
  });

  it('formats short litres with one decimal', () => {
    expect(formatDisplacementShort(2568, 'de')).toBe('2,6\u00A0l');
    expect(formatDisplacementShort(2568, 'en')).toBe('2.6\u00A0l');
    expect(formatDisplacementShort(2998)).toBe('3,0\u00A0l');
  });

  it('rounds the half up on whole cm³, unaffected by binary floats', () => {
    expect(formatDisplacementShort(1450)).toBe('1,5\u00A0l');
    expect(formatDisplacementShort(1449)).toBe('1,4\u00A0l');
  });
});
