/**
 * A public page in the system's in-app browser on native, SFSafariViewController or a Chrome Custom Tab, without the app shipping a
 * web view (ADR, M1.7). QR-04 passes `guestViewUrl`, so the member sees exactly what a stranger gets (WEB-01); the web uses a plain
 * link instead.
 */
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import type { AppTheme } from '@/theme';

export async function openPublicPage(url: string, theme: Pick<AppTheme, 'color'>): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      controlsColor: theme.color.text.primary,
      toolbarColor: theme.color.bg.canvas,
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
    });
    return true;
  } catch {
    // No browser that can be embedded, for example a device without Chrome: the default browser still opens it.
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}
