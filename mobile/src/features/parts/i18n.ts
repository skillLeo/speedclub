/**
 * The `parts` namespace (M4.14: brands, products and business profiles). Until the lead lists it in src/i18n/index.ts (a shared file),
 * the feature adds its bundles to the app's i18next instance itself, as features/events/i18n.ts does; once it is listed there, this
 * finds the bundles present and does nothing. Every parts file imports this module first, so a screen never renders a raw key.
 */
import i18n from '@/i18n';
import de from '@/i18n/locales/de/parts.json';
import en from '@/i18n/locales/en/parts.json';

export const PARTS_NS = 'parts';

const bundles = { de, en } as const;

for (const [language, bundle] of Object.entries(bundles)) {
  if (!i18n.hasResourceBundle(language, PARTS_NS)) i18n.addResourceBundle(language, PARTS_NS, bundle, true, false);
}
if (!(i18n.options.ns as readonly string[] | undefined)?.includes(PARTS_NS)) void i18n.loadNamespaces(PARTS_NS);
