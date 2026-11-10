import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';

/** UI-only permission check from `staff.permissions` (06 §1.3: the server is the authority). */
export function usePermissions() {
    const page = usePage();
    const atoms = computed(() => new Set(page.props.staff?.permissions ?? []));

    return {
        can: (atom: string | null | undefined): boolean => atom === null || atom === undefined || atoms.value.has(atom),
        canAny: (list: string[]): boolean => list.some((atom) => atoms.value.has(atom)),
    };
}
