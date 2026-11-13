import { ref } from 'vue';
import { qaEnabled } from './qa';

/**
 * The sidebar's collapsed state (09 §10.1: collapsible sidebar 240, here to a 64 rail with icons and tooltips). Per browser; the
 * drawer below 1024 px is always expanded. `?qaSidebar=collapsed` (outside production) forces the rail for the visual matrix.
 */
const KEY = 'sc-admin-sidebar';

export const sidebarCollapsed = ref(false);

export function initSidebar(): void {
    const forced = qaEnabled() ? new URLSearchParams(window.location.search).get('qaSidebar') : null;
    if (forced === 'collapsed' || forced === 'expanded') {
        sidebarCollapsed.value = forced === 'collapsed';
        return;
    }
    try {
        sidebarCollapsed.value = window.localStorage.getItem(KEY) === 'collapsed';
    } catch {
        sidebarCollapsed.value = false;
    }
}

export function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    try {
        window.localStorage.setItem(KEY, sidebarCollapsed.value ? 'collapsed' : 'expanded');
    } catch {
        // Private mode: the choice lasts for this page only.
    }
}
