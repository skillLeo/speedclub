import { Stack } from 'expo-router';

import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';

/**
 * GAR-03: the four wizard steps push inside one modal. A draft resumed at a later step ("Fortsetzen", pushed with
 * `withAnchor`) or opened from a link keeps step 1 below it, so back leads into the wizard rather than out of it.
 */
export const unstable_settings = { anchor: 'vehicle' };

export default function Layout() {
  const screenOptions = useCanvasStackOptions();
  return <Stack screenOptions={screenOptions} />;
}
