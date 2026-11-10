/**
 * View-as (m3.2-contract §3, ADM-10), the API client's side: the token the admin's "Ansicht als" handed this tab, and what such a tab
 * may send. Web only; a native app never holds one (features/viewAs/viewAsSession.ts reads the fragment on web alone).
 *
 * The token lives in this module and in the tab's sessionStorage, never in localStorage, the query cache or a URL. A view-as tab sends
 * it as the Bearer and no cookie at all: the browser's cookie belongs to whoever is signed in there (staff often are), and Sanctum would
 * take the cookie's member over the token. The server refuses writes (403 `view_as_read_only`) and everything that holds messages
 * (403 `view_as_no_messages`, ADR-227); this client refuses them before they leave, so the app's polls and writes never reach it.
 */
import i18n from '@/i18n';

import type { ApiErrorKind } from './client';

export const VIEW_AS_STORAGE_KEY = 'sc.viewAs';

export type ViewAsRefusal = 'view_as_read_only' | 'view_as_no_messages';

/** `off`: a normal tab. `active`: a view-as token is held. `ended`: the view-as of this tab is over, and nothing replaces it. */
export type ViewAsTabState = 'off' | 'active' | 'ended';

let state: ViewAsTabState = 'off';
let token: string | null = null;

export function viewAsTabState(): ViewAsTabState {
  return state;
}

/** Whether this tab is (or was) a view-as tab. Such a tab never becomes a normal member's or guest's tab again. */
export function isViewAsTab(): boolean {
  return state !== 'off';
}

/** The Bearer of an active view-as, or null. */
export function viewAsToken(): string | null {
  return state === 'active' ? token : null;
}

export function setViewAsTab(next: ViewAsTabState, nextToken: string | null = null): void {
  state = next;
  token = next === 'active' ? nextToken : null;
}

let endHook: (() => Promise<void>) | null = null;

/** features/viewAs registers how a view ends, so a sign-out in such a tab ends the view instead (api/queries/auth.ts). */
export function registerViewAsEnd(hook: () => Promise<void>): void {
  endHook = hook;
}

/** Ends the view the staff member's way: revoked, forgotten, "Ansicht beendet". */
export function requestViewAsEnd(): Promise<void> {
  return endHook ? endHook() : Promise.resolve();
}

/** The one write a view-as token may make: ending itself (`DELETE view-as`). */
export const VIEW_AS_END_PATH = '/view-as';

/** The routes that answer 403 `view_as_no_messages` (RestrictViewAs::MESSAGE_PATHS): messages, their counts, realtime, the export. */
const MESSAGE_PATH = /^\/(?:conversations|messages|chat-media|broadcasting)(?:\/|$)|^\/notifications\/unread-count$|^\/me\/exports?(?:\/|$)/;

/** What the server would refuse for a view-as token, or null for a request that may go. `path` is the OpenAPI path. */
export function viewAsRefusalFor(method: string, path: string): ViewAsRefusal | null {
  if (MESSAGE_PATH.test(path)) return 'view_as_no_messages';
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return null;
  if (upper === 'DELETE' && path === VIEW_AS_END_PATH) return null;
  return 'view_as_read_only';
}

/** Whether an error is one of the two view-as refusals, from the server or from this client. */
export function isViewAsRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'view_as_read_only' || code === 'view_as_no_messages';
}

/** The fields of the ApiError a refusal becomes; client.ts builds it, so this module needs no class of its own. */
export function viewAsRefusalFields(code: ViewAsRefusal): { kind: ApiErrorKind; status: number; code: string; message: string } {
  return {
    kind: 'forbidden',
    status: 403,
    code,
    message: i18n.t(code === 'view_as_no_messages' ? 'auth:viewAs.noMessages' : 'auth:viewAs.readOnly'),
  };
}
