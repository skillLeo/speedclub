/**
 * QR downloads (QR-02, 02_PRODUCT_SPEC §3.4): PNG 1024 and 2048, SVG and the A6 PDF sticker, rendered by the server so they
 * are identical everywhere. Native downloads into the cache with the Bearer token and hands the file to the share sheet;
 * the web fetches with the session cookie and saves through an object URL. Both report progress when the size is known.
 */
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { api, apiOrigin, ApiError, networkError, toApiError } from '@/api/client';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';
import { getSecure } from '@/lib/secure';

export type QrFormat = 'png' | 'png2048' | 'svg' | 'pdf' | 'placardA5' | 'placardA4';

/** The order of the format sheet. */
export const QR_FORMATS: readonly QrFormat[] = ['png', 'png2048', 'svg', 'pdf'];

/** [SIG `sig.placard_pdf`]: the car-show build sheet, after the sticker formats (FS-9): `placard.pdf?size=a5|a4`, owner only. */
export const PLACARD_FORMATS: readonly QrFormat[] = ['placardA5', 'placardA4'];
export const PLACARD_FLAG = 'sig.placard_pdf';


export function sheetFormats(placard: boolean): readonly QrFormat[] {
  return placard ? [...QR_FORMATS, ...PLACARD_FORMATS] : QR_FORMATS;
}

export function isPlacard(format: QrFormat): boolean {
  return format === 'placardA5' || format === 'placardA4';
}

type FormatFile = {
  extension: 'png' | 'svg' | 'pdf';
  mimeType: string;
  /** iOS share sheet type. */
  uti: string;
  /** The PNG size or the placard's paper the server renders; null for the other formats. */
  size: '1024' | '2048' | 'a5' | 'a4' | null;
  /** Added to the file name, so both PNG sizes can sit side by side. */
  suffix: string;
};

export const FORMAT_FILES: Readonly<Record<QrFormat, FormatFile>> = {
  png: { extension: 'png', mimeType: 'image/png', uti: 'public.png', size: '1024', suffix: '' },
  png2048: { extension: 'png', mimeType: 'image/png', uti: 'public.png', size: '2048', suffix: '-2048' },
  svg: { extension: 'svg', mimeType: 'image/svg+xml', uti: 'public.svg-image', size: null, suffix: '' },
  pdf: { extension: 'pdf', mimeType: 'application/pdf', uti: 'com.adobe.pdf', size: null, suffix: '' },
  placardA5: { extension: 'pdf', mimeType: 'application/pdf', uti: 'com.adobe.pdf', size: 'a5', suffix: '-a5' },
  placardA4: { extension: 'pdf', mimeType: 'application/pdf', uti: 'com.adobe.pdf', size: 'a4', suffix: '-a4' },
};

/** "speedclub-qr-8TR0Q3MC.png", the name the server gives in Content-Disposition. */
export function qrFileName(code: string, format: QrFormat): string {
  const file = FORMAT_FILES[format];
  // The server's attachment name: speedclub-placard-a5-8TR0Q3MC.pdf.
  if (isPlacard(format)) return `speedclub-placard-${file.size}-${code}.${file.extension}`;
  return `speedclub-qr-${code}${file.suffix}.${file.extension}`;
}

/** The API path under /api/v1, for the web client and for the native download alike. */
export function qrDownloadPath(vehicleId: string, format: QrFormat): string {
  const file = FORMAT_FILES[format];
  const query = file.size ? `?size=${file.size}` : '';
  const name = isPlacard(format) ? 'placard' : 'qr';
  return `/vehicles/${encodeURIComponent(vehicleId)}/${name}.${file.extension}${query}`;
}

export function qrDownloadUrl(vehicleId: string, format: QrFormat, origin: string = apiOrigin()): string {
  return `${origin}/api/v1${qrDownloadPath(vehicleId, format)}`;
}

/** 0 to 1, or null while the size is unknown. */
export type DownloadProgress = (fraction: number | null) => void;

export type QrDownloadRequest = {
  vehicleId: string;
  code: string;
  format: QrFormat;
  onProgress?: DownloadProgress;
  signal?: AbortSignal;
  /** The share sheet's title on Android. */
  dialogTitle?: string;
};

