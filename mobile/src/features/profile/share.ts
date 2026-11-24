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

/** M5.7 (contract §2.4): a link someone shares carries `?via=share`, so a view through it counts as "geteilter Link". */
export function withShareVia(url: string): string {
  if (/[?&]via=share(?:&|#|$)/.test(url)) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}via=share${hash}`;
}

/** The profile address for the share sheet: the server's `share_url` where the resource has one, else the public page with `?via=share`. */
export function profileShareUrl(username: string, shareUrl: string | null | undefined = null, site: string | null = siteUrl()): string | null {
  if (shareUrl) return shareUrl;
  const url = publicProfileUrl(username, site);
  return url ? withShareVia(url) : null;
}

/** A build's address for the share sheet when only its slug is known (INS-01's vehicle reference). */
export function vehicleShareUrl(slug: string, site: string | null = siteUrl()): string | null {
  if (!site || !slug) return null;
  return withShareVia(`${site.replace(/\/+$/, '')}/v/${encodeURIComponent(slug)}`);
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
