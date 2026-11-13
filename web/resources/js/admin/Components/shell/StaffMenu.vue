<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhCaretDown, PhSignOut, PhUserCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import DropdownMenu, { type MenuEntry } from '../ui/DropdownMenu.vue';
import { focusRing } from '../ui/styles';
import { hasRoute, routeOr } from '../../lib/routes';

const page = usePage();
const staff = computed(() => page.props.staff);
const roles = computed(() => (staff.value?.roles ?? []).map((role) => trans(`shell.roles.${role}`)).join(', '));

const entries = computed<MenuEntry[]>(() => [
    ...(hasRoute('admin.account') ? [{ key: 'account', label: trans('shell.staff.account'), icon: PhUserCircle, href: routeOr('admin.account', '/admin/account'), testId: 'shell.staff.account' }] : []),
    {
        key: 'logout',
        label: trans('shell.staff.sign_out'),
        icon: PhSignOut,
        separated: hasRoute('admin.account'),
        onSelect: () => router.post(routeOr('logout', '/admin/logout')),
        testId: 'shell.staff.sign-out',
    },
]);
</script>

<template>
    <DropdownMenu v-if="staff" :items="entries" :label="staff.email">
        <template #trigger>
            <button type="button" :class="[focusRing, 'flex h-32 max-w-120 items-center gap-8 rounded-sm px-8 text-left hover:bg-hover tablet:max-w-240']" data-testid="shell.staff">
                <span class="flex min-w-0 flex-col">
                    <span class="truncate text-admin-base-strong text-ink" :title="staff.name">{{ staff.name }}</span>
                    <span class="sr-only">{{ roles }}</span>
                </span>
                <PhCaretDown :size="16" class="shrink-0 text-ink-3" aria-hidden="true" />
            </button>
        </template>
    </DropdownMenu>
</template>
