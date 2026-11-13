import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useRequireAuth } from '@/state/session';

/** "Zur Garage": where a member enters a part on a mod; a guest gets the auth-required sheet first and lands there after. */
export function useGarageEntry(): () => void {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  return useCallback(() => {
    if (requireAuth(undefined, { returnTo: '/garage' })) router.navigate('/garage');
  }, [requireAuth, router]);
}
