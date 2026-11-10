/**
 * PROF-03, the client side of UpdateProfileRequest and the username rules (02_PRODUCT_SPEC §3.1). The server decides; these
 * say early what it would say anyway. Messages are keys with their namespace: the username reasons are the ones AUTH-08
 * shows, so both screens word a rule the same way.
 */
import { z } from 'zod';

import type { Me } from '@/api/queries/auth';
import { normalizeUsername, usernameViolations } from '@/features/auth/schemas';

export const DISPLAY_NAME_MAX_LENGTH = 60;
export const CITY_MAX_LENGTH = 100;
export const BIO_MAX_LENGTH = 500;

/** `current` is the member's username: an unchanged name is never checked again, whatever rules applied when it was set. */
export function editProfileSchema(current: string) {
  return z.object({
    displayName: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH, 'profile:edit.validation.displayNameTooLong'),
    username: z.string().superRefine((value, context) => {
      if (normalizeUsername(value) === current) return;
      const first = usernameViolations(value)[0];
      if (first) context.addIssue({ code: 'custom', message: `auth:username.reason.${first}` });
    }),
    city: z.string().trim().max(CITY_MAX_LENGTH, 'profile:edit.validation.cityTooLong'),
    bio: z.string().max(BIO_MAX_LENGTH, 'profile:edit.validation.bioTooLong'),
  });
}

export type EditProfileValues = z.infer<ReturnType<typeof editProfileSchema>>;

export function profileValues(me: Pick<Me, 'display_name' | 'username' | 'city' | 'bio'>): EditProfileValues {
  return { displayName: me.display_name ?? '', username: me.username ?? '', city: me.city ?? '', bio: me.bio ?? '' };
}

/** Only what changed, trimmed; an emptied field is sent as null, which clears it. */
export function profilePatch(
  values: EditProfileValues,
  dirty: Partial<Record<keyof EditProfileValues, boolean | undefined>>,
): { display_name?: string | null; city?: string | null; bio?: string | null } {
  const patch: { display_name?: string | null; city?: string | null; bio?: string | null } = {};
  if (dirty.displayName) patch.display_name = values.displayName.trim() || null;
  if (dirty.city) patch.city = values.city.trim() || null;
  if (dirty.bio) patch.bio = values.bio.trim() || null;
  return patch;
}

/** When the next change of the username is possible, if that lies ahead. */
export function usernameCooldownUntil(me: Pick<Me, 'username_change_available_at'>, now: Date): Date | null {
  if (!me.username_change_available_at) return null;
  const until = new Date(me.username_change_available_at);
  return Number.isNaN(until.getTime()) || until <= now ? null : until;
}
