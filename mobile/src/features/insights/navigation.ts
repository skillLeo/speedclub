import type { Href } from 'expo-router';

/** INS-01 (10 §11): the route ID of both scopes. */
export const INSIGHTS_ROUTE = 'INS-01';

/** INS-01 from Profil (`/insights`, the weekly recap's path) or from the owner's vehicle (`/vehicles/{id}/insights`). */
export function insightsHref(vehicleId?: string): Href {
  return vehicleId ? { pathname: '/vehicles/[id]/insights', params: { id: vehicleId } } : '/insights';
}
