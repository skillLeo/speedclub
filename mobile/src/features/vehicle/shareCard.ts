/**
 * VEH-07 [SIG `sig.share_cards`] (02_PRODUCT_SPEC §5): the server-drawn PNG of a build, 9:16 for stories and 1:1 for posts.
 * Native downloads it into the cache and hands the file to the share sheet. The web shares the file with the Web Share API
 * level 2 where the browser can (`navigator.canShare({ files })`), and otherwise saves it, which "Speichern" always does
 * (03_DESIGN_SYSTEM §12 allowed difference). R5-2e: "Speichern" natively puts the same PNG into the photo library (expo-media-library,
 * add-only permission, asked on first use).
 */
import { File as CacheFile, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
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
  // A card drawn just now carries its bytes: the CSP refuses a fetch of a blob: URL.
  if (card.blob) return card.blob;
  let response: Response;
  try {
    // The stored card is a public, immutable file of this origin.
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

/** The card as a file on the device: a card drawn just now already is one; the stored card is downloaded into the cache. */
async function localCardUri(card: ShareCard): Promise<string> {
  if (!card.remote) return card.url;
  try {
    return (await CacheFile.downloadFileAsync(card.url, new CacheFile(Paths.cache, card.fileName), { idempotent: true })).uri;
  } catch {
    throw networkError();
  }
}

/** Why a native "Speichern" did not save: the photo library permission was refused, or anything else went wrong. */
export class CardSaveError extends Error {
  readonly reason: 'denied' | 'failed';

  constructor(reason: 'denied' | 'failed') {
    super(reason);
    this.name = 'CardSaveError';
    this.reason = reason;
  }
}

/**
 * Native "Speichern": the PNG into the photo library. SDK 58's `saveToLibraryAsync` is a stub that throws (legacyWarnings); its
 * successor is `Asset.create`, which needs the write-only ("add photos") permission alone. Asked on first use; once refused for
 * good the member is sent to the settings by the toast.
 */
async function saveCardNative(card: ShareCard): Promise<ShareCardOutcome> {
  const uri = await localCardUri(card);
  let permission: MediaLibrary.PermissionResponse;
  try {
    permission = await MediaLibrary.getPermissionsAsync(true);
    if (!permission.granted && permission.canAskAgain) permission = await MediaLibrary.requestPermissionsAsync(true);
  } catch {
    throw new CardSaveError('failed');
  }
  if (!permission.granted) throw new CardSaveError('denied');
  try {
    await MediaLibrary.Asset.create(uri);
  } catch {
    throw new CardSaveError('failed');
  }
  return 'saved';
}

/** "Speichern": a download on the web, the photo library natively. */
export function saveCard(card: ShareCard): Promise<ShareCardOutcome> {
  return isWeb ? saveCardOnWeb(card) : saveCardNative(card);
}

async function shareCardNative(card: ShareCard, title: string): Promise<ShareCardOutcome> {
  const uri = await localCardUri(card);
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
