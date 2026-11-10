import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/features/shell/RouteErrorBoundary';
import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';
import { webStackScreenLayout } from '@/features/shell/WebStackTransition';
import { isWeb } from '@/lib/platform';

/**
 * The only layout of the five tab groups (04_SCREEN_REGISTER.md §2). Array syntax clones this
 * directory per group, so /v/[slug] opens inside whichever tab pushed it.
 */
export const unstable_settings = {
  anchor: 'index',
  home: { anchor: 'index' },
  discover: { anchor: 'discover/index' },
  garage: { anchor: 'garage/index' },
  messages: { anchor: 'messages/index' },
  profile: { anchor: 'profile/index' },
};

export default function TabStackLayout() {
  const screenOptions = useCanvasStackOptions();
  return (
    <RouteErrorBoundary>
      <Stack screenOptions={screenOptions} screenLayout={isWeb ? webStackScreenLayout : undefined} />
    </RouteErrorBoundary>
  );
}
