import { getLocales } from 'expo-localization';
import { createInstance, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { bundledLanguages, loadLanguage } from './languages';

export const namespaces = [
  'common',
  'auth',
  'home',
  'discover',
  'garage',
  'vehicle',
  'qr',
  'dex',
  'messages',
  'events',
  'forum',
  'parts',
  'profile',
  'settings',
  'shop',
  'safety',
  'errors',
] as const;

export type AppLocale = 'de' | 'en';

/** German is the default. English applies when the device language is English. */
export function detectLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode;
  return code === 'en' ? 'en' : 'de';
}

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  // Native: both languages, present at once. Web (M5.12a): none yet; `i18nReady` adds the active one before the first screen renders.
  resources: bundledLanguages as Resource,
  lng: detectLocale(),
  fallbackLng: 'de',
  defaultNS: 'common',
  ns: namespaces,
  interpolation: { escapeValue: false },
  returnNull: false,
});

const loaded = new Set<string>(Object.keys(bundledLanguages));
const pending = new Map<AppLocale, Promise<void>>();

/** Makes a language's strings available: at once on native, on the web after its chunk has loaded (once per language). */
export function ensureLanguage(language: string): Promise<void> {
  const locale: AppLocale = language === 'en' ? 'en' : 'de';
  if (loaded.has(locale)) return Promise.resolve();
  let load = pending.get(locale);
  if (!load) {
    load = loadLanguage(locale).then(
      (bundle) => {
        for (const [namespace, strings] of Object.entries(bundle)) i18n.addResourceBundle(locale, namespace, strings, true, true);
        loaded.add(locale);
        pending.delete(locale);
      },
      (error: unknown) => {
        // A failed chunk (offline before the service worker had it) is tried again on the next call; the screens show keys meanwhile.
        pending.delete(locale);
        throw error;
      },
    );
    pending.set(locale, load);
  }
  return load;
}

/** True once the active language's strings are present (always on native). */
export function isLanguageLoaded(language: string = i18n.language): boolean {
  return loaded.has(language === 'en' ? 'en' : 'de');
}

// Every language switch waits for the new language's strings, so no screen renders a key in between.
const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = (language, callback) =>
  (language ? ensureLanguage(language).catch(() => undefined) : Promise.resolve()).then(() => changeLanguage(language, callback));

/** The active language's strings on the web; settles (also on a failed load) so the app never waits forever. */
export const i18nReady: Promise<void> = ensureLanguage(i18n.language || detectLocale()).catch(() => undefined);

export default i18n;
