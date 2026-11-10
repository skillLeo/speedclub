import { router, usePage } from '@inertiajs/vue3';
import { ref } from 'vue';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { firstError } from './statement';

type Method = 'post' | 'patch' | 'delete';

/**
 * One admin write from a dialog: processing and error state for the dialog, and for a ⚿ action (ADR-215) the password dialog first
 * when the last confirmation is older than 5 minutes, so the dialog's own callbacks run (the shell's repeat-the-last-write fallback
 * still covers a confirmation that lapses in between: then `onSuccess` does not fire, the dialog stays open).
 */
export function useAdminAction() {
    const page = usePage();
    const processing = ref(false);
    const error = ref<string | null>(null);

    function run(method: Method, url: string, data: Record<string, unknown>, options: { sensitive?: boolean; onSuccess?: () => void } = {}): void {
        const go = (): void => {
            router.visit(url, {
                method,
                data: data as never,
                preserveScroll: true,
                preserveState: true,
                onStart: () => {
                    processing.value = true;
                    error.value = null;
                },
                onFinish: () => (processing.value = false),
                onSuccess: (next) => {
                    if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                    options.onSuccess?.();
                },
                onError: (errors) => (error.value = firstError(errors)),
            });
        };
        if (options.sensitive === true && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
        else go();
    }

    function reset(): void {
        error.value = null;
    }

    return { processing, error, run, reset };
}
