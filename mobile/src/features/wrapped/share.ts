/**
 * WRP-01 on the member web (contract §5, spike §4): react-native-view-shot needs html2canvas-pro on the web, which the app does
 * not ship, so the web never draws a card itself. It downloads the server-drawn card instead (`GET me/wrapped/{season}/cards/{n}.png`,
 * 1080 × 1920, GD), which carries the same words, numbers and the QR.
 */
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';

import { fetchWrappedCardImage, wrappedCardFileName } from '@/api/queries/wrapped';
import { saveBlob } from '@/features/qr/download';

export const wrappedExportMode: 'capture' | 'server' = 'server';

export type WrappedExportOutcome = 'shared' | 'saved' | 'failed';

export type WrappedExportRequest = {
  card: RefObject<ComponentRef<typeof View> | null>;
  seasonKey: string;
  n: number;
  title: string;
};

/** Saves the server's image of card `n`; `failed` when the server has none (404) or the network is down. */
export async function exportWrappedCard({ seasonKey, n }: WrappedExportRequest): Promise<WrappedExportOutcome> {
  try {
    const blob = await fetchWrappedCardImage(seasonKey, n);
    saveBlob(blob, wrappedCardFileName(seasonKey, n));
    return 'saved';
  } catch {
    return 'failed';
  }
}
