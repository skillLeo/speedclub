import { useLocalSearchParams } from 'expo-router';

import { usePublicVehicle } from '@/api/queries/vehicles';
import { useMemberProfile } from '@/api/queries/social';

import { useViewBeacon } from './beacon';

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * VEH-01's beacon, mounted by its route next to the screen (the vehicle lane's screen stays untouched). It reads the page's own query
 * (same key, no extra request) and sends once the page has loaded and is focused.
 */
export function useVehicleViewBeacon(): void {
  const params = useLocalSearchParams<{ slug: string; via?: string }>();
  const slug = first(params.slug) ?? '';
  const query = usePublicVehicle(slug);
  const vehicle = query.data;
  useViewBeacon({
    target: vehicle ? { subject: 'vehicle', id: vehicle.id } : null,
    ready: Boolean(vehicle),
    own: Boolean(vehicle?.is_owner || vehicle?.owner?.is_self),
    sample: Boolean(vehicle?.is_sample || vehicle?.owner?.is_sample),
    via: first(params.via),
    slug: vehicle?.slug ?? slug,
  });
}

/** PROF-02's beacon, the same way: once the member's profile has loaded, never on your own profile. */
export function useProfileViewBeacon(): void {
  const params = useLocalSearchParams<{ username: string; via?: string }>();
  const username = first(params.username) ?? '';
  const query = useMemberProfile(username || undefined);
  const profile = query.data;
  useViewBeacon({
    target: profile?.username ? { subject: 'profile', username: profile.username } : null,
    ready: Boolean(profile),
    own: Boolean(profile?.is_self),
    sample: Boolean(profile?.is_sample),
    via: first(params.via),
  });
}
