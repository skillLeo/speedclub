import { router } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { toast } from '../Components/ui/toast';

/**
 * Client round 7 ("admin changes still don't work all the time"): a visit that gets no answer from the app (the connection dropped, or
 * the host answered with its own error page, as the shared host does under its process limits) ended without a word on every page that
 * does not handle it itself: the button stopped spinning, the dialog stayed as it was, and nothing said whether the change was saved
 * (Inertia's own answer is a modal with the host's raw HTML, or nothing at all). Rounds 3 and 6 fixed this in useAdminAction and the
 * config drafts only; every other write (shop, catalogue, legal texts, templates, badges, forum categories, bulk actions …) still went
 * silent. The shell now says it for every visit whose page did not: an error toast that stays until dismissed.
 *
 * A page that handles it (its onNetworkError / onHttpException returns false) is left alone: Inertia then fires no global event. The
 * app's own error pages (Inertia responses: 403, 404, 419, 429, 503 of ADM-05) still render as pages. A developer keeps Inertia's modal
 * with the framework's trace.
 */
export function reportVisitFailures(): () => void {
    let method = 'get';
    const offStart = router.on('start', (event) => {
        method = event.detail.visit.method;
    });
    const offNetwork = router.on('networkError', () => {
        toast('error', trans(method === 'get' ? 'ui.state.page_connection_lost' : 'ui.state.write_connection_lost'));
        // Handled: no unhandled rejection of the visit.
        return false;
    });
    const offHttp = router.on('httpException', (event) => {
        if (Object.keys(event.detail.response.headers).some((name) => name.toLowerCase() === 'x-inertia')) return;
        if (import.meta.env.DEV) return;
        toast('error', trans(method === 'get' ? 'ui.state.page_failed' : 'ui.state.server_error'));
        return false;
    });
    return () => {
        offStart();
        offNetwork();
        offHttp();
    };
}
