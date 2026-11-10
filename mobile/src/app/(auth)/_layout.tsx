import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';
import { abandonAuthIntent } from '@/state/session';

/** The steps a member has to finish cannot be swiped away (F1). Their back goes through the session routing. */
const NO_GESTURE = { gestureEnabled: false } as const;

/** AUTH-02 to AUTH-10: a stack of its own, outside the tabs, so it has no tab bar. */
export default function Layout() {
  const screenOptions = useCanvasStackOptions();
  // Leaving the stack without signing in ends what the guest set out to do, or a much later sign-in would run it.
  useEffect(() => abandonAuthIntent, []);
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="username" options={NO_GESTURE} />
      <Stack.Screen name="profile-setup" options={NO_GESTURE} />
      <Stack.Screen name="notifications-primer" options={NO_GESTURE} />
    </Stack>
  );
}
