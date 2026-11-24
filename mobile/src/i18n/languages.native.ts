/**
 * Native (and the Jest preset, which resolves the native files): both languages are in the bundle and present from the first line,
 * as before M5.12a. Nothing waits, the Android widget's headless task included.
 */
import de from './bundles/de';
import en from './bundles/en';

export type LanguageBundle = typeof de;

export const bundledLanguages: Readonly<Record<string, LanguageBundle>> = { de, en };

export function loadLanguage(language: 'de' | 'en'): Promise<LanguageBundle> {
  return Promise.resolve(language === 'en' ? en : de);
}
