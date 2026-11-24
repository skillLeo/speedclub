/**
 * Member web (M5.12a, 09 §12, ADR-473 "active-language-only i18n"): no language is in the first scripts. The active one loads as its own
 * chunk while the app starts (the root layout waits for it, like for the fonts), the other one only when the member switches language.
 */
import type de from './bundles/de';

export type LanguageBundle = typeof de;

export const bundledLanguages: Readonly<Record<string, LanguageBundle>> = {};

export function loadLanguage(language: 'de' | 'en'): Promise<LanguageBundle> {
  return language === 'en' ? import('./bundles/en').then((module) => module.default) : import('./bundles/de').then((module) => module.default);
}
