/**
 * DQ-P5-017 (10 §1, §6.1; the M5.2 cold-link class, DQ-M52-02): Statistiken opens from Profil (`/insights`) and from the owner's
 * vehicle (`/vehicles/{id}/insights`). Both routes live in the shared tab group, so a link that opens the app on them (a reload, the
 * weekly recap's push or e-mail, a bookmark) has no current tab and Expo Router takes the first clone, Entdecken: the bar then marks
 * Entdecken. Such a landing is moved into its own tab, Profil or Garage, over that tab's root; the URL stays the same.
 *
 * Only the landing route moves. Once anything else has shown, the routes open in the tab that pushed them, as before.
 */
import { useNavigation, usePathname, useRouter, useSegments, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { isLandingPath } from '@/features/messages/coldLink';
import { isWeb } from '@/lib/platform';

const TABS_GROUP = '(tabs)';

export type InsightsLanding = { group: '(profile)' | '(garage)'; href: string };

/**
 * Where a landing on an INS-01 route belongs: the account's statistics in Profil, a car's in Garage (the owner's garage is where the
 * car's statistics are opened from). Null for any other path. Pure, for the tests.
 */
export function insightsLanding(pathname: string, search: string): InsightsLanding | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  if (path === '/insights') return { group: '(profile)', href: `/${TABS_GROUP}/(profile)/insights${query}` };
  const vehicle = /^\/vehicles\/([^/]+)\/insights$/.exec(path);
  if (vehicle?.[1]) return { group: '(garage)', href: `/${TABS_GROUP}/(garage)/vehicles/${vehicle[1]}/insights${query}` };
  return null;
}

/** The query of the landing URL: the browser's on the web; native links reach the route as params, which the route keeps anyway. */
function landingSearch(): string {
  if (!isWeb || typeof window === 'undefined') return '';
  return window.location.search;
}

/**
 * Wraps an INS-01 route. When the route is the app's landing page outside its own tab, it draws nothing for the one frame the move
 * takes, opens the same page in Profil or Garage with that tab's root below it (back goes to Profil or Garage), and empties the tab the
 * link fell into, so that tab shows its own root when the member goes there next.
 */
export function LandInOwnTab({ children }: { children: ReactNode }) {
  const segments = useSegments() as readonly string[];
  const pathname = usePathname();
  const navigation = useNavigation();
  const router = useRouter();
  const done = useRef(false);
  const [target] = useState(() => {
    const landing = insightsLanding(pathname, landingSearch());
    const elsewhere = landing !== null && segments[0] === TABS_GROUP && segments[1] !== undefined && segments[1] !== landing.group;
    return elsewhere && isLandingPath(pathname) ? landing : null;
  });

  useEffect(() => {
    if (done.current || !target) return;
    done.current = true;
    router.navigate(target.href as Href, { withAnchor: true });
    // The tab the link fell into goes back to its root (its anchor), without the statistics on top.
    if (navigation.canGoBack()) navigation.dispatch({ type: 'POP_TO_TOP' });
    // Once, on mount: the move is decided by the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return target ? null : children;
}
