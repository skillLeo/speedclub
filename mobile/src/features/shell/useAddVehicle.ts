import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { isViewAsTab } from '@/api/clientViewAs';
import i18n from '@/i18n';
import { useRequireAuth } from '@/state/session';
import { toast } from '@/ui';

const WIZARD = '/add-vehicle/new/vehicle';

/**
 * Opens the add-vehicle wizard; a guest gets the auth-required sheet first. M1.6 creates the draft and its id. A view-as tab
 * (m3.2-contract §3) is read-only: the toast says why nothing opens, wherever the button sits.
 */
export function useAddVehicle(): () => void {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  return useCallback(() => {
    if (isViewAsTab()) {
      toast(i18n.t('auth:viewAs.readOnly'), { testID: 'VIEWAS.readOnlyToast' });
      return;
    }
    // Navigation goes through returnTo alone: as an action as well, it would open the wizard twice after sign-in.
    if (requireAuth(undefined, { returnTo: WIZARD })) router.push(WIZARD);
  }, [requireAuth, router]);
}
