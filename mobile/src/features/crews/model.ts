/**
 * R4-2.3 Crews: the rules the screens share — labels, the viewer's action by `viewer.state` (contract §2), the form's schema (contract
 * §4), the error texts of contract §8, the role order and the sample crew of the empty states (09 §8.19, badged "Beispiel").
 */
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { ApiError } from '@/api/client';
import {
  BUNDESLAENDER,
  CREW_CODES,
  CREW_LIMITS,
  normaliseCrewName,
  RESERVED_CREW_NAMES,
  type Bundesland,
  type Crew,
  type CrewCard,
  type CrewJoinMode,
  type CrewRole,
  type CrewSort,
} from '@/api/queries/crews';

/** `t` of `useTranslation('discover', { keyPrefix: 'crews' })`. */
export type CrewT = TFunction<'discover', 'crews'> | ((key: string, options?: Record<string, unknown>) => string);

/** Calls `t` with any key: the prefix-bound TFunction's key type is too narrow for keys built at run time. */
export function tx(t: CrewT, key: string, options?: Record<string, unknown>): string {
  return (t as (name: string, values?: Record<string, unknown>) => string)(key, options);
}

export const CREWS_PATH = '/crews';
export const crewPath = (slug: string) => `/crews/${slug}`;
export const crewEditPath = (slug: string) => `/crews/${slug}/edit`;
export const crewManagePath = (slug: string) => `/crews/${slug}/manage`;

/** "Offen", "Auf Anfrage", "Nur mit Einladung". */
export function joinModeLabel(t: CrewT, mode: CrewJoinMode): string {
  return tx(t, `joinMode.${mode}`);
}

/** "Gründer", "Admin", "Mitglied". */
export function roleLabel(t: CrewT, role: CrewRole): string {
  return tx(t, `role.${role}`);
}

/** "12 Mitglieder", "1 Mitglied": a fact on a card, never a rank (C2). */
export function memberCountLabel(t: CrewT, count: number, format: (n: number) => string): string {
  return tx(t, 'memberCount', { count, value: format(count) });
}

