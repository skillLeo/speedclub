/**
 * The Journey card on the phone (contract §5, spike §4, ADR-508): the card as it stands in the sheet, drawn by
 * react-native-view-shot into a temporary PNG, handed to the share sheet, then released. Native only (see journeyShare.ts for the
 * web, which downloads the server's card).
 */
import * as Sharing from 'expo-sharing';
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import type { ShareCardFormat } from '@/api/queries/signature';

export const canCaptureJourney = true;

export type JourneyShareOutcome = 'shared' | 'saved' | 'failed';

export async function shareJourneyCard(card: RefObject<ComponentRef<typeof View> | null>, title: string): Promise<JourneyShareOutcome> {
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

/** Not used on the phone, which shares the card it draws; kept so both files have one shape. */
export async function downloadJourneyCard(_vehicleId: string, _format: ShareCardFormat): Promise<JourneyShareOutcome> {
  return 'failed';
}
