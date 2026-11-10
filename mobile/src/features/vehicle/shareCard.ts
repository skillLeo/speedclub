/**
 * VEH-07 [SIG `sig.share_cards`] (02_PRODUCT_SPEC §5): the server-drawn PNG of a build, 9:16 for stories and 1:1 for posts.
 * Native downloads it into the cache and hands the file to the share sheet. The web shares the file with the Web Share API
 * level 2 where the browser can (`navigator.canShare({ files })`), and otherwise saves it, which "Speichern" always does
 * (03_DESIGN_SYSTEM §12 allowed difference).
 */
import { File as CacheFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ApiError, networkError } from '@/api/client';
import type { ShareCard, ShareCardFormat } from '@/api/queries/signature';
import { saveBlob } from '@/features/qr/download';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';

export const SHARE_CARD_FLAG = 'sig.share_cards';
export const SHARE_CARD_FORMATS: readonly ShareCardFormat[] = ['story', 'square'];

/** 9:16 and 1:1, the frames of the preview. */
export const SHARE_CARD_RATIO: Readonly<Record<ShareCardFormat, number>> = { story: 9 / 16, square: 1 };

export type ShareCardOutcome = 'shared' | 'saved' | 'cancelled';

function unavailable(): ApiError {
  return new ApiError({ kind: 'server', status: 0, code: 'sharing_unavailable', message: i18n.t('vehicle:shareCard.noShare') });
}

async function cardBlob(card: ShareCard): Promise<Blob> {
  let response: Response;
  try {
    // The stored card is a public, immutable file; a card drawn just now is an object URL of this page.
    response = await globalThis.fetch(card.url);
  } catch {
    throw networkError();
  }
  if (!response.ok) throw new ApiError({ kind: response.status === 404 ? 'not_found' : 'server', status: response.status, code: 'share_card', message: i18n.t('vehicle:shareCard.errorTitle') });
  return response.blob();
}

/** Web: the file to the share sheet when the browser takes files, otherwise a download. */
export async function shareCardOnWeb(card: ShareCard, title: string, nav: Pick<Navigator, 'share' | 'canShare'> = navigator): Promise<ShareCardOutcome> {
  const blob = await cardBlob(card);
  const file = new globalThis.File([blob], card.fileName, { type: 'image/png' });
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlob(blob, card.fileName);
  return 'saved';
}

/** Web "Speichern". */
export async function saveCardOnWeb(card: ShareCard): Promise<ShareCardOutcome> {
  saveBlob(await cardBlob(card), card.fileName);
  return 'saved';
}

async function shareCardNative(card: ShareCard, title: string): Promise<ShareCardOutcome> {
  let uri = card.url;
  // A card drawn just now is already a file in the cache.
  if (card.remote) {
    try {
      const downloaded = await CacheFile.downloadFileAsync(card.url, new CacheFile(Paths.cache, card.fileName), { idempotent: true });
      uri = downloaded.uri;
    } catch {
      throw networkError();
    }
  }
  if (!(await Sharing.isAvailableAsync().catch(() => false))) throw unavailable();
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
  } catch {
    throw unavailable();
  }
  return 'shared';
}

export function shareCard(card: ShareCard, title: string): Promise<ShareCardOutcome> {
  return isWeb ? shareCardOnWeb(card, title) : shareCardNative(card, title);
}
