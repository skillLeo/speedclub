/**
 * The Scan-Test's on-device step (10 §2.3, m5.4-contract §4). The server renders the design exactly as the print files and decodes the
 * whole sticker with chillerlan/php-qrcode; its verdict decides (`scan_test`). The app may add its own decode of the rendered bitmap
 * for an instant answer and reports it as `client_scan_test`, which the server stores as information only.
 *
 * This build has no QR decoder for a rendered bitmap: ADR-508 decided against jsQR/zxing in the app because the server decodes the
 * print raster itself. So the device step reports `unavailable`, and the seam stays here: a decoder added later (lead approval for the
 * package) only replaces `decodeRenderedSticker`, nothing else in the designer changes.
 */
import type { StickerClientScanTest } from '@/api/queries/stickers';

export type DeviceDecoder = (svg: string, expectedCode: string | null) => Promise<StickerClientScanTest>;

export const decodeRenderedSticker: DeviceDecoder = async () => 'unavailable';

/** Never lets the device step hold up or break the server test: any failure of the decoder is "unavailable". */
export async function deviceScanTest(
  svg: string | null,
  expectedCode: string | null,
  decoder: DeviceDecoder = decodeRenderedSticker,
): Promise<StickerClientScanTest> {
  if (!svg) return 'unavailable';
  try {
    return await decoder(svg, expectedCode);
  } catch {
    return 'unavailable';
  }
}
