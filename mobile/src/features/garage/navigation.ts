import { useNavigation, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useScreenFocused } from '@/ui/SkeletonFocus';

import type { WizardStep } from './model';
import { markWizardPublished, whenWizardGuardsReleased } from './wizardGuards';

/** The wizard's routes: `/add-vehicle/new/vehicle` until the first save, then the draft's id. */
export function wizardPath(draftId: string, step: WizardStep): Href {
  return `/add-vehicle/${draftId}/${step}` as Href;
}

/** What a garage route reads of the navigation tree: enough to find the root stack. */
type NavigationNode = {
  getParent: () => NavigationNode | undefined;
  getState: () => { routes: readonly { name: string }[] } | undefined;
  canGoBack: () => boolean;
  goBack: () => void;
};

/** The route of the app's root stack (src/app/_layout.tsx) that presents the modal group. */
const MODAL_GROUP = '(modals)';

/**
 * The app's root stack: the navigator that presents `(modals)`. The walk stops there, because expo-router keeps its own
 * container above it, which can never go back: a close aimed at that one always fell through to the fallback and replaced
 * the history entry instead of going back.
 */
function modalPresenter(navigation: NavigationNode): NavigationNode | undefined {
  for (let node: NavigationNode | undefined = navigation; node; node = node.getParent()) {
    if (node.getState()?.routes.some((route) => route.name === MODAL_GROUP)) return node;
  }
  return undefined;
}

/**
 * Closes the whole modal group (wizard, GAR-04) in one step, whatever it holds: the root stack presents `(modals)` as one
 * route (04_SCREEN_REGISTER §2), so its back removes every screen inside, each through its own discard guard. A direct link
 * into the wizard has nothing below it and lands on the garage.
 */
export function useCloseModal(fallback: Href = '/garage') {
  const navigation = useNavigation<NavigationNode>();
  const router = useRouter();
  return useCallback(() => {
    const root = modalPresenter(navigation);
    if (root?.canGoBack()) root.goBack();
    else router.replace(fallback);
  }, [fallback, navigation, router]);
}

/**
 * GAR-03 → GAR-04. All four steps live in one `add-vehicle/[draftId]` route of the modal group's stack, so replacing that
 * route leaves the success screen alone in the group: neither a back gesture nor Android back returns into the wizard.
 */
export function useReplaceWizardWithPublished() {
  const router = useRouter();
  return useCallback((vehicleId: string) => router.replace({ pathname: '/published/[vehicleId]', params: { vehicleId } }), [router]);
}

/**
 * R4B-L01: a step of a published draft never shows the wizard again; it leaves the wizard the way its close does (useCloseModal),
 * to the screen it was opened from, or to the garage when nothing is below it. On the web GAR-04 replaces only the review's entry:
 * the browser keeps one entry per step pushed before it, and its back restored the finished wizard there. A direct link to a step of
 * a published car leaves the same way. Only the step on show leaves: while the review publishes, the steps under it are not focused,
 * and GAR-04's replace is the one move (R4B-005). Each step's guard lets go first (wizardGuards). Returns whether the step leaves:
 * it then shows its skeleton, never the form.
 */
export function useLeavePublishedWizard(draftId: string, published: boolean): boolean {
  const focused = useScreenFocused();
  const close = useCloseModal();
  // Once per step: a later render (a new `close`) must not close the modal a second time.
  const left = useRef(false);
  useEffect(() => {
    if (!published || !focused || left.current) return undefined;
    markWizardPublished(draftId);
    return whenWizardGuardsReleased(draftId, () => {
      left.current = true;
      close();
    });
  }, [close, draftId, focused, published]);
  return published;
}

/**
 * UPD-01 "Update posten" for one vehicle (09 §7.6). The modal route `/post-update` is built by the lead in M4.9; until its file
 * exists the typed routes do not know it, hence the cast (the shape is the one the route reads: `vehicleId`).
 */
export function postUpdateHref(vehicleId: string): Href {
  return { pathname: '/post-update', params: { vehicleId } } as unknown as Href;
}
