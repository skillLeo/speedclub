import { useNavigation, usePreventRemove, type NavigationAction } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/state/session';

import { Dialog } from './Dialog';

export type DiscardGuardDialogProps = {
  /** While true, leaving the screen asks first. React Hook Form: `formState.isDirty`. */
  dirty: boolean;
  /** Runs before the blocked navigation continues, for example to clear a draft. */
  onDiscard?: () => void;
  title?: string;
  body?: string;
  discardLabel?: string;
  keepLabel?: string;
  /** Sub-testIDs: `.keep`, `.discard`, and those of Dialog. */
  testID?: string;
};

/**
 * Dirty forms intercept every way back (§9): header, Android back, iOS edge swipe, web history, and a close that removes
 * the whole modal group from the root (useCloseModal). `usePreventRemove` also sets the browser's own warning for closing
 * or reloading the tab. Render it once inside the form's screen.
 *
 * Verwerfen continues the blocked action itself rather than through the hook's `repeat`, which re-dispatches from this
 * screen's navigation. That changes two things about an action a parent navigator received, as the wizard's close does:
 * - it stamps this screen's route key as `source` when the action had none, and a stack reads `source` on a targeted
 *   REPLACE/POP/GO_BACK as the route to act on. useCloseModal's `router.replace` targets the root stack, where this key
 *   does not exist, so the repeat came back unhandled: the dialog closed, the wizard stayed, the guard was off.
 * - it starts an untargeted action (a root `goBack`) from this screen's own navigator, which pops a screen of its own
 *   instead of the modal group when it can.
 * So the action keeps its own `source`, and an untargeted one is addressed to the navigator that removed this screen: the
 * outermost ancestor route that reported the same blocked action. Actions the screen sent itself are unchanged.
 *
 * Nothing is guarded while the session changes hands (BH-28, `memberChanged`): the form and its values belong to the previous
 * member, the new one cannot keep them, so the screens go without "Änderungen verwerfen?".
 */
export function DiscardGuardDialog({
  dirty,
  onDiscard,
  title,
  body,
  discardLabel,
  keepLabel,
  testID,
}: DiscardGuardDialogProps) {
  const { t } = useTranslation('common');
  const navigation = useNavigation();
  const [blocked, setBlocked] = useState<NavigationAction | null>(null);
  const [discarded, setDiscarded] = useState(false);
  // Blocked action → key of the navigator that handled it, when that is an ancestor of this screen's own navigator.
  const handlers = useRef(new WeakMap<NavigationAction, { key: string; depth: number }>());

  const memberChanged = useSessionStore((state) => state.memberChanged);
  const release = usePreventRemove(dirty && !discarded && !memberChanged, ({ data }) => setBlocked(data.action));

  // A removal blocked here is reported to every guarded route it removes: this screen and each ancestor route up to the
  // one inside the navigator that handled the action. The outermost of them names that navigator.
  useEffect(() => {
    const unsubscribe: (() => void)[] = [];
    let depth = 0;
    for (let route = navigation.getParent(); route; route = route.getParent()) {
      const level = ++depth;
      const node = route;
      unsubscribe.push(
        node.addListener('removePrevented', (event) => {
          const { action } = event.data;
          const known = handlers.current.get(action);
          const key = node.getState()?.key;
          if (key && (!known || known.depth < level)) handlers.current.set(action, { key, depth: level });
        }),
      );
    }
    return () => unsubscribe.forEach((stop) => stop());
  }, [navigation]);

  const discard = () => {
    const action = blocked;
    onDiscard?.();
    setDiscarded(true);
    setBlocked(null);
    if (!action) return;
    const target = action.target ?? handlers.current.get(action)?.key;
    // Lets go of the guard before the action is queued, then sends it as it was blocked (see above).
    release();
    navigation.dispatch({ ...action, source: action.source, ...(target === undefined ? null : { target }) });
  };

  return (
    <Dialog
      visible={blocked !== null}
      onClose={() => setBlocked(null)}
      title={title ?? t('discard.title')}
      body={body ?? t('discard.body')}
      testID={testID}
      actions={[
        {
          label: keepLabel ?? t('discard.keep'),
          variant: 'secondary',
          onPress: () => setBlocked(null),
          testID: testID ? `${testID}.keep` : undefined,
        },
        {
          label: discardLabel ?? t('discard.confirm'),
          destructive: true,
          onPress: discard,
          testID: testID ? `${testID}.discard` : undefined,
        },
      ]}
    />
  );
}
