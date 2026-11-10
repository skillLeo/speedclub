/**
 * Sharing the public profile (`/u/{username}`, WEB-02). Native opens the system share sheet. The web uses the Web Share
 * API where the browser has one and copies the link otherwise (§12 lists the share sheet as an allowed difference).
 */
import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import { siteUrl } from '@/features/settings/markdown/links';
import { isWeb } from '@/lib/platform';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/** The public page of a member, or null where the app knows no site to link to. */
export function publicProfileUrl(username: string, site: string | null = siteUrl()): string | null {
  if (!site || !username) return null;
  return `${site.replace(/\/+$/, '')}/u/${encodeURIComponent(username)}`;
}

type WebShareNavigator = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { url?: string }) => boolean;
};

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export async function shareLink({ url, title }: { url: string; title: string }): Promise<ShareOutcome> {
  if (isWeb) {
    const browser = (globalThis.navigator ?? {}) as WebShareNavigator;
    if (typeof browser.share === 'function' && (typeof browser.canShare !== 'function' || browser.canShare({ url }))) {
      try {
        await browser.share({ title, url });
        return 'shared';
      } catch (error) {
        if (isAbort(error)) return 'dismissed';
        // Not allowed here, for example inside a frame: copying still works.
      }
    }
    try {
      await Clipboard.setStringAsync(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    // iOS shares the URL as a link next to the text; Android has only the text, so the link goes into it.
    const result = await Share.share(Platform.OS === 'ios' ? { message: title, url } : { message: `${title}\n${url}`, title });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}
