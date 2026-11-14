<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhSidebarSimple } from '@phosphor-icons/vue';
import { useResizeObserver } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import IconButton from '../ui/IconButton.vue';
import { sidebarCollapsed, toggleSidebar } from '../../lib/sidebar';
import NavList from './NavList.vue';

defineOptions({ name: 'AdminSidebar' });

/**
 * Sidebar (09 §10.1): 240 px, or the 72 rail (layout.rail, as member web, DQ-1208) when `collapsible` and collapsed (icons, tooltips;
 * the toggle sits at the foot). Wordmark, navigation, build. Brand layer stays out: plain type, no brush logo. When the navigation is
 * taller than the column (DQ-567), the active entry is scrolled into view on mount and after each visit; a hairline under the wordmark
 * says there is more above and one over the build line that there is more below (DQ-1206: hairlines, no gradient fade).
 */
const props = withDefaults(defineProps<{ collapsible?: boolean }>(), { collapsible: false });
const emit = defineEmits<{ navigate: [] }>();
const rail = (): boolean => props.collapsible && sidebarCollapsed.value;
const page = usePage();
const list = ref<HTMLElement | null>(null);
const more = ref(false);
const above = ref(false);

function measure(): void {
    const el = list.value;
    more.value = el !== null && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    above.value = el !== null && el.scrollTop > 0;
}
// DQ-567: the active item stays in view. Only the sidebar list scrolls: scrollIntoView() also scrolled the window, so tall pages opened
// below their top bar (DQ-586).
function revealActive(): void {
    void nextTick(() => {
        const el = list.value;
        const item = el?.querySelector<HTMLElement>('[aria-current="page"]');
        if (el && item) {
            const itemTop = item.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
            const centred = itemTop - (el.clientHeight - item.offsetHeight) / 2;
            // DQ-1206: start at a whole row, so no entry sits half cut under the wordmark.
            const top = el.getBoundingClientRect().top - el.scrollTop;
            const rows = [...el.querySelectorAll<HTMLElement>('li')].map((li) => li.getBoundingClientRect().top - top);
            const snapped = rows.reduce((best, rowTop) => (Math.abs(rowTop - centred) < Math.abs(best - centred) ? rowTop : best), centred);
            el.scrollTop = Math.max(0, Math.min(snapped, el.scrollHeight - el.clientHeight));
        }
        measure();
    });
}
let stop: (() => void) | null = null;
onMounted(() => {
    revealActive();
    stop = router.on('finish', revealActive);
});
onBeforeUnmount(() => stop?.());
useResizeObserver(list, measure);
</script>

<template>
    <div class="flex h-full flex-col bg-surface">
        <div class="flex h-56 shrink-0 items-center gap-8 border-b border-line-subtle" :class="rail() ? 'justify-center px-8' : 'px-16'">
            <span class="font-marque text-headline tracking-normal text-ink" :class="rail() ? 'sr-only' : ''">{{ trans('shell.brand') }}</span>
            <span v-if="rail()" class="font-marque text-headline tracking-normal text-ink" aria-hidden="true">{{ trans('shell.brand_short') }}</span>
            <span v-else class="text-caption text-ink-3">{{ trans('shell.brand_suffix') }}</span>
        </div>
        <div class="relative min-h-0 flex-1">
            <div ref="list" class="h-full overflow-y-auto py-16" :class="rail() ? 'px-12' : 'px-8'" @scroll.passive="measure">
                <NavList :collapsed="rail()" @navigate="emit('navigate')" />
            </div>
            <div v-if="above" class="pointer-events-none absolute inset-x-0 top-0 h-px bg-line" aria-hidden="true" data-nav-above />
            <div v-if="more" class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true" data-nav-more />
        </div>
        <div class="flex shrink-0 items-center gap-8 border-t border-line-subtle py-8" :class="rail() ? 'justify-center px-8' : 'px-16'">
            <p v-if="page.props.app.version && !rail()" class="min-w-0 flex-1 truncate text-caption text-ink-3 tabular-nums">
                {{ trans('shell.build', { version: page.props.app.version }) }}
            </p>
            <IconButton
                v-if="collapsible"
                :icon="PhSidebarSimple"
                :label="trans(rail() ? 'shell.sidebar_expand' : 'shell.sidebar_collapse')"
                :aria-expanded="!rail()"
                data-testid="shell.sidebar.toggle"
                @click="toggleSidebar"
            />
        </div>
    </div>
</template>
