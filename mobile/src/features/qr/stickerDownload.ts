/**
 * Sticker files (10 §2.3 "Export", m5.4-contract §3 #11/#12, §6): the print PDF (exact size, 3 mm bleed, crop marks, design id in the
 * slug), the print SVG (one group per ink, die line) and the PNG to share (its code leads to the public page, ADR-514). The server
 * draws them, so the file is the same everywhere. Native: into the cache with the Bearer token, then the share sheet. Web: with the
 * session cookie, saved through an object URL. Same plumbing as the QR downloads (download.ts).
 */
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { api, apiOrigin, ApiError, networkError, toApiError } from '@/api/client';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';

import { nativeDownloadError, nativeHeaders, readWithProgress, saveBlob, type DownloadProgress } from './download';

export type StickerFileFormat = 'pdf' | 'svg' | 'share';

/** The order of the download sheet: what a print shop needs first. */
export const STICKER_FORMATS: readonly StickerFileFormat[] = ['pdf', 'svg', 'share'];

const FILES: Readonly<Record<StickerFileFormat, { extension: 'pdf' | 'svg' | 'png'; mimeType: string; uti: string; path: string }>> = {
  pdf: { extension: 'pdf', mimeType: 'application/pdf', uti: 'com.adobe.pdf', path: 'print.pdf' },
  svg: { extension: 'svg', mimeType: 'image/svg+xml', uti: 'public.svg-image', path: 'print.svg' },
  share: { extension: 'png', mimeType: 'image/png', uti: 'public.png', path: 'share.png' },
};

export type StickerFileTarget = { designId: string; reference: string; version: number };

/** "speedclub-sticker-SD7H2KQXMB-v3.pdf"; the picture to share has no version, it is not a print file. */
export function stickerFileName(target: StickerFileTarget, format: StickerFileFormat): string {
  const file = FILES[format];
  return format === 'share'
    ? `speedclub-sticker-${target.reference}.${file.extension}`
    : `speedclub-sticker-${target.reference}-v${target.version}.${file.extension}`;
}

export function stickerFileUrl(designId: string, format: StickerFileFormat, origin: string = apiOrigin()): string {
  return `${origin}/api/v1/sticker-designs/${encodeURIComponent(designId)}/${FILES[format].path}`;
}

export type StickerDownloadOutcome = { kind: 'shared' | 'saved'; fileName: string };

async function downloadNative(
  target: StickerFileTarget,
  format: StickerFileFormat,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
  dialogTitle?: string,
): Promise<StickerDownloadOutcome> {
  const file = FILES[format];
  const fileName = stickerFileName(target, format);
  let uri: string;
  try {
    const downloaded = await File.downloadFileAsync(stickerFileUrl(target.designId, format), new File(Paths.cache, fileName), {
      headers: await nativeHeaders(),
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null),
    });
    uri = downloaded.uri;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw nativeDownloadError(error);
  }
  onProgress?.(1);
  const unavailable = () =>
    new ApiError({ kind: 'server', status: 0, code: 'sharing_unavailable', message: i18n.t('qr:download.noShare') });
  if (!(await Sharing.isAvailableAsync().catch(() => false))) throw unavailable();
  try {
    await Sharing.shareAsync(uri, { mimeType: file.mimeType, UTI: file.uti, dialogTitle });
  } catch {
    throw unavailable();
  }
  return { kind: 'shared', fileName };
}

function webRequest(designId: string, format: StickerFileFormat, signal?: AbortSignal) {
  const params = { path: { design: designId } };
  if (format === 'pdf') return api.GET('/sticker-designs/{design}/print.pdf', { params, parseAs: 'stream', signal });
  if (format === 'svg') return api.GET('/sticker-designs/{design}/print.svg', { params, parseAs: 'stream', signal });
  return api.GET('/sticker-designs/{design}/share.png', { params, parseAs: 'stream', signal });
}

async function downloadWeb(
  target: StickerFileTarget,
  format: StickerFileFormat,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
): Promise<StickerDownloadOutcome> {
  const file = FILES[format];
  let result: Awaited<ReturnType<typeof webRequest>>;
  try {
    result = await webRequest(target.designId, format, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw networkError();
  }
  if (!result.response.ok) throw toApiError(result.response, result.error);
  const total = Number(result.response.headers.get('Content-Length') ?? 0) || 0;
  let blob: Blob;
  try {
    blob = await readWithProgress(result.data as ReadableStream<Uint8Array> | null, total, file.mimeType, onProgress);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw networkError();
  }
  onProgress?.(1);
  const fileName = stickerFileName(target, format);
  saveBlob(blob, fileName);
  return { kind: 'saved', fileName };
}

/**
 * One file, start to hand-over. Every failure is an ApiError (409 `sticker_not_validated` / `sticker_code_replaced` included), a
 * cancel stays an AbortError.
 */
export function downloadStickerFile(
  target: StickerFileTarget,
  format: StickerFileFormat,
  options: { onProgress?: DownloadProgress; signal?: AbortSignal; dialogTitle?: string } = {},
): Promise<StickerDownloadOutcome> {
  return isWeb
    ? downloadWeb(target, format, options.onProgress, options.signal)
    : downloadNative(target, format, options.onProgress, options.signal, options.dialogTitle);
}
