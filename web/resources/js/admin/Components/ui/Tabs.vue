<script setup lang="ts">
import { PhCaretDown } from '@phosphor-icons/vue';
import { useResizeObserver } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import DropdownMenu, { type MenuEntry } from './DropdownMenu.vue';
import { focusRing } from './styles';
import { formatNumber } from '../../lib/format';

defineOptions({ name: 'UiTabs' });

export interface TabItem {
    value: string;
    label: string;
    count?: number | null;
    disabled?: boolean;
}

/**
 * Content tabs with the accent underline (03 §3 allows red for the content-tab underline). One slot per tab, named by its value;
 * or `panels=false` and render the content yourself (e.g. tabs that are links or reload the page).
 *
 * Tabs are navigation, so none is ever hidden in a silent scroller (DQ-525): when the strip is wider than its container, the tabs
 * that do not fit move into a last "Mehr" menu, and the active tab always stays in the visible set (it takes the place of the last
 * visible one). The widths are measured once per set of labels and the split follows the container's width.
 */
const model = defineModel<string>({ required: true });
const props = withDefaults(defineProps<{ items: TabItem[]; label: string; panels?: boolean }>(), { panels: true });

const GAP = 24;
const strip = ref<HTMLElement | null>(null);
const more = ref<HTMLElement | null>(null);
const measuring = ref(true);
const widths = ref<Record<string, number>>({});
const moreWidth = ref(96);
const available = ref(0);

const triggerClass = [
    focusRing,
    'inline-flex h-40 min-w-32 shrink-0 items-center justify-center gap-8 whitespace-nowrap rounded-xs text-label-s text-ink-2 hover:text-ink data-[state=active]:text-ink data-[disabled]:text-ink-disabled',
];

async function measure(): Promise<void> {
    measuring.value = true;
    await nextTick();
    const next: Record<string, number> = {};
    strip.value?.querySelectorAll<HTMLElement>('[data-tab-value]').forEach((el) => {
        next[el.dataset.tabValue ?? ''] = el.offsetWidth;
    });
    widths.value = next;
    available.value = strip.value?.clientWidth ?? 0;
    measuring.value = false;
    await nextTick();
    if (more.value) moreWidth.value = more.value.offsetWidth;
}

onMounted(() => void measure());
// New labels (a locale switch, a count that appears) are measured again.
watch(
    () => props.items.map((item) => `${item.value}:${item.label}:${item.count ?? ''}`).join('|'),
    () => void measure(),
);
useResizeObserver(strip, (entries) => {
    const width = entries[0]?.contentRect.width;
    if (width !== undefined && !measuring.value) available.value = width;
});

/** How many tabs fit from the start, with room for "Mehr" when not all fit. */
const split = computed<{ visible: TabItem[]; overflow: TabItem[] }>(() => {
    const items = props.items;
    if (measuring.value || available.value === 0) return { visible: items, overflow: [] };
    const width = (item: TabItem) => widths.value[item.value] ?? 0;
    const total = items.reduce((sum, item, index) => sum + width(item) + (index > 0 ? GAP : 0), 0);
    if (total <= available.value) return { visible: items, overflow: [] };

    const room = available.value - moreWidth.value - GAP;
    const active = items.find((item) => item.value === model.value);
    // The active tab is always shown: it is reserved first, the others fill the rest in their order.
    let used = active ? width(active) : 0;
    const shown = new Set<string>(active ? [active.value] : []);
    for (const item of items) {
        if (shown.has(item.value)) continue;
        const next = used + GAP + width(item);
        if (next > room) break;
        used = next;
        shown.add(item.value);
    }
    return { visible: items.filter((item) => shown.has(item.value)), overflow: items.filter((item) => !shown.has(item.value)) };
});

const overflowEntries = computed<MenuEntry[]>(() =>
    split.value.overflow.map((item) => ({
        key: item.value,
        label: item.count !== undefined && item.count !== null ? `${item.label} (${formatNumber(item.count)})` : item.label,
        disabled: item.disabled,
        testId: `tabs.more.${item.value}`,
        onSelect: () => (model.value = item.value),
    })),
);
</script>

<template>
    <TabsRoot v-model="model" :unmount-on-hide="true">
        <div ref="strip" class="relative flex min-w-0 items-end gap-24 border-b border-line-subtle" :class="measuring ? 'overflow-hidden' : ''">
            <TabsList :aria-label="label" class="relative flex min-w-0 gap-24">
                <TabsTrigger
                    v-for="item in split.visible"
                    :key="item.value"
                    :value="item.value"
                    :disabled="item.disabled"
                    :class="triggerClass"
                    :data-tab-value="item.value"
                >
                    {{ item.label }}
                    <span v-if="item.count !== undefined && item.count !== null" class="text-caption text-ink-3 tabular-nums">{{ formatNumber(item.count) }}</span>
                </TabsTrigger>
                <TabsIndicator class="absolute bottom-0 left-0 h-2 sc-tab-indicator bg-accent transition-transform duration-200 ease-standard" />
            </TabsList>
            <DropdownMenu v-if="split.overflow.length > 0" :items="overflowEntries" align="end">
                <template #trigger>
                    <button ref="more" type="button" :class="triggerClass" :aria-label="trans('ui.tabs.more_label', { count: formatNumber(split.overflow.length) })" data-testid="tabs.more">
                        {{ trans('ui.tabs.more') }}
                        <PhCaretDown :size="16" aria-hidden="true" />
                    </button>
                </template>
            </DropdownMenu>
        </div>
        <template v-if="panels">
            <TabsContent v-for="item in items" :key="item.value" :value="item.value" class="pt-24 focus-visible:outline-none">
                <slot :name="item.value" />
            </TabsContent>
        </template>
    </TabsRoot>
</template>
