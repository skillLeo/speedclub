<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhArrowRight, PhClockCounterClockwise, PhCopy, PhMagnifyingGlass, PhPlay } from '@phosphor-icons/vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, ref, watch, type Component } from 'vue';
import Kbd from '../ui/Kbd.vue';
import Spinner from '../ui/Spinner.vue';
import { focusRing } from '../ui/styles';
import { toast } from '../ui/toast';
import { isCancelled, requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { paletteActions, paletteEntries, type PaletteAction } from '../../modules/registry';
import type { SearchGroup, SearchItem } from '../../types/search';

/**
 * ⌘K / Ctrl K (06 §3 Overview, 09 §10.2): go to any page this staff member may open, find members, vehicles, QR codes and cases through
 * ADM-07, reopen recent records, and start actions ("Mitglied sperren…", "Treffen freigeben…", "Betrieb verifizieren…", "Flag
 * umschalten…") that respect the staff member's atoms. An action has two steps: pick it, then pick the record; the record's page opens
 * with the action ready, where its own checks (password, reason, four-eyes) apply. Nothing changes data from here.
 * Keys: Enter opens, Shift+Enter copies a record link, Backspace in an empty field leaves an action.
 */
const open = defineModel<boolean>('open', { default: false });
const page = usePage();
const { can, canAny } = usePermissions();

interface Option {
    id: string;
    kind: 'page' | 'record' | 'search' | 'action' | 'target' | 'recent';
    label: string;
    hint?: string;
    icon?: Component;
    url: string | null;
    action?: PaletteAction;
}

const term = ref('');
const groups = ref<SearchGroup[]>([]);
const targets = ref<SearchItem[]>([]);
const searching = ref(false);
const failed = ref(false);
const activeIndex = ref(0);
const input = ref<HTMLInputElement | null>(null);
const action = ref<PaletteAction | null>(null);
let controller: AbortController | null = null;
let debounce: number | undefined;

const allowed = (atom: string | string[] | undefined): boolean => (Array.isArray(atom) ? canAny(atom) : can(atom));
const destinations = computed(() => {
    void page.url;
    return paletteEntries(allowed, hasRoute);
});
const actions = computed(() => {
    void page.url;
    return paletteActions(allowed, hasRoute);
});

// ---- recent records (this browser, per staff member) -----------------------------------------------------------------------
interface Recent {
    label: string;
    hint?: string;
    url: string;
}
const RECENT_MAX = 5;
const recentKey = computed(() => `sc-admin-palette-recent:${page.props.staff?.id ?? 'anonymous'}`);
const recent = ref<Recent[]>([]);
function loadRecent(): void {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(recentKey.value) ?? '[]');
        recent.value = Array.isArray(parsed) ? parsed.filter((r): r is Recent => typeof r === 'object' && r !== null && typeof (r as Recent).url === 'string' && typeof (r as Recent).label === 'string').slice(0, RECENT_MAX) : [];
    } catch {
        recent.value = [];
    }
}
function remember(option: Option): void {
    if (option.url === null || (option.kind !== 'record' && option.kind !== 'target' && option.kind !== 'recent')) return;
    const next = [{ label: option.label, hint: option.hint, url: option.url }, ...recent.value.filter((r) => r.url !== option.url)].slice(0, RECENT_MAX);
    recent.value = next;
    try {
        window.localStorage.setItem(recentKey.value, JSON.stringify(next));
    } catch {
        // Private mode: recent items last for this page only.
    }
}

// ---- options --------------------------------------------------------------------------------------------------------------------
const needle = computed(() => term.value.trim().toLocaleLowerCase());
const matches = (label: string, keywords: string[] = []): boolean => needle.value === '' || label.toLocaleLowerCase().includes(needle.value) || keywords.some((k) => k.includes(needle.value));

const actionOptions = computed<Option[]>(() =>
    actions.value
        .filter((a) => matches(trans(a.label), a.keywords))
        .map((a) => ({ id: `action:${a.key}`, kind: 'action' as const, label: trans(a.label), hint: trans('shell.palette.action_hint'), icon: a.icon ?? PhPlay, url: null, action: a })),
);

const pageOptions = computed<Option[]>(() =>
    destinations.value
        .filter((entry) => matches(trans(entry.label), entry.keywords))
        .slice(0, needle.value === '' ? 8 : 6)
        .map((entry) => ({
            id: entry.key,
            kind: 'page' as const,
            label: trans(entry.label),
            hint: entry.group ? trans(`shell.groups.${entry.group}`) : undefined,
            icon: entry.icon,
            url: routeOr(entry.route, '/admin', entry.params),
        })),
);

const recentOptions = computed<Option[]>(() =>
    needle.value === '' ? recent.value.map((r, index) => ({ id: `recent:${index}`, kind: 'recent' as const, label: r.label, hint: r.hint ?? trans('shell.palette.recent'), icon: PhClockCounterClockwise, url: r.url })) : [],
);

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

