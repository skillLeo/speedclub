import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../../composables/recentPassword';

/**
 * The draft → preview → publish flow of the M3.5 config editors (06 §1.5; ADM-28, 29, 30, 37), on the props of
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
    /** A pending four-eyes request for the draft; M5.1: who can approve it and whether the viewer may override it (ADR-507). */
    approval: { id: string; title: string | null; expires_at: string; approvers?: string[]; approvers_total?: number; override?: boolean } | null;
    needsApproval: string | null;
    can: { edit: boolean; publish: boolean };
}

export interface DraftUrls {
    save: string;
    discard: string;
    publish: string;
    /** M5.1 "Entwurf übernehmen"; defaults to `<save>/take-over` (every draft route is `…/draft`). */
    takeOver?: string;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function useConfigDraft<P extends object>(editor: () => EditorProps<P>, urls: DraftUrls, options: { sensitiveDraft?: boolean } = {}) {
    const page = usePage();
    const form = ref(clone(editor().payload)) as Ref<P>;
    const baseline = ref(JSON.stringify(editor().payload));
    const errors = ref<Record<string, string>>({});
    const processing = ref<'save' | 'publish' | 'discard' | 'takeOver' | null>(null);

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
    /**
     * M5.1: the first server error of the last write, whatever its field. A publish re-validates the whole draft (the world may have
     * changed since it was saved: an asset, a build that went private), so its errors can name payload paths that only the form shows;
     * the publish dialog used to show just `refused` and stayed silent on those.
     */
    const firstError = computed(() => refused.value ?? Object.values(errors.value)[0] ?? null);
    const payloadError = computed(() => Object.keys(errors.value).some((key) => key !== 'refused' && key !== 'revision'));

    function visit(kind: 'save' | 'publish' | 'discard' | 'takeOver', method: 'post' | 'delete', url: string, data: Record<string, unknown>, sensitive: boolean, onSuccess?: () => void): void {
        const go = (): void => {
            router.visit(url, {
                method,
                data: data as never,
                preserveScroll: true,
                preserveState: true,
                onStart: () => {
                    processing.value = kind;
                    errors.value = {};
                },
                onFinish: () => (processing.value = null),
                onSuccess: (next) => {
                    if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) {
                        // The server found the confirmation stale (ADR-215). The shell's FlashCenter has already opened the password
                        // dialog for a bare repeat of the request; this repeat replaces it, so the answer lands here again (the dialog
                        // closes on success, an error shows in it) instead of on a dialog that stays open with nothing in it.
                        confirmPasswordFirst(go);
                        return;
                    }
                    errors.value = {};
                    onSuccess?.();
                },
                onError: (bag) => (errors.value = bag),
                // Staging 2026-11-19 (Owner, ADM-28 "Veröffentlichen"): a request that gets no answer from the app (connection dropped
                // or refused by the host under its process/connection limits) ended the visit without a callback: the dialog stayed
                // as it was, the button stopped spinning and nothing said why. Both cases now name it where the click was.
                onNetworkError: () => {
                    errors.value = { refused: trans('config.draft.connection_lost') };
                    return false;
                },
                // A host error page instead of the app's answer (5xx HTML, an empty 503): said in the dialog instead of Inertia's raw
                // modal over it. The app's own error pages (Inertia responses, ADM-05) still render as pages.
                onHttpException: (response) => {
                    if (Object.keys(response.headers).some((name) => name.toLowerCase() === 'x-inertia')) return;
                    errors.value = { refused: trans('ui.state.server_error') };
                    return false;
                },
            });
        };
        if (sensitive && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
        else go();
    }

    function save(onSuccess?: () => void): void {
        visit('save', 'post', urls.save, { payload: form.value, revision: editor().draft?.revision ?? null }, options.sensitiveDraft === true, onSuccess);
    }

    function publish(onSuccess?: () => void): void {
        visit('publish', 'post', urls.publish, { revision: editor().draft?.revision ?? 0 }, true, onSuccess);
    }

    function discard(onSuccess?: () => void): void {
        visit('discard', 'delete', urls.discard, {}, options.sensitiveDraft === true, onSuccess);
    }

    function takeOver(onSuccess?: () => void): void {
        visit('takeOver', 'post', urls.takeOver ?? `${urls.save}/take-over`, { revision: editor().draft?.revision ?? 0 }, true, onSuccess);
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

    return { form, dirty, foreign, readOnly, errors, refused, firstError, payloadError, processing, save, publish, discard, takeOver, revert, errorAt, guardOpen, leave, setGuard };
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
