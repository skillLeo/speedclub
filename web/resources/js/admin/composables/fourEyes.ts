import { usePage } from '@inertiajs/vue3';
import { computed, type ComputedRef } from 'vue';

/**
 * ADR-540 (client decision 2026-11-23): the four-eyes rule is a governance setting, off by default. While it is off every action that
 * would ask for an approval runs at once, so no page shows a pending-approval notice, badge or "Freigabe anfragen" label. The server
 * shares the switch as `governance.four_eyes` (HandleInertiaRequests); a page without it (an old response) reads it as on, so nothing
 * that still waits for a second person is hidden.
 */
export function fourEyesOn(props: { governance?: { four_eyes?: boolean } | null } | undefined): boolean {
    return props?.governance?.four_eyes !== false;
}

export function useFourEyes(): ComputedRef<boolean> {
    const page = usePage();
    return computed(() => fourEyesOn(page.props as { governance?: { four_eyes?: boolean } | null }));
}
