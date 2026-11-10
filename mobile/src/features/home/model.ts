import type { FeedOwner, FeedVehicle } from '@/api/queries/home';
import { variantUrl } from '@/features/profile/media';
import { size } from '@/theme';
import type { VehicleCardOwner } from '@/ui';

const SEPARATOR = ' · ';
const NO_BREAK_SPACE = '\u00A0';

/** A date from the API, or null when it is missing or not a date. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The §8 owner row of a feed card: avatar 32, "@lukas.sc", and when the build last changed. None when the owner switched
 * off "Besitzer zeigen" (ADR-148 a): then the card names nobody.
 */
export function feedOwner(vehicle: Pick<FeedVehicle, 'owner' | 'updated_at'>, relative: (date: Date) => string): VehicleCardOwner | undefined {
  const owner = vehicle.owner;
  if (!owner) return undefined;
  const changed = parseDate(vehicle.updated_at);
  return {
    username: `@${owner.username}`,
    avatarUri: variantUrl(owner.avatar, size.avatar.sm),
    avatarBlurhash: owner.avatar?.blurhash ?? null,
    ...(changed ? { time: relative(changed) } : {}),
  };
}

/**
 * The eyebrow line of the latest change: its kind ("Modifikation hinzugefügt"), and its time when no owner row carries one.
 */
export function latestChangeMeta(vehicle: Pick<FeedVehicle, 'owner' | 'latest_update'>, relative: (date: Date) => string): string | null {
  const update = vehicle.latest_update;
  if (!update) return null;
  const created = vehicle.owner ? null : parseDate(update.created_at);
  return [update.type_label.trim(), created ? relative(created) : null].filter(Boolean).join(SEPARATOR) || null;
}

/** FS-2: "@lukas.sc · Stuttgart" under the featured title, or nothing when the owner is hidden. */
export function featuredByline(owner: Pick<FeedOwner, 'username' | 'city'> | null): string | null {
  if (!owner) return null;
  // DQ-203: the line wraps after the "·", never before it, so no separator is left at the end of the first line.
  return [`@${owner.username}`, owner.city?.trim()].filter(Boolean).join(SEPARATOR).replace(/ (?=·)/, NO_BREAK_SPACE);
}

/** "BMW M4 Competition · @jann.ptrs · vor 2 Std.": whose car changed and when. The owner part goes when the owner is hidden. */
export function updateMeta(
  update: { created_at: string | null; vehicle: Pick<FeedVehicle, 'full_title' | 'owner'> },
  relative: (date: Date) => string,
): string {
  const created = parseDate(update.created_at);
  return [update.vehicle.full_title.trim(), update.vehicle.owner ? `@${update.vehicle.owner.username}` : null, created ? relative(created) : null]
    .filter(Boolean)
    .join(SEPARATOR);
}

/** The keys of the builds above the stream (hero and Neue Builds), so the stream never shows one of them twice. */
export function shownAbove(ids: readonly (string | undefined)[]): ReadonlySet<string> {
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

/**
 * The car of an active member or a suggestion: the short label the server sends for the strip ("Impreza GD", DQ-293) when it has one,
 * else the full line ("Subaru Impreza WRX STI GD"). `car_short` arrives with the backend team's DQ-293 change; until the types
 * have it, it is read only when present.
 */
export function carLabel(member: { car_line: string | null } & object): string | null {
  const short = 'car_short' in member ? (member as { car_short?: unknown }).car_short : undefined;
  const label = typeof short === 'string' && short.trim() !== '' ? short : member.car_line;
  return label?.trim() || null;
}
