/**
 * Vehicle units (02_PRODUCT_SPEC.md §3.2, §3.9). The value stays stored as the member entered it;
 * conversion only happens for display, and the entered unit is never converted through another one.
 */
import { formatNumber, roundInt, type FormatLocale } from './format';

export const KW_TO_PS = 1.35962;
export const HP_TO_PS = 1.01387;

export type PowerUnit = 'ps' | 'kw' | 'hp';
/** The SET-11 setting: PS (kW) is the default. */
export type PowerDisplay = 'ps_kw' | 'kw_ps' | 'hp';

const PS_PER_UNIT: Record<PowerUnit, number> = { ps: 1, kw: KW_TO_PS, hp: HP_TO_PS };
const POWER_LABEL: Record<PowerUnit, string> = { ps: 'PS', kw: 'kW', hp: 'hp' };
/** U+00A0 between number and unit, so wrapped text (200 % font) never leaves a unit alone on a line. */
const NBSP = '\u00A0';

export function convertPower(value: number, from: PowerUnit, to: PowerUnit): number {
  return from === to ? value : (value * PS_PER_UNIT[from]) / PS_PER_UNIT[to];
}

function powerPart(value: number, from: PowerUnit, to: PowerUnit, locale: FormatLocale): string {
  return `${formatNumber(roundInt(convertPower(value, from, to)), locale)}${NBSP}${POWER_LABEL[to]}`;
}

/** "510 PS (375 kW)", "375 kW (510 PS)" or "503 hp". */
export function formatPower(
  value: number,
  unit: PowerUnit,
  display: PowerDisplay = 'ps_kw',
  locale: FormatLocale = 'de',
): string {
  if (display === 'hp') return powerPart(value, unit, 'hp', locale);
  const [primary, secondary]: [PowerUnit, PowerUnit] = display === 'kw_ps' ? ['kw', 'ps'] : ['ps', 'kw'];
  return `${powerPart(value, unit, primary, locale)} (${powerPart(value, unit, secondary, locale)})`;
}

/** "650 Nm" */
export function formatTorque(nm: number, locale: FormatLocale = 'de'): string {
  return `${formatNumber(roundInt(nm), locale)}${NBSP}Nm`;
}

export type WheelSize = { diameter?: number | null; width?: number | null; offset?: number | null };

/** "19″ × 9,5J ET35". Parts the member left empty are omitted. */
export function formatWheel({ diameter, width, offset }: WheelSize, locale: FormatLocale = 'de'): string {
  const size = [
    diameter == null ? null : `${formatNumber(diameter, locale, { maxFractionDigits: 1 })}″`,
    width == null ? null : `${formatNumber(width, locale, { maxFractionDigits: 1 })}J`,
  ]
    .filter(Boolean)
    .join(' × ');
  const et = offset == null ? null : `ET${formatNumber(offset, locale, { maxFractionDigits: 0 })}`;
  return [size, et].filter(Boolean).join(' ');
}

export type TyreSize = { width: number; aspect: number; rim: number };

/** "255/35 R19" */
export function formatTyre({ width, aspect, rim }: TyreSize, locale: FormatLocale = 'de'): string {
  return `${width}/${aspect} R${formatNumber(rim, locale, { maxFractionDigits: 1 })}`;
}

/** Signed height change: "−35 mm" lowered, "+20 mm" raised, "0 mm" stock. */
export function formatLowering(mm: number, locale: FormatLocale = 'de'): string {
  const rounded = roundInt(mm);
  return `${rounded > 0 ? '+' : ''}${formatNumber(rounded, locale)}${NBSP}mm`;
}

/** "2.568 cm³" */
export function formatDisplacement(cc: number, locale: FormatLocale = 'de'): string {
  return `${formatNumber(roundInt(cc), locale)}${NBSP}cm³`;
}

/** "2,6 l". Rounds on the integer cm³ value so 1450 gives 1,5 and not a binary-float 1,4. */
export function formatDisplacementShort(cc: number, locale: FormatLocale = 'de'): string {
  const litres = Math.round(cc / 100) / 10;
  return `${formatNumber(litres, locale, { minFractionDigits: 1, maxFractionDigits: 1 })}${NBSP}l`;
}
