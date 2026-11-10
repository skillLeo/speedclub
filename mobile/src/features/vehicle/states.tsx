/**
 * The global route contract (§8) for the vehicle routes: loading, ready, unavailable (every hidden vehicle, ADR-141),
 * not found (a mod or entry of a visible vehicle), error with retry, offline without a copy. Offline with a copy is
 * `ready`, under the shell's offline banner; a 404 never is, even with a copy.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isEntryNotFound, isVehicleUnavailable } from '@/api/queries/vehicles';
import { useQaState, type QaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { EmptyState, ErrorState } from '@/ui';

export type RouteState = 'loading' | 'ready' | 'unavailable' | 'notFound' | 'error' | 'offline';

type QueryLike = {
  data: unknown;
  error: unknown;
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
};

export function routeStateOf(query: QueryLike, online: boolean, qaState: QaState): RouteState {
  if (qaState === 'loading') return 'loading';
  if (qaState === 'error') return 'error';
  // A public page has no account limit of its own: what the register calls restricted is the content, so the matrix
  // shows the one calm state every hidden vehicle gets.
  if (qaState === 'restricted') return 'unavailable';
  // A 404 is the server's word and wins over a copy: TanStack keeps the earlier data when a refetch fails, so a vehicle
  // that went private, was deleted or blocked would otherwise stay visible to everyone who opened it before (ADR-141, 148).
  if (isVehicleUnavailable(query.error)) return 'unavailable';
  if (isEntryNotFound(query.error)) return 'notFound';
  // A dropped connection or a server in trouble says nothing about the vehicle: the copy stays, under the offline banner.
  if (query.data !== undefined) return 'ready';
  if (query.error) return online ? 'error' : 'offline';
  // A request waiting for the network is paused, not loading: without a copy that is the offline state.
  if (query.fetchStatus === 'paused') return 'offline';
  return 'loading';
}

export function useRouteState(query: QueryLike): RouteState {
  const online = useOnline();
  const qaState = useQaState();
  return routeStateOf(query, online, qaState);
}

export type RouteStateBodyProps = {
  state: Exclude<RouteState, 'loading' | 'ready'>;
  routeId: string;
  onRetry: () => void;
  retrying: boolean;
  /** Not found: what is missing, and the way back to its vehicle. */
  notFound?: { title: string; body: string; actionLabel: string; onAction: () => void };
};

export function RouteStateBody({ state, routeId, onRetry, retrying, notFound }: RouteStateBodyProps) {
  const { t } = useTranslation('vehicle');
  const router = useRouter();
  if (state === 'unavailable') {
    return (
      <EmptyState
        icon="wheel"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{ label: t('unavailable.discover'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${routeId}.unavailable`}
      />
    );
  }
  if (state === 'notFound' && notFound) {
    return (
      <EmptyState
        icon="wrench"
        title={notFound.title}
        body={notFound.body}
        action={{ label: notFound.actionLabel, onPress: notFound.onAction, variant: 'secondary', size: 'm' }}
        testID={`${routeId}.notFound`}
      />
    );
  }
  if (state === 'offline') {
    return (
      <ErrorState
        title={t('error.offlineTitle')}
        message={t('error.offlineBody')}
        onRetry={onRetry}
        retrying={retrying}
        testID={`${routeId}.offline`}
      />
    );
  }
  return <ErrorState title={t('error.title')} onRetry={onRetry} retrying={retrying} testID={`${routeId}.error`} />;
}
