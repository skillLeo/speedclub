/**
 * The Journey card on the member web (contract §5, spike §4): react-native-view-shot needs html2canvas-pro on the web, which the app
 * does not ship, so the web never draws the card itself. It downloads the server-drawn share image instead
 * (`GET vehicles/{id}/share-card.png?format=story|square`, VEH-07's pipeline, which lane B extends with the gauge and the stage).
 */
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';

import { api } from '@/api/client';
import { shareCardFileName, type ShareCardFormat } from '@/api/queries/signature';
import { saveBlob } from '@/features/qr/download';

export const canCaptureJourney = false;

export type JourneyShareOutcome = 'shared' | 'saved' | 'failed';

export async function shareJourneyCard(_card: RefObject<ComponentRef<typeof View> | null>, _title: string): Promise<JourneyShareOutcome> {
  return 'failed';
}

/** Saves the server's card of this vehicle in one format; `failed` when the server has none (404) or the network is down. */
export async function downloadJourneyCard(vehicleId: string, format: ShareCardFormat): Promise<JourneyShareOutcome> {
  try {
    const result = await api.GET('/vehicles/{id}/share-card.png', { params: { path: { id: vehicleId }, query: { format } }, parseAs: 'blob' });
    if (!result.response.ok || !(result.data instanceof Blob)) return 'failed';
    saveBlob(result.data, shareCardFileName(vehicleId, format));
    return 'saved';
  } catch {
    return 'failed';
  }
}
