/**
 * The `events` namespace (M4.12). Until the lead lists it in src/i18n/index.ts (a shared file), the feature adds its bundles to
 * the app's i18next instance itself; once it is listed there, this finds the bundles present and does nothing. Every events file
 * imports this module first, so a screen never renders a raw key.
 */
import i18n from '@/i18n';
import de from '@/i18n/locales/de/events.json';
import en from '@/i18n/locales/en/events.json';

export const EVENTS_NS = 'events';

const bundles = { de, en } as const;

for (const [language, bundle] of Object.entries(bundles)) {
  if (!i18n.hasResourceBundle(language, EVENTS_NS))
    i18n.addResourceBundle(language, EVENTS_NS, bundle, true, false);
}
if (!(i18n.options.ns as readonly string[] | undefined)?.includes(EVENTS_NS))
  void i18n.loadNamespaces(EVENTS_NS);
