import { ref } from 'vue';
import { qaTheme, reportQaTheme } from './qa';

/** Admin themes (03 §14): Carbon (default) and Hell. Stored per browser, separate from the member app's theme. */
export type AdminTheme = 'carbon' | 'light';

const STORAGE_KEY = 'sc-admin-theme';

function stored(): AdminTheme {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return value === 'light' ? 'light' : 'carbon';
    } catch {
        return 'carbon';
    }
}

export const theme = ref<AdminTheme>('carbon');

/** Incremented on every change, so canvas charts can re-read the token colours. */
export const themeVersion = ref(0);

export function applyTheme(next: AdminTheme, persist = true): void {
    theme.value = next;
    document.documentElement.dataset.theme = next;
    reportQaTheme(next);
    themeVersion.value += 1;
    if (!persist) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // Private mode: the choice lasts for this page only.
    }
}

export function initTheme(): void {
    const forced = qaTheme();
    applyTheme(forced ?? stored(), false);
}

export function toggleTheme(): void {
    applyTheme(theme.value === 'carbon' ? 'light' : 'carbon');
}

/** A token's current value, e.g. cssToken('--sc-color-text-secondary'), for canvas drawing. */
export function cssToken(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
