import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue';

/**
 * The SplitQueue of 09 §10.2, shared by the review queues (ADM-55 Betriebe; the pattern of ADM-53): the list on the left, the selected
 * item in a right pane (`?<param>=<id>`, a partial visit of `selected` + `decided`), one-key decisions, a 5-s undo and auto-advance.
 *
 * Keys (never while typing, with a dialog or a menu open, or with a modifier): j/k next/previous, a approve, r reject, u undo. They only
 * work from 1280 px, where the pane sits beside the list (`enabled`).
 */
export interface Decided {
    id: string;
    outcome: string;
    version: string;
}

export interface SplitQueueOptions<Row extends { id: string }, D extends Decided> {
    /** Query parameter that names the selected item, e.g. `business`. */
    param: string;
    url: () => string;
    rows: () => Row[];
    /** The server's record of the selected item (null for an unknown id: "gone"). */
    selected: () => { id: string } | null | undefined;
    decided: () => D | null | undefined;
    /** Outcomes that offer the 5-s undo. */
    undoable: string[];
    /** Whether a decision moves on to the next item (the tab that holds the open items). */
    advance: () => boolean;
    /** Keyboard and split layout on (from 1280 px). */
    enabled: Ref<boolean>;
    onApprove: () => void;
    onReject: () => void;
    onUndo: () => void;
}

export interface SplitQueue<D extends Decided> {
    selectedId: ComputedRef<string | null>;
    paneOpen: ComputedRef<boolean>;
    split: ComputedRef<boolean>;
    lastDecided: Ref<D | null>;
    select: (id: string | null) => void;
    paneHref: (id: string) => string;
    /** Returns the callback that opens the item after `id` (or the one before the last) once its decision succeeded. */
    advanceFrom: (id: string) => () => void;
    clearUndo: () => void;
}

const TYPING = 'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"]';

export function isTyping(event: KeyboardEvent): boolean {
    const target = event.target;
    return target instanceof Element && target.closest(TYPING) !== null;
}

export function useSplitQueue<Row extends { id: string }, D extends Decided>(options: SplitQueueOptions<Row, D>): SplitQueue<D> {
    const page = usePage();
    // The page URL (reactive), so a pane closed or switched by a partial visit is seen at once.
    const selectedId = computed(() => options.selected()?.id ?? new URLSearchParams(page.url.split('?')[1] ?? '').get(options.param));
    const paneOpen = computed(() => selectedId.value !== null);
    const split = computed(() => options.enabled.value && paneOpen.value);

    function paneHref(id: string): string {
        const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
        params.set(options.param, id);
        return `${options.url()}?${params.toString()}`;
    }

    function select(id: string | null): void {
        const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        if (id === null) delete params[options.param];
        else params[options.param] = id;
        router.get(options.url(), params, { only: ['selected', 'decided'], preserveState: true, preserveScroll: true, replace: true });
    }

    function neighbour(step: 1 | -1): string | null {
        const list = options.rows();
        if (list.length === 0) return null;
        const index = list.findIndex((row) => row.id === selectedId.value);
        if (index === -1) return list[0]?.id ?? null;
        return list[index + step]?.id ?? null;
    }

    function advanceFrom(id: string): () => void {
        const list = options.rows();
        const index = list.findIndex((row) => row.id === id);
        const next = list[index + 1]?.id ?? list[index - 1]?.id ?? null;
        return () => {
            if (options.advance()) select(next);
        };
    }

    const lastDecided = ref<D | null>(null) as Ref<D | null>;
    let undoTimer: number | undefined;
    watch(
        options.decided,
        (decided) => {
            if (!decided || !options.undoable.includes(decided.outcome)) return;
            lastDecided.value = decided;
            window.clearTimeout(undoTimer);
            undoTimer = window.setTimeout(() => (lastDecided.value = null), 5000);
        },
        { immediate: true },
    );
    function clearUndo(): void {
        window.clearTimeout(undoTimer);
        lastDecided.value = null;
    }

    function onKey(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !options.enabled.value || isTyping(event)) return;
        const key = event.key.toLowerCase();
        if (key === 'j' || key === 'k') {
            const id = neighbour(key === 'j' ? 1 : -1);
            if (id !== null) select(id);
        } else if (key === 'a') options.onApprove();
        else if (key === 'r') options.onReject();
        else if (key === 'u') options.onUndo();
        else return;
        event.preventDefault();
    }
    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKey);
        window.clearTimeout(undoTimer);
    });

    return { selectedId, paneOpen, split, lastDecided, select, paneHref, advanceFrom, clearUndo };
}

/**
 * The writes of a review record with their optimistic lock (ADR-439): every post carries the version the page shows. A changed item
 * answers the error `version` = `<ns>.conflict.changed` (`conflict` is set, the page offers a reload), a decided one the error `state`.
 */
export function useDecisionWrites<A extends string>(ns: string, url: (id: string, action: A) => string) {
    const processing = ref<A | null>(null) as Ref<A | null>;
    const conflict = ref(false);
    const error = ref<string | null>(null);

    function post(item: { id: string; version: string | null }, action: A, data: { reason?: string | null } = {}, onSuccess?: () => void): void {
        router.post(url(item.id, action), { ...data, version: item.version ?? '' } as never, {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                processing.value = action;
                conflict.value = false;
                error.value = null;
            },
            onFinish: () => (processing.value = null),
            onSuccess: (page) => {
                const errors = (page.props.errors ?? {}) as Record<string, string>;
                if (Object.keys(errors).length === 0) onSuccess?.();
            },
            onError: (errors) => {
                if (errors.version === `${ns}.conflict.changed`) {
                    conflict.value = true;
                    return;
                }
                const first = errors.reason ?? errors.state ?? errors.version ?? Object.values(errors)[0] ?? null;
                error.value = first === null ? null : first.startsWith(`${ns}.`) ? trans(first) : first;
            },
        });
    }

    function reload(only?: string[]): void {
        conflict.value = false;
        error.value = null;
        router.reload(only ? { only } : {});
    }

    return { processing, conflict, error, post, reload };
}
