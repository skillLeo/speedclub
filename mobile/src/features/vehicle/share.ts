/**
 * Sharing a build (§3.5): the canonical public page `/v/{slug}` from the API. Native opens the system share sheet; the web
 * uses the Web Share API where the browser has one and copies the link otherwise (§12 allowed difference). "Link kopieren"
 * copies on every platform.
 */
import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { shareLink } from '@/features/profile/share';
import { toast } from '@/ui';

type Shareable = Pick<PublicVehicle, 'canonical_url' | 'full_title'>;

export function useVehicleShare(routeId: string) {
  const { t } = useTranslation('vehicle');
  const [sharing, setSharing] = useState(false);
  const testID = `${routeId}.toast`;

  const share = useCallback(
    async (vehicle: Shareable) => {
      setSharing(true);
      try {
        const outcome = await shareLink({ url: vehicle.canonical_url, title: vehicle.full_title });
        if (outcome === 'copied') toast(t('share.copied'), { testID });
        if (outcome === 'failed') toast(t('share.failed', { url: vehicle.canonical_url }), { testID });
      } finally {
        setSharing(false);
      }
    },
    [t, testID],
  );

  const copy = useCallback(
    async (vehicle: Shareable) => {
      try {
        await Clipboard.setStringAsync(vehicle.canonical_url);
        toast(t('share.copied'), { testID });
      } catch {
        toast(t('share.copyFailed', { url: vehicle.canonical_url }), { testID });
      }
    },
    [t, testID],
  );

  return { share, copy, sharing };
}
