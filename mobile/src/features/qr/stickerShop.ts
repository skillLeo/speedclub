/**
 * "Sticker bestellen" (09 §3.2, §7.6 QR-02): an external shop, only behind the `sticker_shop` flag and only with an https
 * address in `app-config.links.sticker_shop`. No payment or order happens in the app.
 */
import { qaForcesFlag } from '@/lib/qa';

export const STICKER_SHOP_FLAG = 'sticker_shop';

/** DQ-1162: the test shop address the matrix's `qaFlags=sticker_shop` cells use on a host without STICKER_SHOP_URL (test data). */
export const QA_STICKER_SHOP_URL = 'https://shop.speedclub.test/sticker'; // i18n-ignore

export function stickerShopUrl(links: Readonly<Record<string, string | null>>): string | null {
  const text = links.sticker_shop?.trim() || (qaForcesFlag(STICKER_SHOP_FLAG) ? QA_STICKER_SHOP_URL : '');
  return text && /^https:\/\//i.test(text) ? text : null;
}
