<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhArrowRight, PhCopy, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, ref, watch, type Component } from 'vue';
import Kbd from '../ui/Kbd.vue';
import Spinner from '../ui/Spinner.vue';
import { toast } from '../ui/toast';
import { isCancelled, requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { paletteEntries } from '../../modules/registry';
import type { SearchGroup } from '../../types/search';

/**
 * ⌘K / Ctrl K (06 §3 Overview): go to any page this staff member may open, find members, vehicles, QR codes and cases through ADM-07,
 * and run safe actions on a result ("Datensatz öffnen" = Enter, "Link kopieren" = Shift+Enter). Nothing here changes data.
 */
const open = defineModel<boolean>('open', { default: false });
const page = usePage();
const { can, canAny } = usePermissions();

interface Option {
    id: string;
    kind: 'page' | 'record' | 'search';
    label: string;
    hint?: string;
    icon?: Component;
    url: string | null;
}

const term = ref('');
const groups = ref<SearchGroup[]>([]);
const searching = ref(false);
const failed = ref(false);
const activeIndex = ref(0);
const input = ref<HTMLInputElement | null>(null);
let controller: AbortController | null = null;
let debounce: number | undefined;

const destinations = computed(() => {
    void page.url;
    return paletteEntries((atom) => (Array.isArray(atom) ? canAny(atom) : can(atom)), hasRoute);
});

const pageOptions = computed<Option[]>(() => {
    const needle = term.value.trim().toLocaleLowerCase();
    return destinations.value
        .filter((entry) => needle === '' || trans(entry.label).toLocaleLowerCase().includes(needle) || (entry.keywords ?? []).some((k) => k.includes(needle)))
        .slice(0, needle === '' ? 12 : 6)
        .map((entry) => ({
            id: entry.key,
            kind: 'page' as const,
            label: trans(entry.label),
            hint: entry.group ? trans(`shell.groups.${entry.group}`) : undefined,
            icon: entry.icon,
            url: routeOr(entry.route, '/admin', entry.params),
        }));
});

const recordOptions = computed<Option[]>(() =>
    groups.value.flatMap((group) =>
        group.items.map((item) => ({
            id: `${group.group}:${item.id}`,
            kind: 'record' as const,
            label: item.title,
            hint: [trans(`search.groups.${group.group}`), item.subtitle].filter(Boolean).join(' · '),
            url: item.url,
        })),
    ),
);

const searchOption = computed<Option[]>(() =>
    term.value.trim().length >= 2 && hasRoute('admin.search')
        ? [{ id: 'search', kind: 'search', label: trans('shell.palette.all_results', { q: term.value.trim() }), icon: PhMagnifyingGlass, url: `${routeOr('admin.search', '/admin/search')}?q=${encodeURIComponent(term.value.trim())}` }]
        : [],
);

const options = computed<Option[]>(() => [...pageOptions.value, ...recordOptions.value, ...searchOption.value]);
const activeOption = computed(() => options.value[activeIndex.value] ?? null);

watch(open, async (value) => {
    if (!value) return;
    term.value = '';
    groups.value = [];
    activeIndex.value = 0;
    await nextTick();
    input.value?.focus();
});

watch(term, (value) => {
    activeIndex.value = 0;
    window.clearTimeout(debounce);
    controller?.abort();
    controller = null;
    failed.value = false;
    const q = value.trim();
    if (q.length < 2 || !hasRoute('admin.search.suggest')) {
        groups.value = [];
        searching.value = false;
        return;
    }
    debounce = window.setTimeout(() => void suggest(q), 200);
});

async function suggest(q: string): Promise<void> {
    const mine = new AbortController();
    controller = mine;
    searching.value = true;
    // Only the latest suggestion request speaks: one aborted for the next keystroke settles after that one has started.
    try {
        const response = await requestJson<{ groups: SearchGroup[] }>('get', routeOr('admin.search.suggest', '/admin/search/suggest'), { q }, mine.signal);
        if (controller === mine) groups.value = response.groups ?? [];
    } catch (error) {
        if (controller === mine && !isCancelled(error)) failed.value = true;
    } finally {
        if (controller === mine) searching.value = false;
    }
}

function go(option: Option | null): void {
    if (option === null || option.url === null) return;
    open.value = false;
    router.visit(option.url);
}

async function copy(option: Option | null): Promise<void> {
    if (option === null || option.url === null) return;
    try {
        await navigator.clipboard.writeText(new URL(option.url, window.location.origin).href);
        toast('success', trans('shell.palette.copied'));
    } catch {
        toast('error', trans('shell.palette.copy_failed'));
    }
}

function onKeydown(event: KeyboardEvent): void {
    const count = options.value.length;
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex.value = count === 0 ? 0 : (activeIndex.value + 1) % count;
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex.value = count === 0 ? 0 : (activeIndex.value - 1 + count) % count;
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) void copy(activeOption.value);
        else go(activeOption.value);
    }
}

