import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, type Me } from '@/api/queries/auth';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { ErrorState } from '@/ui';
import { SettingsGuest } from './SettingsGuest';

export type MemberGateInput = {
  routeId: string;
  /** Where a guest returns after signing in. */
  returnTo: string;
  /** The page's own skeleton, in the geometry of its content. */
  skeleton: ReactNode;
};

/**
 * The states every member-only settings page shares: the skeleton while the session or Me loads, the error (offline aware)
 * with retry, an invitation for a guest. `me` is set once the page itself can render; until then `fallback` is the body.
 */
export function useMemberGate({ routeId, returnTo, skeleton }: MemberGateInput): { me: Me | null; fallback: ReactNode } {
  const { t } = useTranslation('settings');
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const reachable = online && me.fetchStatus !== 'paused';

  if (status === 'guest') return { me: null, fallback: <SettingsGuest routeId={routeId} returnTo={returnTo} /> };
  if (qaState === 'loading' || status === 'loading' || (me.isPending && me.fetchStatus !== 'paused' && qaState !== 'error')) {
    return { me: null, fallback: skeleton };
  }
  if (qaState === 'error' || !me.data) {
    return {
      me: null,
      fallback: (
        <ErrorState
          title={reachable ? t('common.loadErrorTitle') : t('common.offlineTitle')}
          message={reachable ? undefined : t('common.offlineBody')}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          testID={`${routeId}.error`}
        />
      ),
    };
  }
  return { me: me.data, fallback: null };
}

/** The gate as a component, for a body that renders inside a page someone else frames (SET-01 desktop). */
export function MemberGate({ children, ...input }: MemberGateInput & { children: (me: Me) => ReactNode }) {
  const gate = useMemberGate(input);
  return gate.me ? children(gate.me) : gate.fallback;
}
