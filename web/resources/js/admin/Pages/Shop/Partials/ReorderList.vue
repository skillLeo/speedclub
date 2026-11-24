<script setup lang="ts" generic="Item extends { id: string }">
import { PhArrowDown, PhArrowUp, PhDotsSixVertical } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { nextTick, ref } from 'vue';
import { IconButton } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatNumber } from '../../../lib/format';

/**
 * A list the staff member reorders by drag (the handle or the whole row) or by keyboard: Space/Enter on the handle picks the row up,
 * the arrow keys move it, Space/Enter drops it, Escape puts it back. The up/down buttons do the same for a pointer without dragging.
 * Every move is announced (aria-live). `v-model` is the list in its new order; the parent saves it.
 */
const props = withDefaults(defineProps<{ label: (item: Item) => string; listLabel: string; disabled?: boolean; testId: string; layout?: 'list' | 'grid' }>(), {
    disabled: false,
    layout: 'list',
});
const items = defineModel<Item[]>({ required: true });
defineSlots<{ default: (props: { item: Item; index: number }) => unknown; actions?: (props: { item: Item; index: number }) => unknown }>();

const grabbed = ref<string | null>(null);
const grabbedFrom = ref<number | null>(null);
const dragging = ref<string | null>(null);
const announcement = ref('');

function say(item: Item, index: number): void {
    announcement.value = trans('shop.reorder.position', { name: props.label(item), position: formatNumber(index + 1), total: formatNumber(items.value.length) });
}

function moveTo(from: number, to: number): void {
    if (to < 0 || to >= items.value.length || from === to) return;
    const next = [...items.value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    items.value = next;
}

async function move(index: number, by: -1 | 1, focus: 'handle' | 'button' = 'handle'): Promise<void> {
    const item = items.value[index];
    if (item === undefined) return;
    moveTo(index, index + by);
    const now = items.value.indexOf(item);
    say(item, now);
    await nextTick();
    // Keep focus on the control that was used (the row moved in the DOM); at the end of the list the other arrow takes it.
    const atEdge = (by === -1 && now === 0) || (by === 1 && now === items.value.length - 1);
    const target = focus === 'handle' ? `[data-reorder-handle="${item.id}"]` : `[data-reorder-move="${item.id}:${atEdge ? -by : by}"]`;
    document.querySelector<HTMLElement>(target)?.focus();
}

function key(event: KeyboardEvent, index: number): void {
    if (props.disabled) return;
    const item = items.value[index]!;
    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (grabbed.value === item.id) {
            grabbed.value = null;
            grabbedFrom.value = null;
            announcement.value = trans('shop.reorder.dropped', { name: props.label(item), position: formatNumber(index + 1), total: formatNumber(items.value.length) });
        } else {
            grabbed.value = item.id;
            grabbedFrom.value = index;
            announcement.value = trans('shop.reorder.grabbed', { name: props.label(item) });
        }
        return;
    }
    if (grabbed.value !== item.id) return;
    const back = props.layout === 'grid' ? ['ArrowUp', 'ArrowLeft'] : ['ArrowUp'];
    const forward = props.layout === 'grid' ? ['ArrowDown', 'ArrowRight'] : ['ArrowDown'];
    if (back.includes(event.key)) {
        event.preventDefault();
        void move(index, -1);
    } else if (forward.includes(event.key)) {
        event.preventDefault();
        void move(index, 1);
    } else if (event.key === 'Escape' && grabbedFrom.value !== null) {
        event.preventDefault();
        moveTo(index, grabbedFrom.value);
        grabbed.value = null;
        grabbedFrom.value = null;
        announcement.value = trans('shop.reorder.cancelled', { name: props.label(item) });
        void nextTick(() => document.querySelector<HTMLElement>(`[data-reorder-handle="${item.id}"]`)?.focus());
    }
}

function blur(id: string): void {
    if (grabbed.value === id) {
        grabbed.value = null;
        grabbedFrom.value = null;
    }
}

