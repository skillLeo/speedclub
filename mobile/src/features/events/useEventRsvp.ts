import '@/features/events/i18n';

import { usePathname } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { isClosed, useRsvp, type EventCard, type EventDetail, type RsvpAnswer } from '@/api/queries/events';
import { haptics } from '@/lib/haptics';
import { useRequireAuth } from '@/state/session';
import { toast } from '@/ui';

type Answerable = Pick<EventDetail, 'id' | 'slug' | 'my_rsvp' | 'counts' | 'spots_left'>;

/**
 * "Zusagen" / "Interessiert" / "Absagen" with the auth sheet for guests, one haptic per intent (09 §4.8: success on going, light on
 * interested, selection on withdraw) and a toast that says what the server decided (going, or the waitlist when full).
 */
export function useEventRsvp(routeId: string) {
  const { t } = useTranslation('events');
  const requireAuth = useRequireAuth();
  const pathname = usePathname();
  const rsvp = useRsvp();

  const answer = useCallback(
    (event: Answerable | EventCard, status: RsvpAnswer | null) => {
      requireAuth(
        () => {
          rsvp.mutate(
            { event, status },
            {
              onSuccess: (state) => {
                if (status === 'going') {
                  haptics.success();
                  toast(state.status === 'waitlist' ? t('rsvp.waitlistToast') : t('rsvp.goingToast'), {
                    testID: `${routeId}.toast`,
                  });
                } else if (status === 'interested') {
                  haptics.light();
                  toast(t('rsvp.interestedToast'), { testID: `${routeId}.toast` });
                } else {
                  haptics.selection();
                  toast(t('rsvp.withdrawnToast'), { testID: `${routeId}.toast` });
                }
              },
              onError: (error) => {
                haptics.error();
                const message = isClosed(error)
                  ? t('rsvp.closed')
                  : error instanceof ApiError && error.kind === 'forbidden' && error.message
                    ? error.message
                    : t('rsvp.failed');
                toast(message, { testID: `${routeId}.toast` });
              },
            },
          );
        },
        { returnTo: pathname },
      );
    },
    [pathname, requireAuth, routeId, rsvp, t],
  );

  return {
    answer,
    pending: rsvp.isPending,
    pendingFor: rsvp.isPending ? rsvp.variables?.event.id : undefined,
  };
}
