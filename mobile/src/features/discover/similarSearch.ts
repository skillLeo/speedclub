/**
 * VEH-02 "Ähnliche suchen" (m2.3 contract §8, handover §9): the mod's own facet values (`ModificationResource.search`) as
 * DISC-02 filters, so the results are builds with the same part. Wheels search by brand and diameter, suspension and exhaust
 * by brand (a suspension without a catalogue brand by its type); anything else by its category, with the brand's name as
 * text when the owner typed one, because those categories have no brand facet.
 */
import type { Href } from 'expo-router';

import type { PublicMod } from '@/api/queries/vehicles';

import { EMPTY_FILTERS, EMPTY_STATE, parseSearchParams, searchParamsOf, type SearchState } from './filters';

type ModFacts = Pick<PublicMod, 'brand' | 'search'>;

export function similarSearchState(mod: ModFacts): SearchState {
  const { search } = mod;
  const raw: Record<string, string> = {};
  if (search.wheel_brand) raw.wheel_brand = search.wheel_brand;
  if (search.wheel_diameter !== null) raw.wheel_diameter = String(search.wheel_diameter);
  if (search.suspension_brand) raw.suspension_brand = search.suspension_brand;
  else if (search.suspension_type) raw.suspension_type = search.suspension_type;
  if (search.exhaust_brand) raw.exhaust_brand = search.exhaust_brand;
  const filters = parseSearchParams(raw).filters;
  if (Object.keys(raw).length > 0) return { ...EMPTY_STATE, filters };
  return { ...EMPTY_STATE, q: (mod.brand ?? '').trim(), filters: { ...EMPTY_FILTERS, mod_category: [search.mod_category] } };
}

/** The link "Ähnliche suchen" opens: DISC-02 in Entdecken, every filter in its URL. */
export function similarSearchHref(state: SearchState): Href {
  return { pathname: '/discover/search', params: searchParamsOf(state) };
}
