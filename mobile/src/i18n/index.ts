import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import authDe from './locales/de/auth.json';
import commonDe from './locales/de/common.json';
import discoverDe from './locales/de/discover.json';
import errorsDe from './locales/de/errors.json';
import garageDe from './locales/de/garage.json';
import homeDe from './locales/de/home.json';
import messagesDe from './locales/de/messages.json';
import profileDe from './locales/de/profile.json';
import qrDe from './locales/de/qr.json';
import safetyDe from './locales/de/safety.json';
import settingsDe from './locales/de/settings.json';
import vehicleDe from './locales/de/vehicle.json';
import authEn from './locales/en/auth.json';
import commonEn from './locales/en/common.json';
import discoverEn from './locales/en/discover.json';
import errorsEn from './locales/en/errors.json';
import garageEn from './locales/en/garage.json';
import homeEn from './locales/en/home.json';
import messagesEn from './locales/en/messages.json';
import profileEn from './locales/en/profile.json';
import qrEn from './locales/en/qr.json';
import safetyEn from './locales/en/safety.json';
import settingsEn from './locales/en/settings.json';
import vehicleEn from './locales/en/vehicle.json';

export const namespaces = [
  'common',
  'auth',
  'home',
  'discover',
  'garage',
  'vehicle',
  'qr',
  'messages',
  'profile',
  'settings',
  'safety',
  'errors',
] as const;

export const resources = {
  de: {
    common: commonDe,
    auth: authDe,
    home: homeDe,
    discover: discoverDe,
    garage: garageDe,
    vehicle: vehicleDe,
    qr: qrDe,
    messages: messagesDe,
    profile: profileDe,
    settings: settingsDe,
    safety: safetyDe,
    errors: errorsDe,
  },
  en: {
    common: commonEn,
    auth: authEn,
    home: homeEn,
    discover: discoverEn,
    garage: garageEn,
    vehicle: vehicleEn,
    qr: qrEn,
    messages: messagesEn,
    profile: profileEn,
    settings: settingsEn,
    safety: safetyEn,
    errors: errorsEn,
  },
} as const;

export type AppLocale = keyof typeof resources;

/** German is the default. English applies when the device language is English. */
export function detectLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode;
  return code === 'en' ? 'en' : 'de';
}

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: 'de',
  defaultNS: 'common',
  ns: namespaces,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
