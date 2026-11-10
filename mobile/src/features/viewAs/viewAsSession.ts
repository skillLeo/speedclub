/**
 * View-as, the tab's side (m3.2-contract §3, ADM-10, ADR-227). Web only: the admin's "Ansicht als" opens
 * `/app/#view_as=<token>&staff=<name>` in a new tab. On load this module
 *
 * 1. takes token and staff name from the fragment and drops the fragment from the address bar at once (`history.replaceState`);
 * 2. keeps them in this tab's sessionStorage only (a reload of the tab stays in the view, a new tab never inherits it), never in
 *    localStorage, the query cache or a URL;
 * 3. tells the API client (api/clientViewAs.ts), which then sends the token as the Bearer, no cookie, and refuses writes and messages.
 *
 * The session lifecycle then signs in as the member read-only (`restoreViewAs`): nothing about the member is written to this browser's
 * storage (no `sc.sessionMember`, theme, language, power display or query cache), so the staff member's own app in another tab notices
 * nothing. Ending (`endViewAs`) revokes the token (`DELETE view-as`, the one write allowed), forgets it, drops everything loaded, and
 * leaves the tab on "Ansicht beendet"; a 401 at expiry and a refused start end it the same way. Native ignores `#view_as` entirely.
 */
import { create } from 'zustand';

import { api, ApiError, apiData } from '@/api/client';
import { isViewAsTab, registerViewAsEnd, setViewAsTab, VIEW_AS_STORAGE_KEY, viewAsToken } from '@/api/clientViewAs';
import { meKey, toSessionMember, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { isWeb } from '@/lib/platform';
import { abortSessionRequests, setMember, useSessionStore, type SessionMember } from '@/state/session';

/** Why the view is over: the staff member ended it, the 30 minutes ran out, or the account cannot be viewed now. */
export type ViewAsEndReason = 'ended' | 'expired' | 'unavailable';

export type ViewAsState = {
  /** `off`: a normal tab. `starting`: asking auth/me. `active`: signed in read-only. `failed`: no answer, the token is kept for a retry. */
  status: 'off' | 'starting' | 'active' | 'failed' | 'ending' | 'ended';
  /** The staff member's name, as the admin handed it over; display only. */
  staff: string | null;
  /** The member's @username, once auth/me answered. */
  username: string | null;
  reason: ViewAsEndReason | null;
};

const OFF: ViewAsState = { status: 'off', staff: null, username: null, reason: null };

export const useViewAsStore = create<ViewAsState>(() => OFF);

/** What sessionStorage keeps for the tab: the live token, or the end it came to. */
type Stored = { token: string; staff: string | null } | { ended: ViewAsEndReason };

/** A Sanctum token as `StartViewAs` hands it out (`<id>|<prefix + 40 chars + crc>`); anything else is no view-as. */
const TOKEN_SHAPE = /^\d+\|[A-Za-z0-9_-]{20,160}$/;
/** A staff name shown in the banner: printable, short. */
const STAFF_MAX_LENGTH = 80;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/** The view-as of a fragment (`#view_as=…&staff=…`), or null. A token of the wrong shape, or given twice, is none. */
export function readViewAsFragment(hash: string): { token: string; staff: string | null } | null {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const tokens = values.getAll('view_as');
  const token = tokens.length === 1 ? (tokens[0] ?? '') : '';
  if (!TOKEN_SHAPE.test(token)) return null;
  const rawStaff = values.get('staff')?.trim() ?? '';
  const staff = rawStaff && rawStaff.length <= STAFF_MAX_LENGTH && !CONTROL_CHARACTERS.test(rawStaff) ? rawStaff : null;
  return { token, staff };
}

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<{ token: unknown; staff: unknown; ended: unknown }> | null;
    if (value && typeof value.token === 'string' && TOKEN_SHAPE.test(value.token)) {
      return { token: value.token, staff: typeof value.staff === 'string' ? value.staff : null };
    }
    if (value && (value.ended === 'ended' || value.ended === 'expired' || value.ended === 'unavailable')) return { ended: value.ended };
  } catch {
    // Not ours.
  }
  return null;
}

