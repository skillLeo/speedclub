<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { formatNumber } from '../../lib/format';
import { qaState } from '../../lib/qa';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, isCurrentRoute, routeOr } from '../../lib/routes';
import { navigation, type NavItem } from '../../modules/registry';
import Tooltip from '../ui/Tooltip.vue';
import { focusRing } from '../ui/styles';

/**
 * The five sections of 09 §10.1 (Community · Trust & Safety · Katalog · Plattform · Governance), each with the entries this staff member
 * may open; a section without an entry is not shown. `collapsed` (the 64 rail): icons only, the label in a tooltip and for screen readers,
 * a hairline between sections instead of their headings.
 */
const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false });
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
    <nav :aria-label="trans('shell.nav.label')" class="flex flex-col" :class="props.collapsed ? 'gap-8' : 'gap-16'" data-testid="shell.nav">
        <section
            v-for="(section, index) in sections"
            :key="section.group"
            :aria-labelledby="`nav-group-${section.group}`"
            class="flex flex-col gap-2"
            :class="props.collapsed && index > 0 ? 'border-t border-line-subtle pt-8' : ''"
            :data-testid="`shell.nav.section.${section.group}`"
        >
            <h2 :id="`nav-group-${section.group}`" :class="props.collapsed ? 'sr-only' : 'px-8 pb-4 text-caption text-ink-3'">{{ trans(`shell.groups.${section.group}`) }}</h2>
            <ul class="flex flex-col gap-2">
                <li v-for="item in section.items" :key="item.route">
                    <Tooltip :content="trans(item.label)" side="right" :disabled="!props.collapsed">
                        <Link
                            :href="routeOr(item.route, '/admin')"
                            :aria-current="active(item) ? 'page' : undefined"
                            :class="[
                                focusRing,
                                'relative flex h-32 items-center rounded-sm text-admin-base-strong transition-colors duration-effect-fast ease-effect-fast',
                                props.collapsed ? 'justify-center px-0' : 'gap-12 px-8',
                                active(item) ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                            ]"
                            :data-testid="`shell.nav.${item.testId}`"
                            @click="emit('navigate')"
                        >
                            <span v-if="active(item)" class="absolute inset-y-8 left-0 w-2 rounded-full bg-ink" aria-hidden="true" />
                            <component :is="item.icon" :size="16" :weight="active(item) ? 'fill' : 'regular'" aria-hidden="true" />
                            <span :class="props.collapsed ? 'sr-only' : 'flex-1 truncate'">{{ trans(item.label) }}</span>
                            <span
                                v-if="badge(item) > 0"
                                class="rounded-xs border border-line-strong text-center text-caption text-ink tabular-nums"
                                :class="props.collapsed ? 'absolute right-2 top-0 min-w-16 bg-surface px-2' : 'min-w-20 px-4'"
                            >
                                {{ formatNumber(badge(item)) }}<span class="sr-only">{{ trans('shell.nav.badge') }}</span>
                            </span>
                        </Link>
                    </Tooltip>
                </li>
            </ul>
        </section>
    </nav>
</template>
