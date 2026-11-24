/**
 * M5.9b owner-side writes (contract §4), apart from api/queries/dex.ts so the light Dex module (the scanner's city lookup imports
 * it) does not load the garage, settings and account modules.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import type { MemberSettings } from '@/api/queries/auth';
import { dexKeys, isRecord, spotSettingsOf, type VehicleSpotSettings } from '@/api/queries/dex';
import { garageKeys, type GarageVehicle } from '@/api/queries/garage';
import { memberSettingsKey } from '@/api/queries/settings';

/**
 * GAR-12 "Spots": one switch at a time, saved at once. Optimistic on the garage copy of the car, back on failure; the stats are
 * read again afterwards (hidden cities leave them). The answer is the owner's vehicle with the switches as stored
 * (`UpdateVehicleRequest` lists them since M5.9c).
 */
export function useUpdateSpotSettings(vehicleId: string) {
  const client = useQueryClient();
  const key = garageKeys.vehicle(vehicleId);
  return useMutation({
    mutationKey: ['dex', 'spot-settings', vehicleId],
    scope: { id: `spot-settings-${vehicleId}` },
    mutationFn: async (patch: Partial<VehicleSpotSettings>) => {
      const answer = await apiData(api.PATCH('/vehicles/{vehicle}', { params: { path: { vehicle: vehicleId } }, body: patch }));
      const vehicle = isRecord(answer.data) ? (answer.data as Partial<GarageVehicle>) : null;
      return vehicle?.id === vehicleId ? vehicle : null;
    },
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<GarageVehicle>(key);
      if (before) client.setQueryData<GarageVehicle>(key, { ...before, ...patch });
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSuccess: (vehicle, patch) => {
      const current = client.getQueryData<GarageVehicle>(key);
      if (current) client.setQueryData<GarageVehicle>(key, { ...current, ...patch, ...(vehicle ? spotSettingsOf(vehicle) : {}) });
      void client.invalidateQueries({ queryKey: dexKeys.spotStats(vehicleId) });
    },
  });
}

// -- SET-07

/** `PATCH /me/settings {show_my_spots}` (contract §10, like every SET-07 field): optimistic, back on failure. */
export function useSetShowMySpots() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['dex', 'show-my-spots'],
    scope: { id: 'me-settings' },
    mutationFn: async (show: boolean) => (await apiData(api.PATCH('/me/settings', { body: { show_my_spots: show } }))).data,
    onMutate: async (show) => {
      await client.cancelQueries({ queryKey: memberSettingsKey });
      const settings = client.getQueryData<MemberSettings>(memberSettingsKey);
      if (settings) client.setQueryData<MemberSettings>(memberSettingsKey, { ...settings, show_my_spots: show });
      return { settings };
    },
    onError: (_error, _show, context) => {
      if (context?.settings) client.setQueryData(memberSettingsKey, context.settings);
    },
    onSuccess: (settings) => {
      if (settings) client.setQueryData<MemberSettings>(memberSettingsKey, settings);
    },
  });
}
