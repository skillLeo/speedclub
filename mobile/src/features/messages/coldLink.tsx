/**
 * DQ-M52-02 / review SF-1 (10 §1, ADR-501): Nachrichten belongs to Start. The message routes live in the shared tab group, so a link
 * that opens the app on a conversation (a Web Push clicked with no window open, a universal or app link, a reload of a conversation
 * URL) has no current tab to resolve into, and Expo Router takes the first clone, Entdecken. Such a landing is moved into Start, with
 * the inbox below a conversation, so back goes conversation → inbox → Start. The URL stays the same.
 *
 * Only the landing route moves. Once anything else has shown, a message route opens in the tab that pushed it (the Entdecken header,
 * a profile's "Nachricht senden", a warm push), as before.
 */
import { useNavigation, usePathname, useRouter, useSegments, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { isWeb } from '@/lib/platform';

/** The group that owns Nachrichten (PLACE_DESTINATIONS.messages.tab). */
export const MESSAGES_GROUP = '(home)';
const TABS_GROUP = '(tabs)';

/** The path the app opened on, until another path shows (then null). Undefined before anything was seen. */
let landing: string | null | undefined;

/** The tab shell reports every path it shows: from the second one on, nothing is a landing any more. */
export function noteShownPath(pathname: string): void {
  if (landing === undefined) landing = pathname;
  else if (landing !== null && landing !== pathname) landing = null;
}

/** True while `pathname` is still the path the app opened on. */
export function isLandingPath(pathname: string): boolean {
  noteShownPath(pathname);
  return landing === pathname;
}

export function resetLandingForTests(): void {
  landing = undefined;
  pendingPage = null;
}

/** Keeps the tab shell's view of the shown path current; called by the always-mounted tab layout hook. */
export function useNoteShownPath(): void {
  const pathname = usePathname();
  useEffect(() => noteShownPath(pathname), [pathname]);
}

/**
 * The hrefs that rebuild a landing message route inside Start: the inbox (with the query it carries, `?folder=`), and for a
 * conversation, request or info page that page on top of the inbox. Pure, for the tests.
 */
export function startHrefs(pathname: string, search: string): string[] {
  const base = `/${TABS_GROUP}/${MESSAGES_GROUP}`;
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  if (pathname === '/messages' || pathname === '/messages/') return [`${base}/messages${query}`];
  return [`${base}/messages`, `${base}${pathname}${query}`];
}

/** The query of the landing URL: the browser's on the web; native links reach the route as params, which a route keeps anyway. */
function landingSearch(): string {
  if (!isWeb || typeof window === 'undefined') return '';
  return window.location.search;
}

/** The page that goes on top of the moved inbox, pushed once Start's inbox has mounted (a stack not yet shown takes one action). */
let pendingPage: string | null = null;

/**
 * Wraps a message route. When the route is the app's landing page outside Start, it draws nothing (a blank canvas for the one frame
 * the move takes), opens the inbox in Start with Start's root below it, puts a conversation, request or info page on top of that
 * inbox, and empties the other tab's stack, so that tab shows its own root when the member goes there next.
 */
export function LandInStart({ children }: { children: ReactNode }) {
  const segments = useSegments() as readonly string[];
  const pathname = usePathname();
  const navigation = useNavigation();
  const router = useRouter();
  const done = useRef(false);
  const [move] = useState(() => segments[0] === TABS_GROUP && segments[1] !== undefined && segments[1] !== MESSAGES_GROUP && isLandingPath(pathname));

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!move) {
      // Start's inbox, moved here a moment ago: now its stack exists, the landing page goes on top.
      if (pendingPage && segments[1] === MESSAGES_GROUP) {
        const page = pendingPage;
        pendingPage = null;
        router.push(page as Href);
      }
      return;
    }
    // The landing is used up: the moved page must not move again, and nothing after it is a landing.
    landing = null;
    const [inbox, page] = startHrefs(pathname, landingSearch());
    pendingPage = page ?? null;
    if (inbox) router.navigate(inbox as Href, { withAnchor: true });
    // The tab the link fell into goes back to its root (its anchor), without the message page on top.
    if (navigation.canGoBack()) navigation.dispatch({ type: 'POP_TO_TOP' });
    // Once, on mount: the move is decided by the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return move ? null : children;
}