/** "Hamburg · 12 Mitglieder": the card's subline (the sample has no count, 09 §8.19: no invented numbers). */
export function crewSubline(t: CrewT, crew: Pick<CrewCard, 'bundesland_label' | 'member_count' | 'is_sample'>, format: (n: number) => string): string {
  const parts = [crew.bundesland_label, crew.is_sample ? null : memberCountLabel(t, crew.member_count, format)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : tx(t, 'noRegion');
}

/** The card's subline as parts, the member count marked numeric (R4DQ-45); "Ohne Bundesland" when neither is there. */
export function crewSublineParts(
  t: CrewT,
  crew: Pick<CrewCard, 'bundesland_label' | 'member_count' | 'is_sample'>,
  format: (n: number) => string,
): { text: string; numeric?: boolean }[] {
  const parts = [
    crew.bundesland_label ? { text: crew.bundesland_label } : null,
    crew.is_sample ? null : { text: memberCountLabel(t, crew.member_count, format), numeric: true },
  ].filter((part): part is { text: string; numeric?: boolean } => part !== null);
  return parts.length > 0 ? parts : [{ text: tx(t, 'noRegion') }];
}

export function bundeslandLabel(t: CrewT, code: Bundesland): string {
  return tx(t, `bundesland.${code}`);
}

export function isBundesland(value: unknown): value is Bundesland {
  return typeof value === 'string' && (BUNDESLAENDER as readonly string[]).includes(value);
}

/** The filters in the address (`?q=&bundesland=&sort=`): anything the server would refuse is left out. */
export function crewFiltersFromParams(params: { q?: string | string[]; bundesland?: string | string[]; sort?: string | string[] }): {
  text: string;
  bundesland: Bundesland | null;
  sort: CrewSort;
} {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const text = (one(params.q) ?? '').slice(0, CREW_LIMITS.queryMax);
  const region = one(params.bundesland)?.toUpperCase();
  const sort = one(params.sort) === 'newest' ? 'newest' : 'name';
  return { text, bundesland: isBundesland(region) ? region : null, sort };
}

// -- The viewer's action on CREW-01

export type CrewAction = 'join' | 'request' | 'withdraw' | 'accept' | 'leave' | 'founder' | 'inviteOnly' | 'signIn' | 'none';

/**
 * The one action under the identity (contract §2 `viewer`): a guest is asked to sign in for an open or request crew; a member's state
 * decides: invited → "Einladung annehmen", requested → "Anfrage zurückziehen", member → "Verlassen" (a founder hands over or deletes
 * first, so the founder gets "Verwalten" in its place), none → "Beitreten" / "Anfrage senden" by `can`, or the invite-only note.
 */
export function crewAction(crew: Pick<Crew, 'viewer' | 'join_mode' | 'status'>): CrewAction {
  const viewer = crew.viewer;
  if (!viewer) return crew.join_mode === 'invite' ? 'inviteOnly' : 'signIn';
  if (viewer.state === 'member') {
    if (viewer.role === 'founder') return 'founder';
    return viewer.can.leave ? 'leave' : 'none';
  }
  if (crew.status !== 'active') return 'none';
  if (viewer.state === 'invited') return 'accept';
  if (viewer.state === 'requested') return 'withdraw';
  if (viewer.can.join) return 'join';
  if (viewer.can.request) return 'request';
  return crew.join_mode === 'invite' ? 'inviteOnly' : 'none';
}

/** Founder and admins see "Bearbeiten" and "Verwalten" (requests, invitations, members). */
export function canManage(crew: Pick<Crew, 'viewer'>): boolean {
  const can = crew.viewer?.can;
  return Boolean(can && (can.edit || can.approve || can.invite || can.manage_members || can.delete));
}

// -- Members

const ROLE_RANK: Readonly<Record<CrewRole, number>> = { founder: 0, admin: 1, member: 2 };

/** Founder → admins → members, each by joined_at (the server's order; kept here for rows that came from two pages). */
export function byRole<T extends { role: CrewRole; joined_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.joined_at.localeCompare(b.joined_at));
}

/** What the viewer may do to a member row (contract §3 #24, #25): founder → anyone but self; admin → plain members only. */
export function memberControls(viewerRole: CrewRole | null | undefined, target: { role: CrewRole; is_self: boolean }) {
  const founder = viewerRole === 'founder';
  const admin = viewerRole === 'admin';
  const remove = !target.is_self && (founder ? target.role !== 'founder' : admin && target.role === 'member');
  return {
    remove,
    promote: founder && !target.is_self && target.role === 'member',
    demote: founder && !target.is_self && target.role === 'admin',
    handOver: founder && !target.is_self && target.role !== 'founder',
  };
}

// -- The form (CREW-02)

