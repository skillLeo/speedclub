import { useNavigation, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

import type { WizardStep } from './model';

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
