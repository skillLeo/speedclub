<script setup lang="ts">
import { PhArrowsHorizontal } from '@phosphor-icons/vue';
import { useResizeObserver } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, ref } from 'vue';

/**
 * A table (or another wide block) that may scroll sideways inside its column (ADR-212), and says so (DQ-535): while its content is
 * wider than the box and not scrolled to the end, a hint line under it names the scrolling. Keyboard: the region is focusable, so
 * the arrow keys scroll it. The frame is the hairline table frame of 03 §14.
 *
 * `stickyHeader` (DQ-615): a tall table whose header must stay in view. While the content fits, the region is no scroll container, so
 * a `sticky` header sticks to the page under the top bar (the slot's `contained` is false: use `top-56`). Once it is wider than its
 * column, the region scrolls both ways inside a viewport-high box, and the header sticks to the region (`contained` true: `top-0`).
 */
const props = withDefaults(defineProps<{ label: string; testId?: string; stickyHeader?: boolean }>(), { testId: undefined, stickyHeader: false });

const box = ref<HTMLElement | null>(null);
const wider = ref(false);
const atEnd = ref(true);

function update(): void {
    const el = box.value;
    if (!el) return;
    wider.value = el.scrollWidth > el.clientWidth + 1;
    atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
}
const contained = computed(() => !props.stickyHeader || wider.value);
const overflow = computed(() => (!props.stickyHeader ? 'overflow-x-auto' : wider.value ? 'max-h-dvh overflow-auto' : 'overflow-visible'));
onMounted(update);
useResizeObserver(box, update);
</script>

<template>
    <div class="flex min-w-0 flex-col gap-8">
        <div
            ref="box"
            :class="[overflow, 'relative min-w-0 rounded-sm border border-line-subtle bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus']"
            :tabindex="contained ? 0 : undefined"
            role="region"
            :aria-label="label"
            :data-testid="testId"
            :data-scrollable="wider || undefined"
            @scroll.passive="update"
        >
            <slot :contained="contained" />
        </div>
        <p v-if="wider && !atEnd" class="flex items-center gap-4 text-caption text-ink-3" aria-hidden="true">
            <PhArrowsHorizontal :size="16" />{{ trans('ui.table.scroll_hint') }}
        </p>
    </div>
</template>
