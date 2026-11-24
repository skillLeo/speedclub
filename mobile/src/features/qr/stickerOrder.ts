/**
 * STK-06 "Sticker bestellen" (10 §2.3, ADR-502, m5.4-contract §7): the Shopify cart link opens outside the app, never a checkout in
 * it. Native: the system's in-app browser (SFSafariViewController / Custom Tab), as QR-04 and SHOP-02. Web: a new tab.
 *
 * The link comes from a POST, and browsers block a tab opened after an `await`. So the web opens an empty tab inside the tap and
 * sends it to the link once the answer is there; when there is no link (the store is not configured yet) the empty tab closes.
 */
import { isWeb } from '@/lib/platform';
import type { AppTheme } from '@/theme';

import { openPublicPage } from './openPublicPage';

export type PendingTab = { go: (url: string) => boolean; cancel: () => void };

/** Call inside the tap. Native: nothing to prepare. */
export function prepareOrderTab(win: Pick<Window, 'open'> | null = isWeb && typeof window !== 'undefined' ? window : null): PendingTab | null {
  if (!win) return null;
  const tab = win.open('', '_blank');
  if (!tab) return null;
  return {
    go: (url) => {
      try {
        tab.opener = null;
        tab.location.href = url;
        return true;
      } catch {
        return false;
      }
    },
    cancel: () => {
      try {
        tab.close();
      } catch {
        // Already closed by the member.
      }
    },
  };
}

/** Opens the cart link: in the prepared tab on the web, in the in-app browser on a device. */
export async function openOrderUrl(url: string, pending: PendingTab | null, theme: Pick<AppTheme, 'color'>): Promise<boolean> {
  if (!/^https:\/\//i.test(url)) {
    pending?.cancel();
    return false;
  }
  if (isWeb) {
    if (pending?.go(url)) return true;
    return typeof window !== 'undefined' && window.open(url, '_blank', 'noopener') !== null;
  }
  return openPublicPage(url, theme);
}
