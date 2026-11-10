import type { QrResolution } from '@/api/queries/qr';

/** The three calm states of WEB-06, in the app. */
export type QrStateKind = 'revoked' | 'private' | 'not_found';

export type ResolverOutcome =
  | { kind: 'vehicle'; slug: string }
  /** `title` and `message` are the server's WEB-06 copy; null where the app shows its own copy of it. */
  | { kind: 'state'; state: QrStateKind; title: string | null; message: string | null };

/** No code can look like the input: the app answers as the server would, without a request. */
export const INVALID_CODE_OUTCOME: ResolverOutcome = { kind: 'state', state: 'not_found', title: null, message: null };

/**
 * Where a scan goes. Only an active code with a slug opens the vehicle; revoked and private show nothing of it, exactly as
 * the server's answer does (ADR-141, ADR-148 b).
 */
export function resolverOutcome(resolution: QrResolution): ResolverOutcome {
  if (resolution.state === 'active') {
    return resolution.slug ? { kind: 'vehicle', slug: resolution.slug } : INVALID_CODE_OUTCOME;
  }
  return { kind: 'state', state: resolution.state, title: resolution.title, message: resolution.message };
}

/** The route of VEH-01. From c/[code] it opens in the first tab group, as any link from outside the tabs does. */
export function vehicleRoute(slug: string) {
  return { pathname: '/v/[slug]' as const, params: { slug } };
}
