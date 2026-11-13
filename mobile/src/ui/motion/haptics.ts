import { useSyncExternalStore } from 'react';

import { hapticFor, haptics, hapticsEnabled, setHapticsEnabled, subscribeHaptics, type HapticKind } from '@/lib/haptics';
import type { HapticIntent } from '@/theme/tokens.generated';

/**
 * The motion kit's door to the haptics service (09 §4.8, `src/lib/haptics.ts`): one haptic per intent from the map in tokens,
 * a no-op on web, silent while the user setting "Haptisches Feedback" (SET-10, default on) is off.
 *
 * A gesture worklet never calls these directly: it hands the intent to the JS thread once (`scheduleOnRN(hapticFor, …)`), at
 * the moment the threshold is crossed, never per frame.
 */
export { hapticFor, haptics };
export type { HapticIntent, HapticKind };

const getEnabled = () => hapticsEnabled();

/**
 * The SET-10 switch "Haptisches Feedback", live: `[enabled, setEnabled]`. Setting it stores the choice on the device (native
 * only; web has no haptics), and every component reading it updates.
 */
export function useHapticsSetting(): readonly [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeHaptics, getEnabled, getEnabled);
  return [enabled, setHapticsEnabled] as const;
}
