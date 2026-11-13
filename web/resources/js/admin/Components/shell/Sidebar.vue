<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { useResizeObserver } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import NavList from './NavList.vue';

defineOptions({ name: 'AdminSidebar' });

/**
 * 248 px sidebar (03 §14): wordmark, navigation, build. Brand layer stays out: plain type, no brush logo. When the navigation is taller
 * than the column (DQ-567), the active entry is scrolled into view on mount and after each visit, and a fade above the build line says
 * there is more below.
 */
const emit = defineEmits<{ navigate: [] }>();
const page = usePage();
const list = ref<HTMLElement | null>(null);
const more = ref(false);

function measure(): void {
    const el = list.value;
    more.value = el !== null && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
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
            el.scrollTop = Math.max(0, Math.min(centred, el.scrollHeight - el.clientHeight));
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
        <div class="flex h-56 shrink-0 items-center gap-8 border-b border-line-subtle px-16">
            <span class="font-marque text-headline tracking-normal text-ink">{{ trans('shell.brand') }}</span>
            <span class="text-caption text-ink-3">{{ trans('shell.brand_suffix') }}</span>
        </div>
        <div class="relative min-h-0 flex-1">
            <div ref="list" class="h-full overflow-y-auto px-8 py-16" @scroll.passive="measure">
                <NavList @navigate="emit('navigate')" />
            </div>
            <div v-if="more" class="pointer-events-none absolute inset-x-0 bottom-0 h-32" :style="{ background: 'linear-gradient(to top, var(--color-surface), transparent)' }" aria-hidden="true" data-nav-more />
        </div>
        <p v-if="page.props.app.version" class="shrink-0 border-t border-line-subtle px-16 py-12 text-caption text-ink-3 tabular-nums">
            {{ trans('shell.build', { version: page.props.app.version }) }}
        </p>
    </div>
</template>
