/**
 * M5.7 Engagement (10 §6.1, §6.2; server contract docs/reports/phase-5/m5.7-contract.md §2–§4): the view beacon, INS-01 "Statistiken"
 * (owner-only sums, never who viewed) and the build goal "Ziel: Saison 2027" through the vehicle PATCH.
 *
 * INS-01 waits for a member session; 4xx answers are answers and never retried (403 `view_as_read_only` for staff in view-as, 403
 * `forbidden`, 404 `feature_disabled` / `not_found`). The headline is written by the server in the reader's language, so the cache key
 * carries the language. The answer is the generated InsightsResource.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData } from '@/api/client';
import { garageKeys, refreshVehicle, type GarageVehicle } from '@/api/queries/garage';
import { retryUnlessAnswered, vehicleKeys, type PublicVehicle } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

/** The app-config flag (contract §1.8): counting, INS-01 and the "100 Aufrufe" badge. */
export const INSIGHTS_FLAG = 'insights';

export type ViewSubject = components['schemas']['ViewSubject'];
export type ViewSource = components['schemas']['ViewSource'];
export type InsightsScope = { kind: 'account' } | { kind: 'vehicle'; vehicleId: string };
export type VehicleRef = components['schemas']['VehicleRefResource'];
export type BuildGoal = NonNullable<PublicVehicle['build_goal']>;

/** InsightsResource (contract §3.2), as the server answers it. */
export type Insights = components['schemas']['InsightsResource'];
export type WeekPair = Insights['saves'];
/** up · down · same · new (a plain string in the generated schema). */
export type InsightsTrend = Insights['views']['trend'];
export type InsightsSource = Insights['sources'][number];
export type InsightsReaction = Insights['reactions']['by_type'][number];
export type InsightsBreakdownRow = Insights['breakdown'][number];

export const insightsKeys = {
  all: ['insights'] as const,
  account: (language: string) => ['insights', 'account', language] as const,
  vehicle: (vehicleId: string, language: string) => ['insights', 'vehicle', vehicleId, language] as const,
};

async function fetchInsights(scope: InsightsScope, signal?: AbortSignal): Promise<Insights> {
  const answer =
    scope.kind === 'account'
      ? await apiData(api.GET('/me/insights', { signal }))
      : await apiData(api.GET('/vehicles/{vehicle}/insights', { params: { path: { vehicle: scope.vehicleId } }, signal }));
  return answer.data;
}

/** INS-01: `GET me/insights` (from Profil) or `GET vehicles/{id}/insights` (from the owner's vehicle). Private, max-age 60 on the server. */
export function useInsights(scope: InsightsScope, enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const { i18n } = useTranslation();
  const vehicleId = scope.kind === 'vehicle' ? scope.vehicleId : '';
  return useQuery({
    queryKey: scope.kind === 'account' ? insightsKeys.account(i18n.language) : insightsKeys.vehicle(vehicleId, i18n.language),
    queryFn: ({ signal }) => fetchInsights(scope, signal),
    enabled: enabled && signedIn && (scope.kind === 'account' || vehicleId !== ''),
    staleTime: 60 * 1000,
    retry: retryUnlessAnswered,
  });
}

/** The beacon's body (contract §3.1): the vehicle by id, the profile by username. */
export type ViewBeaconBody =
  | { subject: 'vehicle'; id: string; source: ViewSource }
  | { subject: 'profile'; username: string; source: ViewSource };

/** `POST views`: fire and forget. Always 204 for a well-formed body; nothing is retried or queued (contract §3.1 app rule). */
export async function postView(body: ViewBeaconBody): Promise<void> {
  await apiData(api.POST('/views', { body: body as unknown as components['schemas']['RecordViewRequest'] }));
}

/** The earliest and latest season the server takes (contract §4.1: the current Berlin year … + 10). */
export const GOAL_SEASONS_AHEAD = 10;

/**
 * The owner sets or clears "Ziel: Saison 2027" (`PATCH vehicles/{id}` `build_goal_season`, contract §4.1). The public page shows the
 * new goal at once (its copy is patched before the answer, and put back on failure); everything that shows the car reads again after.
 */
export function useSetBuildGoal(vehicle: Pick<PublicVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  const publicKey = vehicleKeys.of(vehicle.slug);
  return useMutation({
    mutationKey: ['insights', 'build-goal', vehicle.id],
    scope: { id: `build-goal-${vehicle.id}` },
    mutationFn: async ({ season }: { season: number | null; goal: BuildGoal | null }) =>
      (
        await apiData(
          api.PATCH('/vehicles/{vehicle}', { params: { path: { vehicle: vehicle.id } }, body: { build_goal_season: season } }),
        )
      ).data as GarageVehicle,
    onMutate: async ({ goal }) => {
      await client.cancelQueries({ queryKey: publicKey });
      const previous = client.getQueriesData<PublicVehicle>({ queryKey: publicKey });
      client.setQueriesData<PublicVehicle>({ queryKey: publicKey }, (page) =>
        page && typeof page === 'object' && 'build_goal' in page ? { ...page, build_goal: goal } : page,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) client.setQueryData(key, data);
    },
    onSuccess: (next) => {
      const stored = next && typeof next === 'object' && next.id === vehicle.id ? next : undefined;
      refreshVehicle(client, vehicle, stored);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: garageKeys.vehicle(vehicle.id) });
    },
  });
}
