import { router, usePage } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../../composables/recentPassword';

/**
 * The draft → preview → publish (reason) flow of the M3.5 config editors (06 §1.5; ADM-28, 29, 30, 37), on the props of
 * App\Http\Controllers\Admin\Config\Support\ConfigEditor. The form is a copy of the payload; saving sends it whole with the draft
 * revision the page loaded (409 stale_revision / draft_taken come back as the error `refused`); the server's field errors name payload
 * paths ("featured.0.ends_at"). Leaving the page with unsaved changes asks first (discard guard).
 */
export interface DraftInfo {
    id: number;
    version: number;
    revision: number;
    updated_at: string | null;
    author: string | null;
    mine: boolean;
}

export interface VersionInfo {
    version: number;
    status: 'published' | 'superseded';
    published_at: string | null;
    published_by: string | null;
    reason: string | null;
}

export interface EditorProps<P> {
    payload: P;
    draft: DraftInfo | null;
    live: VersionInfo | null;
    approval: { id: string; title: string | null; expires_at: string } | null;
    needsApproval: string | null;
    can: { edit: boolean; publish: boolean };
}

export interface DraftUrls {
    save: string;
    discard: string;
    publish: string;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function useConfigDraft<P extends object>(editor: () => EditorProps<P>, urls: DraftUrls, options: { sensitiveDraft?: boolean } = {}) {
    const page = usePage();
    const form = ref(clone(editor().payload)) as Ref<P>;
    const baseline = ref(JSON.stringify(editor().payload));
    const errors = ref<Record<string, string>>({});
    const processing = ref<'save' | 'publish' | 'discard' | null>(null);

    watch(
        () => editor().payload,
        (payload) => {
            form.value = clone(payload);
            baseline.value = JSON.stringify(payload);
        },
    );

    const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
    /** Someone else's draft, or one waiting for its second person: shown, not edited. */
    const foreign = computed(() => editor().draft !== null && !editor().draft!.mine);
    const readOnly = computed(() => !editor().can.edit || foreign.value || editor().approval !== null);
    const refused = computed(() => errors.value.refused ?? null);

    function visit(kind: 'save' | 'publish' | 'discard', method: 'post' | 'delete', url: string, data: Record<string, unknown>, sensitive: boolean, onSuccess?: () => void): void {
        const go = (): void => {
            router.visit(url, {
                method,
                data: data as never,
                preserveScroll: true,
                preserveState: true,
                onStart: () => (processing.value = kind),
                onFinish: () => (processing.value = null),
                onSuccess: (next) => {
                    if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                    errors.value = {};
                    onSuccess?.();
                },
                onError: (bag) => (errors.value = bag),
            });
        };
        if (sensitive && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
        else go();
    }

    function save(onSuccess?: () => void): void {
        visit('save', 'post', urls.save, { payload: form.value, revision: editor().draft?.revision ?? null }, options.sensitiveDraft === true, onSuccess);
    }

    function publish(reason: string, onSuccess?: () => void): void {
        visit('publish', 'post', urls.publish, { reason, revision: editor().draft?.revision ?? 0 }, true, onSuccess);
    }

    function discard(reason: string | null, onSuccess?: () => void): void {
        visit('discard', 'delete', urls.discard, reason === null ? {} : { reason }, options.sensitiveDraft === true, onSuccess);
    }

    function revert(): void {
        form.value = JSON.parse(baseline.value) as P;
        errors.value = {};
    }

    /** First error under a payload path ("heroes.welcome" matches "heroes.welcome.asset_id"). */
    function errorAt(path: string): string | null {
        const exact = errors.value[path];
        if (exact !== undefined) return exact;
        const nested = Object.entries(errors.value).find(([key]) => key.startsWith(`${path}.`));
        return nested?.[1] ?? null;
    }

    const { guardOpen, leave, setGuard } = useLeaveGuard(dirty);

    return { form, dirty, foreign, readOnly, errors, refused, processing, save, publish, discard, revert, errorAt, guardOpen, leave, setGuard };
}

/** Discard guard: a navigation away from the page with unsaved changes waits for a confirmation (`guardOpen` → `leave()`). */
export function useLeaveGuard(dirty: Readonly<Ref<boolean>>) {
    const guardOpen = ref(false);
    let pendingUrl: string | null = null;
    let leaving = false;
    let off: (() => void) | null = null;
    function beforeUnload(event: BeforeUnloadEvent): void {
        if (dirty.value) event.preventDefault();
    }
    onMounted(() => {
        window.addEventListener('beforeunload', beforeUnload);
        off = router.on('before', (event) => {
            const target = event.detail.visit;
            if (leaving || !dirty.value || target.method !== 'get' || target.url.pathname === window.location.pathname) return;
            pendingUrl = target.url.href;
            guardOpen.value = true;
            event.preventDefault();
        });
    });
    onBeforeUnmount(() => {
        window.removeEventListener('beforeunload', beforeUnload);
        off?.();
    });
    function leave(): void {
        guardOpen.value = false;
        if (pendingUrl === null) return;
        leaving = true;
        router.visit(pendingUrl);
    }
    function setGuard(open: boolean): void {
        guardOpen.value = open;
    }
    return { guardOpen, leave, setGuard };
}

export type ConfigDraft<P extends object> = ReturnType<typeof useConfigDraft<P>>;
