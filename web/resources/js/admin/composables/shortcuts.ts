import { router } from '@inertiajs/vue3';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { usePermissions } from '../lib/permissions';
import { hasRoute, routeOr } from '../lib/routes';
import { qaDialog } from './qaDialog';
import { isTyping } from './splitQueue';

/**
 * Global keyboard shortcuts of the shell (09 §10.2): `g` then a letter goes to a section the staff member may open, `/` focuses the
 * page's first filter field, `?` opens the cheat sheet. Never while typing, with a dialog or menu open, or with a modifier. Row keys
 * (j/k, x, e) belong to DataTable, decisions (a/r/u) to the SplitQueues.
 */
export interface GoTarget {
    key: string;
    route: string;
    atom: string;
    /** i18n key of the section */
    label: string;
}

export const GO_TARGETS: GoTarget[] = [
    { key: 'm', route: 'admin.members.index', atom: 'members.view', label: 'members.nav.title' },
    { key: 'v', route: 'admin.vehicles.index', atom: 'vehicles.view', label: 'vehicles.nav.title' },
    { key: 'q', route: 'admin.moderation.reports', atom: 'moderation.view', label: 'moderation.nav.reports' },
    { key: 'e', route: 'admin.events.queue', atom: 'moderation.view', label: 'events.nav.title' },
    { key: 'b', route: 'admin.businesses.queue', atom: 'moderation.view', label: 'businesses.nav.title' },
    { key: 'd', route: 'admin.dashboard', atom: '', label: 'shell.nav.dashboard' },
];

/** The 1.5 s window after `g` in which the second letter counts. */
const CHORD_MS = 1500;

export function useShortcuts() {
    const { can } = usePermissions();
    // `?dialog=shortcuts` (outside production): the cheat sheet opens on load for the visual matrix.
    const sheet = ref(qaDialog() === 'shortcuts');
    const pending = ref(false);
    let timer: number | undefined;

    const available = (): GoTarget[] => GO_TARGETS.filter((t) => hasRoute(t.route) && (t.atom === '' || can(t.atom)));

    function focusFilter(): boolean {
        const main = document.getElementById('main');
        const field = main?.querySelector<HTMLElement>('form[aria-label] input:not([type="hidden"]):not(:disabled), [role="search"] input');
        if (!field) return false;
        field.focus();
        if (field instanceof HTMLInputElement) field.select();
        return true;
    }

    function onKey(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return;
        const key = event.key;
        if (pending.value) {
            // The second key of a chord is always consumed, so a row or queue key never fires on it.
            pending.value = false;
            window.clearTimeout(timer);
            event.preventDefault();
            const target = available().find((t) => t.key === key.toLowerCase());
            if (target) router.visit(routeOr(target.route, '/admin'));
            return;
        }
        if (key === 'g') {
            pending.value = true;
            timer = window.setTimeout(() => (pending.value = false), CHORD_MS);
            event.preventDefault();
        } else if (key === '?') {
            sheet.value = true;
            event.preventDefault();
        } else if (key === '/') {
            if (focusFilter()) event.preventDefault();
        }
    }

    // Capture phase: the shell sees a key before the page's own listeners (children mount first), so a chord wins over row keys.
    onMounted(() => window.addEventListener('keydown', onKey, { capture: true }));
    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKey, { capture: true });
        window.clearTimeout(timer);
    });

    return { sheet, pending, available };
}