/** `shared`: native handed the file over. `saved`: the browser received it. */
export type QrDownloadOutcome = { kind: 'shared' | 'saved'; fileName: string };

function fraction(written: number, total: number): number | null {
  return total > 0 ? Math.min(1, Math.max(0, written / total)) : null;
}

// -- Native

/** expo-file-system rejects a non-2xx answer with "response has status: 404" (Android) or "... status 404" (iOS). */
export function statusFromNativeError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /(?:status:?|HTTP)\s*(\d{3})\b/i.exec(message);
  return match ? Number(match[1]) : null;
}

export function nativeDownloadError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const status = statusFromNativeError(error);
  return status === null ? networkError() : toApiError({ status, headers: new Headers() }, null);
}

/** Accept, language and the Bearer token, for a file download outside the API client. */
export async function nativeHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': i18n.language };
  try {
    const token = await getSecure('sc.authToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    console.warn('Could not read the auth token');
  }
  return headers;
}

async function downloadNative(request: QrDownloadRequest): Promise<QrDownloadOutcome> {
  const { vehicleId, code, format, onProgress, signal, dialogTitle } = request;
  const file = FORMAT_FILES[format];
  const fileName = qrFileName(code, format);
  let uri: string;
  try {
    const target = new File(Paths.cache, fileName);
    const downloaded = await File.downloadFileAsync(qrDownloadUrl(vehicleId, format), target, {
      headers: await nativeHeaders(),
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(fraction(bytesWritten, totalBytes)),
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

// -- Web

/** Reads a body to the end, reporting progress against Content-Length. */
export async function readWithProgress(
  body: ReadableStream<Uint8Array> | null | undefined,
  total: number,
  mimeType: string,
  onProgress?: DownloadProgress,
): Promise<Blob> {
  if (!body) return new Blob([], { type: mimeType });
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let written = 0;
  onProgress?.(fraction(0, total));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      written += value.byteLength;
      onProgress?.(fraction(written, total));
    }
  }
  return new Blob(chunks as BlobPart[], { type: mimeType });
}

/** Long enough for every browser to have taken the file, short enough not to hold it for the session. */
export const OBJECT_URL_LIFETIME_MS = 60 * 1000;

/** Hands a blob to the browser's download, through a link the page never shows. */
export function saveBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const href = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), OBJECT_URL_LIFETIME_MS);
}

function webRequest(vehicleId: string, format: QrFormat, signal?: AbortSignal) {
  const path = { vehicle: vehicleId };
  if (format === 'placardA5' || format === 'placardA4') {
    const paper = format === 'placardA4' ? 'a4' : 'a5';
    return api.GET('/vehicles/{vehicle}/placard.pdf', { params: { path, query: { size: paper } }, parseAs: 'stream', signal });
  }
  const size = FORMAT_FILES[format].size === '2048' ? '2048' : '1024';
  if (format === 'svg') return api.GET('/vehicles/{vehicle}/qr.svg', { params: { path }, parseAs: 'stream', signal });
  if (format === 'pdf') return api.GET('/vehicles/{vehicle}/qr.pdf', { params: { path }, parseAs: 'stream', signal });
  return api.GET('/vehicles/{vehicle}/qr.png', { params: { path, query: { size } }, parseAs: 'stream', signal });
}

async function downloadWeb(request: QrDownloadRequest): Promise<QrDownloadOutcome> {
  const { vehicleId, code, format, onProgress, signal } = request;
  const file = FORMAT_FILES[format];
  let result: Awaited<ReturnType<typeof webRequest>>;
  try {
    result = await webRequest(vehicleId, format, signal);
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
  const fileName = qrFileName(code, format);
  saveBlob(blob, fileName);
  return { kind: 'saved', fileName };
}

/** One download, start to hand-over. Every failure is an ApiError, except a cancel, which stays an AbortError. */
export function downloadQr(request: QrDownloadRequest): Promise<QrDownloadOutcome> {
  return isWeb ? downloadWeb(request) : downloadNative(request);
}
