/**
 * The `shop` namespace (M5.2). src/i18n/index.ts lists it with every other namespace, and its strings come with the language's bundle
 * (all at once on native, the active language's chunk on the web, M5.12a), so this module only names it. It no longer imports the JSON
 * files itself: that put both languages of the namespace into the web's first scripts a second time.
 */
export const SHOP_NS = 'shop';
