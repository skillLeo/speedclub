import { router } from 'expo-router';
import { useTabTrigger } from 'expo-router/ui';
import { useCallback } from 'react';

import { isWeb } from '@/lib/platform';

import { TAB_DESTINATIONS, type TabName } from './destinations';
import { runRetap } from './retap';

type PressEvent = {
  preventDefault?: () => void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
};

/** The browser keeps ctrl-click and middle-click on a tab link: they open a new tab, not a re-tap. */
function opensElsewhere(event: PressEvent | null | undefined): boolean {
  if (!isWeb || !event) return false;
  return Boolean(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button ?? 0) !== 0);
}

/**
 * What every bar needs from the tab navigator: which tab is active, and the press handler that adds re-tap. A press on
 * another tab falls through to TabTrigger, which keeps that tab's stack.
 */
export function useTabNavigation() {
  const first = TAB_DESTINATIONS[0]?.name ?? 'home';
  const { getTrigger } = useTabTrigger({ name: first });
  const activeIndex = Math.max(
    0,
    TAB_DESTINATIONS.findIndex((destination) => getTrigger(destination.name)?.isFocused),
  );

  const pressHandler = useCallback(
    (name: TabName) => (event: PressEvent | null | undefined) => {
      const trigger = getTrigger(name);
      if (!trigger?.isFocused || opensElsewhere(event)) return;
      // Stops TabTrigger's own handling: it would navigate to the href of a tab that is already showing.
      event?.preventDefault?.();
      // POP_TO_TOP bubbles to the root stack when this stack has nothing to pop, so the depth is checked first.
      runRetap(trigger.route?.state?.routes.length ?? 1, () => router.dismissAll());
    },
    [getTrigger],
  );

  return { activeIndex, pressHandler };
}
