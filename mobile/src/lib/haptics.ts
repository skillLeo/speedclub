import * as Haptics from 'expo-haptics';

import { isWeb } from './platform';

let enabled = true;

export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

function play(effect: () => Promise<void>): void {
  if (isWeb || !enabled) return;
  // A device without a haptic engine rejects; that must never surface as an error.
  effect().catch(() => undefined);
}

export const haptics = {
  selection: () => play(() => Haptics.selectionAsync()),
  light: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
