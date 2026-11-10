import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import * as format from './format';
import { usePowerDisplayPreference } from './powerDisplay';
import * as units from './units';

type Locale = format.FormatLocale;

export function toFormatLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'de';
}

function createFormatters(locale: Locale, powerDisplay: units.PowerDisplay) {
  return {
    locale,
    number: (value: number, options?: format.NumberOptions) => format.formatNumber(value, locale, options),
    monthYear: (date: Date) => format.formatMonthYear(date, locale),
    date: (date: Date) => format.formatDate(date, locale),
    time: (date: Date) => format.formatTime(date, locale),
    dateTime: (date: Date) => format.formatDateTime(date, locale),
    relative: (date: Date, reference?: Date) => format.formatRelative(date, locale, reference),
    /** In the member's SET-11 display unless a call names one. */
    power: (value: number, unit: units.PowerUnit, display?: units.PowerDisplay) =>
      units.formatPower(value, unit, display ?? powerDisplay, locale),
    torque: (nm: number) => units.formatTorque(nm, locale),
    wheel: (wheel: units.WheelSize) => units.formatWheel(wheel, locale),
    tyre: (tyre: units.TyreSize) => units.formatTyre(tyre, locale),
    lowering: (mm: number) => units.formatLowering(mm, locale),
    displacement: (cc: number) => units.formatDisplacement(cc, locale),
    displacementShort: (cc: number) => units.formatDisplacementShort(cc, locale),
  };
}

/**
 * Formatters bound to the current language, so a screen cannot forget the locale:
 *
 *   const format = useFormat();
 *   format.relative(date); format.power(510, 'ps');   // in the SET-11 display
 */
export function useFormat() {
  const { i18n } = useTranslation();
  const locale = toFormatLocale(i18n.language);
  const powerDisplay = usePowerDisplayPreference();
  return useMemo(() => createFormatters(locale, powerDisplay), [locale, powerDisplay]);
}
