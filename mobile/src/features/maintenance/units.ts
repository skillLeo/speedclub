import { useMemberSettings } from '@/api/queries/settings';

import type { DistanceUnit } from './model';

/** SET-11 "Entfernung": km or mi. The server keeps km; the screens convert what they show and what the member types. */
export function useDistanceUnit(): DistanceUnit {
  const settings = useMemberSettings();
  return settings.data?.distance_unit === 'mi' ? 'mi' : 'km';
}