/** The parts of `window` the intake needs; tests hand in their own. */
export type ViewAsWindow = {
  location: { hash: string; pathname: string; search: string };
  history: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void };
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
};

let tabWindow: ViewAsWindow | null = null;

function store(value: Stored): void {
  try {
    tabWindow?.sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the view then lasts as long as this page.
  }
}

/**
 * Reads a view-as handed to this tab. Runs once at load, before the session restore. A fragment wins over what the tab kept: the admin
 * started a new view. The fragment leaves the address bar whether or not it held a usable token.
 */
export function intakeViewAs(win: ViewAsWindow): void {
  tabWindow = win;
  const { hash, pathname, search } = win.location;
  let found: Stored | null = null;
  if (hash.includes('view_as=')) {
    found = readViewAsFragment(hash);
    try {
      win.history.replaceState(win.history.state, '', `${pathname}${search}`);
    } catch {
      // A browser that refuses: the token still goes no further than this tab.
    }
    if (found) store(found);
  }
  if (!found) {
    let raw: string | null = null;
    try {
      raw = win.sessionStorage.getItem(VIEW_AS_STORAGE_KEY);
    } catch {
      raw = null;
    }
    found = parseStored(raw);
  }
  if (!found) return;
  if ('token' in found) {
    setViewAsTab('active', found.token);
    useViewAsStore.setState({ status: 'starting', staff: found.staff, username: null, reason: null });
  } else {
    setViewAsTab('ended');
    useViewAsStore.setState({ status: 'ended', staff: null, username: null, reason: found.ended });
  }
}

/**
 * The router reads the address before this module runs and writes its first state back with the fragment it saw. Called once the app
 * is mounted (ViewAsFrame): the fragment goes again, the router's own history state stays.
 */
export function dropViewAsFragment(): void {
  const win = tabWindow;
  if (!win || !win.location.hash.includes('view_as=')) return;
  try {
    win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}`);
  } catch {
    // As at intake.
  }
}

/** Whether the tab is in a view-as, live or over. */
export function isViewAs(): boolean {
  return isViewAsTab();
}

/** The member the view shows, from auth/me: in memory only, nothing goes to storage (contrast adoptMe). */
export function adoptViewAsMember(me: Me): SessionMember {
  const member = toSessionMember(me);
  queryClient.setQueryData(meKey, me);
  setMember(member);
  useViewAsStore.setState({ status: 'active', username: me.username || null });
  return member;
}

let ending: Promise<void> | null = null;

/**
 * Ends the view. `ended`: the staff member chose to, so the token is revoked first (a failure there changes nothing: it expires within
 * 30 minutes and staff can end it from the admin). Any other reason: the server already refuses the token. Runs once.
 */
export function endViewAs(reason: ViewAsEndReason): Promise<void> {
  if (!isViewAsTab()) return Promise.resolve();
  const { status } = useViewAsStore.getState();
  if (status === 'ended') return Promise.resolve();
  ending ??= (async () => {
    useViewAsStore.setState({ status: 'ending' });
    if (reason === 'ended' && viewAsToken()) {
      try {
        await apiData(api.DELETE('/view-as'));
      } catch (error) {
        if (!(error instanceof ApiError)) console.warn('Could not end the view-as');
      }
    }
    setViewAsTab('ended');
    store({ ended: reason });
    abortSessionRequests();
    queryClient.clear();
    useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false, notice: null, passwordChangeEmail: null, expiredFrom: null });
    useViewAsStore.setState({ status: 'ended', reason, username: null });
  })().finally(() => {
    ending = null;
  });
  return ending;
}

registerViewAsEnd(() => endViewAs('ended'));

/** No answer from auth/me: the token stays for "Erneut versuchen", which reloads the tab. */
export function markViewAsFailed(): void {
  if (useViewAsStore.getState().status === 'starting') useViewAsStore.setState({ status: 'failed' });
}

/** Tests only. */
export function resetViewAsForTests(): void {
  setViewAsTab('off');
  tabWindow = null;
  ending = null;
  useViewAsStore.setState(OFF);
}

if (isWeb && typeof window !== 'undefined' && window.location && window.history && typeof window.sessionStorage !== 'undefined') {
  intakeViewAs(window as unknown as ViewAsWindow);
}
