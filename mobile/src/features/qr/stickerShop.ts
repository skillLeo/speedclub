/**
 * "Sticker bestellen" (09 §3.2, §7.6 QR-02): an external shop, only behind the `sticker_shop` flag and only with an https
 * address in `app-config.links.sticker_shop`. No payment or order happens in the app.
 */
export const STICKER_SHOP_FLAG = 'sticker_shop';

export function stickerShopUrl(links: Readonly<Record<string, string | null>>): string | null {
  const text = links.sticker_shop?.trim();
  return text && /^https:\/\//i.test(text) ? text : null;
}
