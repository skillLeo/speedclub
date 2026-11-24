/** M5.9b routes: DEX-02 scanner, DEX-01 Mein Dex, DEX-03 reveal, DEX-04 card, DEX-05 sets, DEX-06 owner spot stats. */
export const SCAN_ROUTE = '/scan' as const;
export const DEX_HOME_ROUTE = '/dex' as const;
export const DEX_SETS_ROUTE = '/dex/sets' as const;

/** DEX-03 for one spot. */
export function spotRoute(spotId: string) {
  return { pathname: '/dex/spot/[spotId]' as const, params: { spotId } };
}

/** DEX-04 for one car. */
export function dexCardRoute(vehicleId: string) {
  return { pathname: '/dex/car/[vehicleId]' as const, params: { vehicleId } };
}

/** DEX-06, the owner's spots of one car. */
export function ownerSpotsRoute(vehicleId: string) {
  return { pathname: '/vehicles/[id]/spots' as const, params: { id: vehicleId } };
}

/** GAR-12, where the car's spot switches live (Ghost-Modus, Spotten pausieren, Städte verbergen). */
export function spotSettingsRoute(vehicleId: string) {
  return `/garage/${vehicleId}/visibility` as const;
}
