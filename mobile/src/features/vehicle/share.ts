/**
 * Sharing a build (§3.5): the public page `/v/{slug}` from the API, as its `share_url` with `?via=share` (M5.7). Native opens the system share sheet; the web
 * uses the Web Share API where the browser has one and copies the link otherwise (§12 allowed difference). "Link kopieren"
 * copies on every platform.
 */
import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { shareLink, withShareVia } from '@/features/profile/share';
import { toast } from '@/ui/toast';

type Shareable = Pick<PublicVehicle, 'canonical_url' | 'full_title'> & { share_url?: string | null };

/** M5.7 (m5.7-contract §2.4): the share sheet and "Link kopieren" use `share_url` (`?via=share`), the page keeps the plain canonical. */
export function shareUrlOf(vehicle: Shareable): string {
  return vehicle.share_url || withShareVia(vehicle.canonical_url);
}

export function useVehicleShare(routeId: string) {
  const { t } = useTranslation('vehicle');
  const [sharing, setSharing] = useState(false);
  const testID = `${routeId}.toast`;

  const share = useCallback(
    async (vehicle: Shareable) => {
      setSharing(true);
      try {
        const url = shareUrlOf(vehicle);
        const outcome = await shareLink({ url, title: vehicle.full_title });
        if (outcome === 'copied') toast(t('share.copied'), { testID });
        if (outcome === 'failed') toast(t('share.failed', { url }), { testID });
      } finally {
        setSharing(false);
      }
    },
    [t, testID],
  );

  const copy = useCallback(
    async (vehicle: Shareable) => {
      const url = shareUrlOf(vehicle);
      try {
        await Clipboard.setStringAsync(url);
        toast(t('share.copied'), { testID });
      } catch {
        toast(t('share.copyFailed', { url }), { testID });
      }
    },
    [t, testID],
  );

  return { share, copy, sharing };
}
