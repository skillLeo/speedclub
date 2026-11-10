<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { formatNumber } from '../../lib/format';
import { qaState } from '../../lib/qa';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, isCurrentRoute, routeOr } from '../../lib/routes';
import { navigation, type NavItem } from '../../modules/registry';
import { focusRing } from '../ui/styles';

/** The 13 groups of 03 §14, each with the entries this staff member may open. Groups without an entry are not shown. */
const emit = defineEmits<{ navigate: [] }>();
const page = usePage();
const { can, canAny } = usePermissions();

const sections = computed(() => {
    void page.url;
    return navigation((atom) => (Array.isArray(atom) ? canAny(atom) : can(atom)), hasRoute);
});

function active(item: NavItem): boolean {
    void page.url;
    return isCurrentRoute(item.match ?? item.route);
}

function badge(item: NavItem): number {
    if (item.badge === undefined) return 0;
    // A page forced into its empty state (?qaState=empty) shows nothing waiting, so its own entry does not count either (DQ-518).
    if (qaState() === 'empty' && active(item)) return 0;
    return page.props.nav_counts[item.badge];
}
</script>

<template>
    <nav :aria-label="trans('shell.nav.label')" class="flex flex-col gap-16" data-testid="shell.nav">
        <section v-for="section in sections" :key="section.group" :aria-labelledby="`nav-group-${section.group}`" class="flex flex-col gap-2">
            <h2 :id="`nav-group-${section.group}`" class="px-8 pb-4 text-caption text-ink-3">{{ trans(`shell.groups.${section.group}`) }}</h2>
            <ul class="flex flex-col gap-2">
                <li v-for="item in section.items" :key="item.route">
                    <Link
                        :href="routeOr(item.route, '/admin')"
                        :aria-current="active(item) ? 'page' : undefined"
                        :class="[
                            focusRing,
                            'relative flex h-32 items-center gap-12 rounded-sm px-8 text-label-s transition-colors duration-150 ease-standard',
                            active(item) ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                        ]"
                        :data-testid="`shell.nav.${item.testId}`"
                        @click="emit('navigate')"
                    >
                        <span v-if="active(item)" class="absolute inset-y-8 left-0 w-2 rounded-full bg-accent" aria-hidden="true" />
                        <component :is="item.icon" :size="16" :weight="active(item) ? 'fill' : 'regular'" aria-hidden="true" />
                        <span class="flex-1 truncate">{{ trans(item.label) }}</span>
                        <span v-if="badge(item) > 0" class="min-w-20 rounded-xs border border-accent px-4 text-center text-badge text-accent tabular-nums">
                            {{ formatNumber(badge(item)) }}<span class="sr-only">{{ trans('shell.nav.badge') }}</span>
                        </span>
                    </Link>
                </li>
            </ul>
        </section>
    </nav>
</template>