/** Letters, digits, spaces and - _ . & ' ! (contract §4). */
const NAME_CHARACTERS = /^[\p{L}\p{N} \-_.&'!]+$/u;

export function crewNameKey(name: string): string {
  return normaliseCrewName(name).toLowerCase();
}

/** True for a name the server refuses as reserved (compared on the name key and a slug-like form). */
export function isReservedCrewName(name: string): boolean {
  const key = crewNameKey(name);
  const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return RESERVED_CREW_NAMES.has(key) || RESERVED_CREW_NAMES.has(slug);
}

/** Messages are keys of the `crews.form.errors` group (the server's own messages come translated). */
export const crewFormSchema = z.object({
  name: z
    .string()
    .transform(normaliseCrewName)
    .pipe(
      z
        .string()
        .min(CREW_LIMITS.nameMin, 'form.errors.nameShort')
        .max(CREW_LIMITS.nameMax, 'form.errors.nameLong')
        .regex(NAME_CHARACTERS, 'form.errors.nameCharacters')
        .refine((name) => !isReservedCrewName(name), 'form.errors.nameReserved'),
    ),
  description: z.string().max(CREW_LIMITS.descriptionMax, 'form.errors.descriptionLong'),
  bundesland: z.union([z.enum(BUNDESLAENDER as unknown as [Bundesland, ...Bundesland[]]), z.literal('')]),
  joinMode: z.enum(['open', 'request', 'invite']),
});

export type CrewFormInput = z.input<typeof crewFormSchema>;
export type CrewFormValues = z.output<typeof crewFormSchema>;

export const EMPTY_CREW_FORM: CrewFormInput = { name: '', description: '', bundesland: '', joinMode: 'open' };

export function crewFormFrom(crew: Pick<Crew, 'name' | 'description' | 'bundesland' | 'join_mode'>): CrewFormInput {
  return {
    name: crew.name,
    description: crew.description ?? '',
    bundesland: isBundesland(crew.bundesland) ? crew.bundesland : '',
    joinMode: crew.join_mode,
  };
}

/** The API's field names → the form's. */
export const CREW_SERVER_FIELDS = { name: 'name', description: 'description', bundesland: 'bundesland', join_mode: 'joinMode' } as const;

export function createBody(values: CrewFormValues) {
  const description = values.description.trim();
  return {
    name: values.name,
    description: description === '' ? null : description,
    bundesland: values.bundesland === '' ? null : values.bundesland,
    join_mode: values.joinMode,
  };
}

/** Only what changed since `before` (the PATCH changes the keys it is sent). */
export function updateBody(values: CrewFormValues, before: CrewFormInput) {
  const next = createBody(values);
  const old = createBody({ ...before, name: normaliseCrewName(before.name) } as CrewFormValues);
  const body: Partial<ReturnType<typeof createBody>> = {};
  if (next.name !== old.name) body.name = next.name;
  if (next.description !== old.description) body.description = next.description;
  if (next.bundesland !== old.bundesland) body.bundesland = next.bundesland;
  if (next.join_mode !== old.join_mode) body.join_mode = next.join_mode;
  return body;
}

// -- Errors (contract §8)

/**
 * The text of a refused crew action: the server's message where it carries the reason (`limit_reached` names the limit), our words
 * for the codes with a fixed meaning.
 */
export function crewErrorText(t: CrewT, error: unknown, fallbackKey: string = 'errors.failed'): string {
  if (!(error instanceof ApiError)) return tx(t, fallbackKey);
  if (error.kind === 'network') return tx(t, 'errors.offline');
  if (error.kind === 'rate_limited') return tx(t, 'errors.rateLimited');
  if (error.code === CREW_CODES.unavailable || error.kind === 'not_found') return tx(t, 'errors.unavailable');
  if (error.code === CREW_CODES.restricted || error.kind === 'restricted') return tx(t, 'errors.restricted');
  if (error.code === CREW_CODES.emailNotVerified) return tx(t, 'errors.emailNotVerified');
  if (error.code === CREW_CODES.limitReached) return error.message || tx(t, 'errors.limitReached');
  if (error.code === CREW_CODES.conflict) return error.message || tx(t, 'errors.conflict');
  if (error.code === CREW_CODES.forbidden || error.kind === 'forbidden') return error.message || tx(t, 'errors.forbidden');
  return error.message || tx(t, fallbackKey);
}

// -- Sample (09 §8.19)

/** The badged sample crew of the empty states: no member count (no invented numbers), no viewer. */
export function sampleCrew(t: CrewT): CrewCard {
  return {
    id: 'sample-crew',
    slug: 'sample-crew',
    name: tx(t, 'sample.name'),
    description: tx(t, 'sample.description'),
    bundesland: 'HH',
    bundesland_label: bundeslandLabel(t, 'HH'),
    join_mode: 'open',
    member_count: 0,
    logo: null,
    cover: null,
    is_sample: true,
    share_path: '/crews/sample-crew',
    viewer: null,
  };
}
