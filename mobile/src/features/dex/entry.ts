import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useRequireAuth } from '@/state/session';
import type { HeaderAction } from '@/ui/Header';

import { SCAN_ROUTE } from './navigation';

/**
 * The SCAN button of the Start (HOME-01) and Garage (GAR-01) headers (10 §16.2, contract §8): Phosphor `scan`, "Sticker scannen".
 * A guest is asked to sign in first and comes back to the scanner.
 */
export function useScanAction(routeId: string): HeaderAction {
  const { t } = useTranslation('dex');
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  return {
    icon: 'scan',
    label: t('entry.scan'),
    onPress: () => {
      if (!requireAuth(() => router.push(SCAN_ROUTE), { returnTo: pathname })) return;
    },
    testID: `${routeId}.scan`,
  };
}
