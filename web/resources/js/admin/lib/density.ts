import { computed, ref } from 'vue';
import { qaEnabled } from './qa';

/**
 * Table density (09 §10.2): 40 px rows (Komfortabel, default) or 32 px rows (Kompakt), per staff member. Stored in this browser under
 * the staff id, so two staff sharing a machine keep their own choice; nothing a server needs to know. `?qaDensity=compact` (outside
 * production) forces it for the visual matrix.
 */
export type Density = 'comfortable' | 'compact';

const PREFIX = 'sc-admin-density';
let owner = 'anonymous';

export const density = ref<Density>('comfortable');

/** Row and header height classes of a 32/40 table (DataTable, list rows). */
export const rowHeight = computed(() => (density.value === 'compact' ? 'h-32' : 'h-40'));

function key(): string {
    return `${PREFIX}:${owner}`;
}

function apply(next: Density): void {
    density.value = next;
    document.documentElement.dataset.density = next;
}

export function initDensity(staffId: string | number | null | undefined): void {
    owner = staffId === null || staffId === undefined ? 'anonymous' : String(staffId);
    const forced = qaEnabled() && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('qaDensity') : null;
    if (forced === 'compact' || forced === 'comfortable') {
        apply(forced);
        return;
    }
    let stored: string | null = null;
    try {
        stored = window.localStorage.getItem(key());
    } catch {
        stored = null;
    }
    apply(stored === 'compact' ? 'compact' : 'comfortable');
}

export function setDensity(next: Density): void {
    apply(next);
    try {
        window.localStorage.setItem(key(), next);
    } catch {
        // Private mode: the choice lasts for this page only.
    }
}

export function toggleDensity(): void {
    setDensity(density.value === 'compact' ? 'comfortable' : 'compact');
}
