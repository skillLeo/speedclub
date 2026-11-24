import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { isViewAsTab } from '@/api/clientViewAs';
import { useMe } from '@/api/queries/auth';
import { qa } from '@/lib/qa';
import { useSessionStore } from '@/state/session';

import { introDue } from './api';
import { INTRO_PATH, shouldOpenIntro } from './trigger';

/** An automated browser (`navigator.webdriver`) or any QA override: a named screen is being looked at, nothing opens by itself. */
function automated(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) return true;
  return Object.keys(qa).length > 0;
}

/**
 * R4-1.4: opens INTRO-01 once the session has settled where the member belongs (SessionHost's routing ran), at most once per member
 * and app session. Lives in SessionHost, beside the other session prompts.
 */
export function useIntroTrigger(ready: boolean): void {
  const pathname = usePathname();
  const status = useSessionStore((state) => state.status);
  const nextStep = useSessionStore((state) => state.member?.nextStep);
  const memberId = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? null) : null));
  const memberChanged = useSessionStore((state) => state.memberChanged);
  const { data: me } = useMe();
  const openedFor = useRef<string | null>(null);
  const due = introDue(me) && me?.id === memberId;

  useEffect(() => {
    if (!ready || memberChanged || memberId === null) return undefined;
    const open = shouldOpenIntro({
      status,
      nextStep,
      pathname,
      due,
      opened: openedFor.current === memberId,
      suppressed: automated() || isViewAsTab(),
    });
    if (!open) return undefined;
    // A tick later, as the session routing: a navigation it started lands first.
    const timer = setTimeout(() => {
      openedFor.current = memberId;
      router.push(INTRO_PATH as Href);
    }, 0);
    return () => clearTimeout(timer);
  }, [due, memberChanged, memberId, nextStep, pathname, ready, status]);
}
