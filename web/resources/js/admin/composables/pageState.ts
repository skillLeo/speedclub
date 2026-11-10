import { computed, type ComputedRef } from 'vue';
import { qaState, type QaState } from '../lib/qa';
import { qaDialog } from './qaDialog';

export type PageState = QaState | 'ready' | 'first-run' | 'forbidden' | 'partial';

/**
 * The state a page shows: ?qaState= (outside production) wins over the real one. Put it on the page root as data-qa-state.
 * With `?dialog=` the forced state belongs to that overlay (qaDialog), so the page itself stays ready.
 */
export function usePageState(real: () => PageState = () => 'ready'): ComputedRef<PageState> {
    return computed(() => (qaDialog() === null ? qaState() : null) ?? real());
}

/** The forced server error of a `?dialog=` overlay: `?qaState=error` together with `?dialog=`. */
export function qaDialogFailed(): boolean {
    return qaDialog() !== null && qaState() === 'error';
}
