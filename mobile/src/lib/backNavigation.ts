import { useRouter, type Href } from 'expo-router';
// The screen's navigation read from its context, as ui/SkeletonFocus reads its focus: undefined outside a navigator (the dev gallery,
// Jest screens rendered without one) instead of a throw. Checked against expo-router 58.0.29.
import { NavigationContext } from 'expo-router/build/react-navigation/core/NavigationContext';
import { use, useCallback } from 'react';

type StackRoute = { name: string; params?: object };
type StackState = { index: number; routes: StackRoute[] };

function isStackState(value: unknown): value is StackState {
  return typeof value === 'object' && value !== null && 'index' in value && 'routes' in value && Array.isArray((value as StackState).routes);
}

/**
 * R4B-007 (client round 4 hunt): opened directly (a shared link, a QR, a bookmark, a reload), a nested screen sits on the tab
 * stack's initial route, which Expo Router adds under it with a copy of the screen's own parameters. `canGoBack()` is then true
 * and "Zurück" landed on that root (Entdecken with `?slug=…`, Profil with `?key=…`) instead of the screen's parent. A route that a
 * member really came from never carries every parameter of the screen above it, so only that synthetic root is treated as
 * "nothing to go back to".
 */
export function onlySyntheticRootBelow(state: unknown): boolean {
  if (!isStackState(state) || state.index !== 1) return false;
  const below = state.routes[0];
  const current = state.routes[1];
  if (!below || !current) return false;
  // Only the screen's own path parameters ("v/[slug]/gallery" → slug) decide: search parameters (the QA overrides, a share's
  // utm_…) can be on either route and say nothing about where the member came from.
  const pathParams = [...current.name.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1]).filter((name): name is string => Boolean(name));
  if (pathParams.length === 0) return false;
  const own = (current.params ?? {}) as Record<string, unknown>;
  const copied = (below.params ?? {}) as Record<string, unknown>;
  return pathParams.every((name) => own[name] !== undefined && JSON.stringify(copied[name]) === JSON.stringify(own[name]));
}

/** "discover/index" → "/discover", "index" → "/": the path of a tab's anchor route (the tab layout's unstable_settings). */
function anchorPath(name: string): string {
  return `/${name.replace(/(?:^|\/)index$/, '')}`;
}

/** A string href's path without query, fragment or trailing slash ("/discover?x=1" → "/discover"); null for an object href. */
function hrefPath(href: Href): string | null {
  if (typeof href !== 'string') return null;
  return (href.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
}

/**
 * Whether "Zurück" skips the route below for `fallback`. Only the synthetic root is ever skipped, and only for a parent deeper than
 * a tab anchor ("/v/…" for the gallery, "/u/…" for connections, "/forum" for a category). A fallback of "/" or of the tab's own
 * anchor names no parent but the tab (VEH-01, PROF-02, HOME-02): there the anchor below is the right place, ADR-101 ("a cold deep
 * link lands in Discover and back goes to the anchor"). An object href is always a specific parent.
 */
export function backSkipsSyntheticRoot(state: unknown, fallback: Href): boolean {
  if (!onlySyntheticRootBelow(state)) return false;
  const target = hrefPath(fallback);
  if (target === null) return true;
  const below = (state as StackState).routes[0];
  return target !== '/' && (below === undefined || target !== anchorPath(below.name));
}

/** Back where the member came from, or after a direct link with nothing to go back to, `fallback` (the screen's parent). */
export function useBackOr(fallback: Href): () => void {
  const router = useRouter();
  const navigation = use(NavigationContext);
  return useCallback(() => {
    if (router.canGoBack() && !backSkipsSyntheticRoot(navigation?.getState(), fallback)) router.back();
    else router.replace(fallback);
  }, [fallback, navigation, router]);
}
