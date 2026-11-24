/**
 * WRP-01 "Teilen" on the phone (contract §5/§6, spike §4, ADR-508): the card as it stands on screen, drawn by react-native-view-shot
 * into a 1080 × 1920 PNG, handed to the share sheet, then released. Android takes pixels; iOS takes points and draws at the device
 * scale, so it gets the size divided by the pixel ratio (spike §4; verify on the first iOS build). Native only: on the web the
 * package needs html2canvas-pro, which the app does not ship, so share.ts downloads the server's card there.
 */
import * as Sharing from 'expo-sharing';
import type { ComponentRef, RefObject } from 'react';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { STORY_EXPORT } from './model';

/** The phone draws the card itself; the web takes the server's image. */
export const wrappedExportMode: 'capture' | 'server' = 'capture';

export type WrappedExportOutcome = 'shared' | 'saved' | 'failed';

export type WrappedExportRequest = {
  card: RefObject<ComponentRef<typeof View> | null>;
  seasonKey: string;
  /** The card's 1-based position in the payload (the server image's name; unused here). */
  n: number;
  /** The share sheet's title. */
  title: string;
};

/** The capture size per platform: pixels on Android, points on iOS. */
export function captureSize(os: string = Platform.OS, ratio: number = PixelRatio.get()): { width: number; height: number } {
  if (os === 'ios') return { width: STORY_EXPORT.width / ratio, height: STORY_EXPORT.height / ratio };
  return { width: STORY_EXPORT.width, height: STORY_EXPORT.height };
}

export async function exportWrappedCard({ card, title }: WrappedExportRequest): Promise<WrappedExportOutcome> {
  if (!card.current) return 'failed';
  let uri: string | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    uri = await captureRef(card, { format: 'png', result: 'tmpfile', ...captureSize() });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
    return 'shared';
  } catch {
    return 'failed';
  } finally {
    if (uri) releaseCapture(uri);
  }
}
