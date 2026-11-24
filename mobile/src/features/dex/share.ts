/**
 * DEX-03 sharing on the member web: none in part 1. react-native-view-shot needs html2canvas-pro on the web (not shipped, spike §4),
 * and the server has no share image of a spot yet; once it has, the web shares that PNG like VEH-07 does.
 */
import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';

export const canShareSpotCard = false;

export type ShareSpotOutcome = 'shared' | 'failed';

export async function shareSpotCard(_card: RefObject<ComponentRef<typeof View> | null>, _title: string): Promise<ShareSpotOutcome> {
  return 'failed';
}