/** Key caps are symbols, not words: the same in both languages. */
const KEYS = { enter: '\u21B5', shift: '\u21E7', up: '\u2191', down: '\u2193' } as const;

const optionId = (option: Option): string => `palette-${option.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal>
            <DialogOverlay class="sc-fade fixed inset-0 z-40 bg-scrim" />
            <div class="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-16 pt-64">
                <DialogContent class="sc-pop pointer-events-auto flex max-h-560 w-full max-w-640 flex-col overflow-hidden rounded-sm border border-line bg-overlay text-ink shadow-sheet" data-testid="ADM-07.palette">
                    <DialogTitle class="sr-only">{{ trans('shell.palette.title') }}</DialogTitle>
                    <DialogDescription class="sr-only">{{ trans('shell.palette.description') }}</DialogDescription>
                    <div class="flex h-48 shrink-0 items-center gap-12 border-b border-line-subtle px-16">
                        <PhMagnifyingGlass :size="20" class="shrink-0 text-ink-3" aria-hidden="true" />
                        <input
                            ref="input"
                            v-model="term"
                            type="text"
                            enterkeyhint="go"
                            autocomplete="off"
                            spellcheck="false"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls="palette-list"
                            :aria-expanded="options.length > 0"
                            :aria-activedescendant="activeOption ? optionId(activeOption) : undefined"
                            :aria-label="trans('shell.palette.input')"
                            :placeholder="trans('shell.palette.placeholder')"
                            maxlength="120"
                            class="h-full min-w-0 flex-1 bg-transparent text-admin-base text-ink placeholder:text-ink-3 focus:outline-none"
                            data-testid="ADM-07.palette.input"
                            @keydown="onKeydown"
                        />
                        <Spinner v-if="searching" />
                        <Kbd>{{ trans('shell.palette.esc') }}</Kbd>
                    </div>
                    <ul id="palette-list" role="listbox" :aria-label="trans('shell.palette.results')" class="min-h-0 flex-1 overflow-y-auto p-8">
                        <li v-if="options.length === 0 && !searching" class="px-8 py-12 text-admin-base text-ink-3" role="presentation">
                            {{ failed ? trans('shell.palette.failed') : trans('shell.palette.empty') }}
                        </li>
                        <li
                            v-for="(option, index) in options"
                            :id="optionId(option)"
                            :key="option.id"
                            role="option"
                            :aria-selected="index === activeIndex"
                            class="flex h-40 cursor-pointer items-center gap-12 rounded-sm px-8"
                            :class="index === activeIndex ? 'bg-selected' : 'hover:bg-hover'"
                            :data-testid="`ADM-07.palette.option.${option.kind}`"
                            @mousemove="activeIndex = index"
                            @click="go(option)"
                        >
                            <component :is="option.icon ?? PhArrowRight" :size="16" class="shrink-0 text-ink-3" aria-hidden="true" />
                            <span class="min-w-0 flex-1 truncate text-admin-base text-ink" :title="option.label">{{ option.label }}</span>
                            <span v-if="option.hint" class="max-w-200 truncate text-caption" :class="index === activeIndex ? 'text-ink' : 'text-ink-2'" :title="option.hint">{{ option.hint }}</span>
                            <button
                                v-if="option.kind === 'record' && option.url"
                                type="button"
                                tabindex="-1"
                                class="inline-flex size-24 items-center justify-center rounded-xs text-ink-3 hover:text-ink"
                                :aria-label="trans('shell.palette.copy')"
                                @click.stop="copy(option)"
                            >
                                <PhCopy :size="16" aria-hidden="true" />
                            </button>
                        </li>
                    </ul>
                    <footer class="flex shrink-0 flex-wrap items-center gap-16 border-t border-line-subtle px-16 py-8 text-caption text-ink-3">
                        <span class="flex items-center gap-4"><Kbd>{{ KEYS.enter }}</Kbd>{{ trans('shell.palette.open') }}</span>
                        <span class="flex items-center gap-4"><Kbd>{{ KEYS.shift }}</Kbd><Kbd>{{ KEYS.enter }}</Kbd>{{ trans('shell.palette.copy') }}</span>
                        <span class="flex items-center gap-4"><Kbd>{{ KEYS.up }}</Kbd><Kbd>{{ KEYS.down }}</Kbd>{{ trans('shell.palette.move') }}</span>
                    </footer>
                </DialogContent>
            </div>
        </DialogPortal>
    </DialogRoot>
</template>
