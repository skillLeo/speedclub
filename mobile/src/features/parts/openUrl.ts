import { Linking } from 'react-native';

import { toast } from '@/ui';

/** Opens a phone number, a website or a maps route; a refusal (no app for it) says so in a toast instead of failing silently. */
export async function openUrl(url: string, failed: string, testID: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    toast(failed, { testID });
  }
}
