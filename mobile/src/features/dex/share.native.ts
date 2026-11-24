/**
 * DEX-03 "Karte teilen" on the phone (spike §4, ADR-508): the card as it stands on screen, drawn by react-native-view-shot into a
 * temporary PNG, handed to the share sheet, then released. Native only: on the web the package needs html2canvas-pro, which the
 * app does not ship, so share.ts answers there (no share action on the web in part 1, there is no server image of a spot yet).
 */
import * as Sharing from 'expo-sharing';
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

export const canShareSpotCard = true;

export type ShareSpotOutcome = 'shared' | 'failed';

export async function shareSpotCard(card: RefObject<ComponentRef<typeof View> | null>, title: string): Promise<ShareSpotOutcome> {
  if (!card.current) return 'failed';
  let uri: string | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    uri = await captureRef(card, { format: 'png', result: 'tmpfile' });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
    return 'shared';
  } catch {
    return 'failed';
  } finally {
    if (uri) releaseCapture(uri);
  }
}
