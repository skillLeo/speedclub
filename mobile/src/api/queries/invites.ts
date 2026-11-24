/**
 * M5.9d invite codes (contract docs/reports/phase-5/m5.9d-contract.md §5, ADR-508): five codes per member, created by the server on
 * the first read, each open or redeemed; the link `https://<host>/join/{code}`. Both sides get the "Crew Starter" badge and nothing
 * else: no XP beyond the badge, no money.
 *
 * Through the generated client (`InviteResource`, `InviteLookupResource`): items `{code, created_at, accepted_at, accepted_by}`, and
 * the public lookup `GET invites/{code}` → `{data: {code, inviter}}` (404 for an unknown or used code) that
 * "Du wurdest von @… eingeladen" reads.
 */
import { useQuery } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { normalizeInviteCode } from '@/features/auth/inviteCode';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

import { fromGiftQa, giftQa } from './giftQa';
import { retryUnlessAnswered } from './vehicles';

export type InviteMember = { username: string; display_name: string | null };

export type Invite = {
  code: string;
  created_at: string | null;
  accepted_at: string | null;
  /** Who redeemed it, when the server names them; a redeemed code may still come without a name. */
  accepted_by: InviteMember | null;
};

export type MyInvites = { invites: Invite[] };

/** What `/join/{code}` knows before sign-up. `inviter` only when the API hands out the inviter's public handle. */
export type InviteLookup = { status: 'valid'; inviter: InviteMember | null } | { status: 'invalid' };


const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const inviteKeys = {
  all: ['invites'] as const,
  mine: ['invites', 'me'] as const,
  lookup: (code: string) => ['invites', 'lookup', code] as const,
};

function memberOf(value: unknown): InviteMember | null {
  if (!isRecord(value) || typeof value.username !== 'string' || value.username === '') return null;
  return { username: value.username, display_name: typeof value.display_name === 'string' ? value.display_name : null };
}

function parseInvite(value: unknown): Invite | null {
  if (!isRecord(value)) return null;
  const code = normalizeInviteCode(typeof value.code === 'string' ? value.code : null);
  if (!code) return null;
  return {
    code,
    created_at: typeof value.created_at === 'string' ? value.created_at : null,
    accepted_at: typeof value.accepted_at === 'string' ? value.accepted_at : null,
    accepted_by: memberOf(value.accepted_by),
  };
}

export function parseInvites(body: unknown): MyInvites {
  const list = isRecord(body) && 'data' in body ? body.data : body;
  return { invites: (Array.isArray(list) ? list : []).map(parseInvite).filter((invite): invite is Invite => invite !== null) };
}

export function inviteRedeemed(invite: Invite): boolean {
  return invite.accepted_at !== null || invite.accepted_by !== null;
}

/** The share link of a code: `https://<host>/join/{code}`, or null where the app knows no site. */
export function inviteUrl(code: string, site: string | null): string | null {
  if (!site) return null;
  return `${site.replace(/\/+$/, '')}/join/${encodeURIComponent(code)}`;
}

/** `GET me/invites` (INV-01). */
export function useMyInvites(enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const sample = giftQa() !== null;
  return useQuery({
    queryKey: [...inviteKeys.mine, sample ? 'qa' : 'live'],
    queryFn: async ({ signal }) =>
      sample ? fromGiftQa((source) => source.invites()) : parseInvites(await apiData(api.GET('/me/invites', { signal }))),
    enabled: signedIn && enabled,
    retry: sample ? false : retryUnlessAnswered,
  });
}

async function lookupInvite(code: string, signal?: AbortSignal): Promise<InviteLookup> {
  try {
    const body = await apiData(api.GET('/invites/{code}', { params: { path: { code } }, signal }));
    const data = isRecord(body) && 'data' in body ? body.data : body;
    return { status: 'valid', inviter: isRecord(data) ? memberOf(data.inviter) : null };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410 || error.status === 422)) return { status: 'invalid' };
    throw error;
  }
}

/**
 * The invite behind `/join/{code}`, read on the sign-up screens. A failed read (offline, a server before M5.9d) is no answer: the
 * code is still sent with the sign-up, and only the inviter line stays away.
 */
export function useInviteLookup(code: string | null) {
  const sample = giftQa() !== null;
  return useQuery({
    queryKey: [...inviteKeys.lookup(code ?? ''), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample ? fromGiftQa((source) => source.inviteLookup(code ?? '')) : lookupInvite(code ?? '', signal)),
    enabled: code !== null,
    retry: false,
    staleTime: Infinity,
  });
}