// ---- pointer drag (HTML5) ---------------------------------------------------------------------------------------------------
function dragStart(event: DragEvent, item: Item): void {
    if (props.disabled) return;
    dragging.value = item.id;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
    }
}
function dragOver(event: DragEvent, index: number): void {
    if (dragging.value === null) return;
    event.preventDefault();
    const from = items.value.findIndex((entry) => entry.id === dragging.value);
    if (from !== -1 && from !== index) moveTo(from, index);
}
function dragEnd(): void {
    const id = dragging.value;
    dragging.value = null;
    const index = items.value.findIndex((entry) => entry.id === id);
    if (index !== -1) say(items.value[index]!, index);
}
</script>

<template>
    <div>
        <ol
            :class="layout === 'grid' ? 'grid grid-cols-2 gap-12 tablet:grid-cols-3' : 'flex flex-col overflow-hidden rounded-sm border border-line'"
            :aria-label="listLabel"
            :aria-describedby="`${testId}-help`"
            :data-testid="testId"
        >
            <li
                v-for="(item, index) in items"
                :key="item.id"
                :draggable="!disabled"
                :class="[
                    layout === 'grid' ? 'flex flex-col gap-8 rounded-sm border bg-surface p-8' : 'flex min-h-48 items-center gap-12 bg-surface px-8 py-4',
                    layout === 'list' && index > 0 ? 'border-t border-line-subtle' : '',
                    layout === 'grid' ? (grabbed === item.id || dragging === item.id ? 'border-line-strong' : 'border-line') : '',
                    grabbed === item.id || dragging === item.id ? 'bg-selected' : '',
                ]"
                :data-testid="`${testId}.item`"
                @dragstart="dragStart($event, item)"
                @dragover="dragOver($event, index)"
                @drop.prevent
                @dragend="dragEnd"
            >
                <div class="flex items-center gap-4" :class="layout === 'grid' ? 'order-last justify-between' : ''">
                    <button
                        type="button"
                        :class="[focusRing, 'inline-flex size-32 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink', disabled ? 'cursor-not-allowed' : 'cursor-grab']"
                        :aria-label="trans('shop.reorder.handle', { name: label(item), position: formatNumber(index + 1), total: formatNumber(items.length) })"
                        :aria-pressed="grabbed === item.id"
                        :disabled="disabled"
                        :data-reorder-handle="item.id"
                        :data-testid="`${testId}.handle`"
                        @keydown="key($event, index)"
                        @blur="blur(item.id)"
                    >
                        <PhDotsSixVertical :size="20" aria-hidden="true" />
                    </button>
                    <span v-if="layout === 'grid'" class="flex gap-2">
                        <slot name="actions" :item="item" :index="index" />
                        <IconButton :icon="PhArrowUp" size="sm" :label="trans('shop.reorder.earlier', { name: label(item) })" :disabled="disabled || index === 0" :data-reorder-move="`${item.id}:-1`" @click="move(index, -1, 'button')" />
                        <IconButton :icon="PhArrowDown" size="sm" :label="trans('shop.reorder.later', { name: label(item) })" :disabled="disabled || index === items.length - 1" :data-reorder-move="`${item.id}:1`" @click="move(index, 1, 'button')" />
                    </span>
                </div>
                <div class="min-w-0 flex-1">
                    <slot :item="item" :index="index" />
                </div>
                <span v-if="layout === 'list'" class="flex shrink-0 gap-4">
                    <IconButton :icon="PhArrowUp" size="sm" :label="trans('shop.reorder.earlier', { name: label(item) })" :disabled="disabled || index === 0" :data-reorder-move="`${item.id}:-1`" @click="move(index, -1, 'button')" />
                    <IconButton :icon="PhArrowDown" size="sm" :label="trans('shop.reorder.later', { name: label(item) })" :disabled="disabled || index === items.length - 1" :data-reorder-move="`${item.id}:1`" @click="move(index, 1, 'button')" />
                </span>
            </li>
        </ol>
        <p :id="`${testId}-help`" class="mt-8 text-caption text-ink-3">{{ trans('shop.reorder.help') }}</p>
        <p class="sr-only" aria-live="assertive" aria-atomic="true">{{ announcement }}</p>
    </div>
</template>
