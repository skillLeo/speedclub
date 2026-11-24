import { router, usePage } from '@inertiajs/vue3';
import { ref } from 'vue';
import { trans } from 'laravel-vue-i18n';
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
        // Client round 6: closing the password dialog without a password said nothing; now the dialog says that nothing was saved.
        const cancelled = (): void => {
            processing.value = false;
            error.value = trans('ui.state.password_cancelled');
        };
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
                    // The server found the confirmation stale (ADR-215): ask for the password and repeat this request, so its answer lands
                    // here (the dialog closes on success) instead of leaving the dialog open with nothing in it.
                    if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) {
                        confirmPasswordFirst(go, cancelled);
                        return;
                    }
                    options.onSuccess?.();
                },
                onError: (errors) => (error.value = firstError(errors)),
                // Client round 3 (staging): a request the host refused or dropped ended with no callback, so dialogs stayed as they were
                // and "nothing happened". Every admin action now says so where the click was (as configDraft.ts does since 23f38a46).
                onNetworkError: () => {
                    error.value = trans('config.draft.connection_lost');
                    return false;
                },
                onHttpException: (response) => {
                    if (Object.keys(response.headers).some((name) => name.toLowerCase() === 'x-inertia')) return;
                    error.value = trans('ui.state.server_error');
                    return false;
                },
            });
        };
        if (options.sensitive === true && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go, cancelled);
        else go();
    }

    function reset(): void {
        error.value = null;
    }

    return { processing, error, run, reset };
}
