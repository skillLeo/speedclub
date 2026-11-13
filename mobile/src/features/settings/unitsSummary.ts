import type { PowerDisplay } from '@/lib/units';

/** A translation of the `settings` namespace. */
type Translate = (key: string) => string;

/** The unit a power display leads with: "PS (kW)" → PS. */
const LEAD_UNIT: Readonly<Record<PowerDisplay, string>> = { ps_kw: 'PS', kw_ps: 'kW', hp: 'hp' };

/**
 * SET-01's value of "Sprache & Einheiten" (09 §7.9): "Deutsch · PS · km". The language in its own name, the unit the power
 * display leads with, the distance unit. Unit symbols are the same in every language.
 */
export function languageSummary(t: Translate, language: string, power: PowerDisplay, distance: 'km' | 'mi'): string {
  const name = t(`language.names.${language === 'en' ? 'en' : 'de'}`);
  return [name, LEAD_UNIT[power], distance].join(' · ');
}
