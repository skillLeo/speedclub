/**
 * SET-22 App-Icon (09 §7.9, §8.11; flag `app_icons`, native only). Changing the launcher icon needs a native module with a config
 * plugin (iOS alternate icons, Android activity aliases), and none is installed in this build: `APP_ICON_MODULE` is null, so the
 * picker shows the current icon (Schwarz, the default) and says the choice is not available yet. The install the lead runs is in
 * the M4.10 report (`npx expo install expo-alternate-app-icons` + its plugin in app.config.ts with the three icon files); once it
 * is in, this file calls its `setAlternateAppIcon` / `getAppIconName` and `supported` turns true.
 */
import type { AppIconKey } from '@/ui';

type AppIconModule = {
  supported: boolean;
  current: () => AppIconKey;
  set: (next: AppIconKey) => Promise<void>;
};

/** No alternate-icon module in this build (see the comment above). */
const APP_ICON_MODULE: AppIconModule | null = null;

export type AppIconState = {
  /** The icon on the home screen now. */
  current: AppIconKey;
  /** This build can change it. */
  supported: boolean;
  set: (next: AppIconKey) => Promise<void>;
};

export function useAppIcon(): AppIconState {
  const module = APP_ICON_MODULE as AppIconModule | null;
  if (!module?.supported) return { current: 'black', supported: false, set: () => Promise.resolve() };
  return { current: module.current(), supported: true, set: module.set };
}
