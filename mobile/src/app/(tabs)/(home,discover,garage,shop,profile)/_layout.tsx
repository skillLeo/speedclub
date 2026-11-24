import { Stack } from 'expo-router';

import { DISCOVER_SEGMENT_SCREENS } from '@/features/discover/segments';
import { NativeTabContent } from '@/features/shell/NativeTabContent';
import { RouteErrorBoundary } from '@/features/shell/RouteErrorBoundary';
import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';
import { webStackScreenLayout } from '@/features/shell/WebStackTransition';
import { isWeb } from '@/lib/platform';

/**
 * The only layout of the five tab groups (04_SCREEN_REGISTER.md §2). Array syntax clones this
 * directory per group, so /v/[slug] (and since M5.2 /messages) opens inside whichever tab pushed it.
 */
export const unstable_settings = {
  anchor: 'index',
  home: { anchor: 'index' },
  discover: { anchor: 'discover/index' },
  garage: { anchor: 'garage/index' },
  shop: { anchor: 'shop/index' },
  profile: { anchor: 'profile/index' },
};

/** Expo Router hands every route its template segment: `(discover)` for the Entdecken clone of this layout. */
export default function TabStackLayout({ segment }: { segment?: string }) {
  const screenOptions = useCanvasStackOptions();
  return (
    <RouteErrorBoundary>
      {/* Under native tabs (09 §6.1) the stack measures where the bar starts and carries the e-mail notice; otherwise a plain pass-through. */}
      <NativeTabContent>
        <Stack screenOptions={screenOptions} screenLayout={isWeb ? webStackScreenLayout : undefined}>
          {/* M5.2 (10 §1): in Entdecken the segment pages Builds · Treffen swap in place (fade), they are not pushed. */}
          {segment === '(discover)'
            ? DISCOVER_SEGMENT_SCREENS.map((name) => <Stack.Screen key={name} name={name} options={{ animation: 'fade' }} />)
            : null}
        </Stack>
      </NativeTabContent>
    </RouteErrorBoundary>
  );
}
