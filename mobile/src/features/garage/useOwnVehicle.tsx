import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCachedCard, useReadVehicleOnOpen, useVehicle, type GarageVehicle } from '@/api/queries/garage';
import type { VehicleCardData } from '@/api/queries/profile';
import { useHeldForm } from '@/features/auth/heldForm';
import { paramOf } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';

import { CentredState, EditorLoading, GoneState, LoadErrorState, SignInState, useGarageAccess } from './components/frames';
import { isGone } from './errors';

/** What a skeleton can already know: the vehicle when it is cached, or its card from the GAR-01 list. */
export type KnownVehicle = { vehicle: GarageVehicle | undefined; card: VehicleCardData | undefined };

/**
 * The vehicle of a garage editor (GAR-05 to GAR-12) from `[id]`, and the body of every state that is not the form: skeleton
 * after 300 ms, sign-in for a guest, gone, error and offline without a copy. Offline with a copy is the form under the banner.
 * A screen that is not a form draws its own skeleton (`loading`, DQ-207) from what is already known of the vehicle; the
 * forms take the form skeleton with `skeleton` groups.
 *
 * An editor opened as a member keeps its body when the session ends under it, until the member chooses (BH-30). Until then
 * `restriction` says why nothing can be saved, which turns off every screen's CTA.
 */
export function useOwnVehicle(
  routeId: string,
  options: { path: string; skeleton?: readonly number[]; loading?: (known: KnownVehicle) => ReactNode },
) {
  const { t } = useTranslation('garage');
  const authT = useTranslation('auth').t;
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramOf(params.id) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const access = useGarageAccess();
  const query = useVehicle(id);
  const card = useCachedCard(id);
  const held = useHeldForm() && query.data !== undefined;

  // Reads fresh on open, once the persisted cache is restored (BH-10).
  useReadVehicleOnOpen(id);

  let state: ReactNode = null;
  if (access.status === 'guest' && !held) {
    state = (
      <CentredState>
        <SignInState routeId={routeId} returnTo={`/garage/${id}/${options.path}`.replace(/\/$/, '')} />
      </CentredState>
    );
  } else if (qaState === 'loading' || access.status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    state = (
      <EditorLoading routeId={routeId} groups={options.skeleton}>
        {options.loading?.({ vehicle: query.data, card })}
      </EditorLoading>
    );
  } else if (qaState === 'error' || (!query.data && !isGone(query.error))) {
    state = (
      <CentredState>
        <LoadErrorState routeId={routeId} offline={!online || query.fetchStatus === 'paused'} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </CentredState>
    );
  } else if (!query.data) {
    state = (
      <CentredState>
        <GoneState routeId={routeId} title={t('gone.vehicleTitle')} body={t('gone.vehicleBody')} />
      </CentredState>
    );
  }

  return { id, vehicle: query.data, query, state, restriction: held ? authT('session.heldNotice') : access.restriction };
}

/**
 * The session ended under an open form and the member has not chosen yet (BH-30). Nothing can be saved, but the fields keep the
 * member's text in its own colour instead of the disabled grey: what they typed is kept, and it should read that way.
 */
export function useSessionHeld(): boolean {
  return useSessionStore((state) => state.status === 'guest' && state.expiredFrom !== null);
}
