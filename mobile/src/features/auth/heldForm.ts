/**
 * BH-30: a form that survives the end of its session. It stays mounted, with what the member typed, until the member chooses:
 * signing in again as the same member brings it back to life, anything else drops it. A form opened as a guest never counts.
 */
import { useEffect, useState } from 'react';

import { useSessionStore } from '@/state/session';

/** How many such forms are mounted for a member. expireSession reads this before it changes anything. */
let mountedForms = 0;

export function hasHeldForm(): boolean {
  return mountedForms > 0;
}

/** For a screen that holds a form. True while the session ended under it and the member has not chosen yet. */
export function useHeldForm(): boolean {
  const status = useSessionStore((state) => state.status);
  const expiredFrom = useSessionStore((state) => state.expiredFrom);
  const [openedAsMember, setOpenedAsMember] = useState(status === 'member');
  if (status === 'member' && !openedAsMember) setOpenedAsMember(true);

  useEffect(() => {
    if (status !== 'member') return undefined;
    mountedForms += 1;
    return () => {
      mountedForms -= 1;
    };
  }, [status]);

  return openedAsMember && status === 'guest' && expiredFrom !== null;
}