/** Second step of an action: the records it can run on. */
const targetOptions = computed<Option[]>(() => {
    const a = action.value;
    if (a === null) return [];
    if (a.kind === 'member') {
        const members = groups.value.find((g) => g.group === 'members')?.items ?? [];
        return members.map((item) => ({ id: `target:${item.id}`, kind: 'target' as const, label: item.title, hint: item.subtitle ?? undefined, url: a.target ? a.target(item.id) : item.url }));
    }
    return targets.value.map((item) => ({ id: `target:${item.id}`, kind: 'target' as const, label: item.title, hint: item.subtitle ?? undefined, url: item.url }));
});

const options = computed<Option[]>(() =>
    action.value !== null ? targetOptions.value : [...recentOptions.value, ...actionOptions.value, ...pageOptions.value, ...recordOptions.value, ...searchOption.value],
);
const activeOption = computed(() => options.value[activeIndex.value] ?? null);
const placeholder = computed(() => (action.value === null ? trans('shell.palette.placeholder') : trans(`shell.palette.targets.${action.value.kind}`)));
const emptyText = computed(() => {
    if (failed.value) return trans('shell.palette.failed');
    if (action.value?.kind === 'member' && term.value.trim().length < 2) return trans('shell.palette.targets.member_hint');
    return action.value === null ? trans('shell.palette.empty') : trans(`shell.palette.targets.${action.value.kind}_empty`);
});

watch(
    open,
    async (value) => {
        if (!value) return;
        term.value = '';
        groups.value = [];
        targets.value = [];
        action.value = null;
        activeIndex.value = 0;
        loadRecent();
        await nextTick();
        input.value?.focus();
    },
    { immediate: true },
);

// ---- fetching ---------------------------------------------------------------------------------------------------------------------
function cancel(): void {
    window.clearTimeout(debounce);
    controller?.abort();
    controller = null;
    failed.value = false;
}

function schedule(): void {
    activeIndex.value = 0;
    cancel();
    const q = term.value.trim();
    const a = action.value;
    if (a !== null && a.kind !== 'member') {
        debounce = window.setTimeout(() => void fetchTargets(a, q), q === '' ? 0 : 200);
        return;
    }
    if (q.length < 2 || !hasRoute('admin.search.suggest')) {
        groups.value = [];
        searching.value = false;
        return;
    }
    debounce = window.setTimeout(() => void suggest(q), 200);
}
watch(term, schedule);

async function run<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void): Promise<void> {
    const mine = new AbortController();
    controller = mine;
    searching.value = true;
    // Only the latest request speaks: one aborted for the next keystroke settles after that one has started.
    try {
        const value = await load(mine.signal);
        if (controller === mine) apply(value);
    } catch (error) {
        if (controller === mine && !isCancelled(error)) failed.value = true;
    } finally {
        if (controller === mine) searching.value = false;
    }
}

function suggest(q: string): Promise<void> {
    return run(
        (signal) => requestJson<{ groups: SearchGroup[] }>('get', routeOr('admin.search.suggest', '/admin/search/suggest'), { q }, signal),
        (response) => (groups.value = response.groups ?? []),
    );
}

function fetchTargets(a: PaletteAction, q: string): Promise<void> {
    return run(
        (signal) => requestJson<{ items: SearchItem[] }>('get', routeOr('admin.palette.targets', `/admin/palette/targets/${a.kind}`, { kind: a.kind }), q === '' ? {} : { q }, signal),
        (response) => (targets.value = response.items ?? []),
    );
}

function startAction(a: PaletteAction): void {
    action.value = a;
    groups.value = [];
    targets.value = [];
    if (term.value === '') schedule();
    else term.value = '';
    void nextTick(() => input.value?.focus());
}

function leaveAction(): void {
    action.value = null;
    cancel();
    searching.value = false;
    groups.value = [];
    term.value = '';
}

function go(option: Option | null): void {
    if (option === null) return;
    if (option.kind === 'action' && option.action) {
        startAction(option.action);
        return;
    }
    if (option.url === null) return;
    remember(option);
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
    } else if (event.key === 'Backspace' && term.value === '' && action.value !== null) {
        event.preventDefault();
        leaveAction();
    }
}

/** Key caps are symbols, not words: the same in both languages. */
const KEYS = { enter: '↵', shift: '⇧', up: '↑', down: '↓', back: '⌫' } as const;

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
                        <PhMagnifyingGlass v-if="action === null" :size="20" class="shrink-0 text-ink-3" aria-hidden="true" />
                        <button
                            v-else
                            type="button"
                            :class="[focusRing, 'inline-flex h-24 max-w-240 shrink-0 items-center gap-4 rounded-xs border border-line bg-raised px-8 text-caption text-ink hover:bg-hover']"
                            :aria-label="trans('shell.palette.leave_action', { action: trans(action.label) })"
                            data-testid="ADM-07.palette.action"
                            @click="leaveAction"
                        >
                            <span class="truncate">{{ trans(action.label) }}</span>
                        </button>
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
                            :placeholder="placeholder"
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
                            {{ emptyText }}
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
                                v-if="(option.kind === 'record' || option.kind === 'target') && option.url"
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
                        <span v-if="action !== null" class="flex items-center gap-4"><Kbd>{{ KEYS.back }}</Kbd>{{ trans('shell.palette.back') }}</span>
                    </footer>
                </DialogContent>
            </div>
        </DialogPortal>
    </DialogRoot>
</template>
