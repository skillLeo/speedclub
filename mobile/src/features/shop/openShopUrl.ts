/**
 * "Im Shop kaufen" and "Versand" (10 §3, ADR-502): the server's https address opens outside the app, never a checkout
 * in it. Native: the system's in-app browser (SFSafariViewController / Custom Tab) through the M5.4/M1.7 helper, as STK-06 and
 * QR-04. Web: a new tab, `noopener,noreferrer` (contract §3.3), opened inside the tap: the address is already known from the GET,
 * so no tab has to be prepared before an await (the reason `features/qr/stickerOrder.ts` prepares one).
 *
 * Only https passes: the caller hands the server's link through unchanged; nothing is added (no tracking parameters).
 */
import { openPublicPage } from '@/features/qr/openPublicPage';
import { isWeb } from '@/lib/platform';
import type { AppTheme } from '@/theme';

export type ShopWindow = Pick<Window, 'open'>;

export async function openShopUrl(
  url: string,
  theme: Pick<AppTheme, 'color'>,
  win: ShopWindow | null = isWeb && typeof window !== 'undefined' ? window : null,
): Promise<boolean> {
  if (!/^https:\/\//i.test(url)) return false;
  if (isWeb) {
    if (!win) return false;
    // With `noopener` the browser returns null even when the tab opened, so the answer cannot tell; the tap did open it.
    win.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
  return openPublicPage(url, theme);
}
