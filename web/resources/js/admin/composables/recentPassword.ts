import { router } from '@inertiajs/vue3';
import { ref } from 'vue';

/**
 * ADR-215: a sensitive write with a stale password confirmation comes back unchanged with the flash `confirm_password`. The shell then
 * asks for the password (PasswordConfirmDialog) and repeats the last write. Pages can also ask before the first attempt with
 * `confirmPasswordFirst()` when `staff.password_confirmed_until` has passed.
 */
interface PendingWrite {
    url: string;
    method: 'post' | 'put' | 'patch' | 'delete';
    data: Record<string, unknown>;
}

export const passwordDialogOpen = ref(false);
let lastWrite: PendingWrite | null = null;
let afterConfirm: (() => void) | null = null;

export function trackWrites(): () => void {
    return router.on('before', (event) => {
        const visit = event.detail.visit;
        if (visit.method === 'get') return;
        // A password confirmation itself is never repeated.
        if (visit.url.pathname.endsWith('/confirm-password')) return;
        lastWrite = { url: visit.url.href, method: visit.method as PendingWrite['method'], data: (visit.data ?? {}) as Record<string, unknown> };
    });
}

/** Called by the shell when the flash says the password must be confirmed. */
export function askToRepeatLastWrite(): void {
    afterConfirm = () => {
        if (lastWrite === null) return;
        const { url, method, data } = lastWrite;
        router.visit(url, { method, data: data as never, preserveScroll: true, preserveState: true });
    };
    passwordDialogOpen.value = true;
}

/** Ask for the password, then run `action` (for a page that knows the confirmation is stale). */
export function confirmPasswordFirst(action: () => void): void {
    afterConfirm = action;
    passwordDialogOpen.value = true;
}

export function passwordConfirmed(): void {
    passwordDialogOpen.value = false;
    const next = afterConfirm;
    afterConfirm = null;
    next?.();
}

export function passwordDialogCancelled(): void {
    afterConfirm = null;
}

/** Whether `staff.password_confirmed_until` is still in the future. */
export function passwordRecentlyConfirmed(until: string | null | undefined): boolean {
    return typeof until === 'string' && Date.parse(until) > Date.now();
}
