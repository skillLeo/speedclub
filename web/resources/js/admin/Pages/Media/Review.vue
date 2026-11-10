<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhCheck, PhEye, PhEyeSlash, PhFlag, PhImageBroken, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import HideDialog from '../../Components/decisions/HideDialog.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, EmptyQueue, Field, IconButton, Kbd, Pagination, Skeleton, StatusPill, Tabs, Textarea, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { requestJson } from '../../lib/http';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated } from '../../types/table';

/**
 * ADM-13 media review queue (06 §3 Vehicles & media, m3.2-contract §2): Neu · Gemeldet · Ausgeblendet. Keyboard: J / K next / previous,
 * A approve (media.review), H hide (media.hide: opens the statement of reasons, recent password), with the hint always visible.
 * The [AI] risk score column stays hidden until `ai.moderation_triage` is on (M3.7). Chat photos never appear here.
 */
type Tab = 'new' | 'reported' | 'hidden';
interface Item {
    id: string;
    url: string | null;
    alt: string | null;
    width: number | null;
    height: number | null;
    kind: string;
    category: string | null;
    owner: { id: string; username: string | null } | null;
    vehicle: { id: string; title: string } | null;
    mod: string | null;
    moderation_status: string;
    reviewed_at: string | null;
    created_at: string | null;
    case: { id: string; report_count: number } | null;
    ai_score: number | null;
    ai_summary?: string | null;
    /** A blurred stand-in drawn from the blurhash (no original bytes), for a removed photo. */
    placeholder?: string | null;
    /** The removal decision of a hidden photo: when and on which ground. */
    hidden?: { at: string; ground: string | null } | null;
    /** The staff member may open the private original (audited, signed URL for 5 minutes, DQ-532). */
    can_reveal?: boolean;
}

const props = defineProps<{ tab: Tab; items: Paginated<Item>; counts?: Record<Tab, number>; aiTriage: boolean }>();

const { can } = usePermissions();
const loading = ref(false);
const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : 'ready'));
const list = computed(() => (state.value === 'empty' ? [] : props.items.data));

// A forced empty state (?qaState=empty) counts nothing either, so the tab never says "Neu 47" over "Alles geprüft" (DQ-548).
const tabs = computed<TabItem[]>(() =>
    (['new', 'reported', 'hidden'] as const).map((value) => ({ value, label: trans(`media.tabs.${value}`), count: state.value === 'empty' ? 0 : (props.counts?.[value] ?? null) })),
);
function visit(data: Record<string, string | number>): void {
    router.get(routeOr('admin.media.index', '/admin/media-review'), data, {
        preserveScroll: false,
        preserveState: true,
        replace: true,
        only: ['tab', 'items', 'counts'],
        onStart: () => {
            loading.value = true;
            failed.value = false;
        },
        onFinish: () => (loading.value = false),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => visit(tab === 'new' ? {} : { tab }),
});
function goToPage(page: number): void {
    visit({ ...(props.tab === 'new' ? {} : { tab: props.tab }), ...(page > 1 ? { page } : {}) });
}

// ---- selection and keyboard ---------------------------------------------------------------------------------------------
const selected = ref(0);
const cards = ref<HTMLElement[]>([]);
watch(
    () => props.items,
    () => (selected.value = Math.min(selected.value, Math.max(0, props.items.data.length - 1))),
);
const current = computed<Item | null>(() => list.value[selected.value] ?? null);
function select(index: number, focus = true): void {
    if (list.value.length === 0) return;
    selected.value = Math.max(0, Math.min(list.value.length - 1, index));
    if (focus) void nextTick(() => cards.value[selected.value]?.focus());
}
const dialogOpen = computed(() => hideOpen.value || unhideOpen.value);
/**
 * J/K/A/H work only while the focus is inside the queue (a card or its buttons), never window-wide and never in a field, so a typed
 * or spoken letter elsewhere does nothing (WCAG 2.1.4). A held key fires once; A does nothing while an approval is on its way.
 */
function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || dialogOpen.value) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null)) return;
    const key = event.key.toLowerCase();
    if (key === 'j') select(selected.value + 1);
    else if (key === 'k') select(selected.value - 1);
    else if (key === 'a' && current.value && canApprove(current.value)) approve(current.value);
    else if (key === 'h' && current.value && canHide(current.value)) openHide(current.value);
    else return;
    event.preventDefault();
}

// ---- actions ----------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const target = ref<Item | null>(null);
const hideOpen = ref(false);
const unhideOpen = ref(false);
const unhideFacts = ref('');
const unhideError = ref<string | null>(null);
const approving = ref<string | null>(null);
const canApprove = (item: Item): boolean => can('media.review') && props.tab !== 'hidden' && item.moderation_status !== 'rejected' && item.reviewed_at === null;
const canHide = (item: Item): boolean => can('media.hide') && item.moderation_status !== 'rejected';
const url = (item: Item, name: string) => routeOr(`admin.media.${name}`, `/admin/media-review/${item.id}/${name}`, { media: item.id });

/** After A or H the next card is selected (DQ-531): an item that left the queue makes room for the next one at the same index. */
function advanceFrom(id: string): void {
    const index = list.value.findIndex((item) => item.id === id);
    select(index === -1 ? selected.value : index + 1);
}
function approve(item: Item): void {
    if (approving.value !== null) return;
    approving.value = item.id;
    router.post(url(item, 'approve'), {}, {
        preserveScroll: true,
        preserveState: true,
        only: ['items', 'counts', 'flash'],
        onSuccess: () => advanceFrom(item.id),
        onFinish: () => (approving.value = null),
    });
}
function openHide(item: Item): void {
    target.value = item;
    action.reset();
    hideOpen.value = true;
}
function hide(payload: Record<string, string | null>): void {
    if (!target.value) return;
    const id = target.value.id;
    action.run('post', url(target.value, 'hide'), payload, {
        sensitive: true,
        onSuccess: () => {
            hideOpen.value = false;
            advanceFrom(id);
        },
    });
}
function openUnhide(item: Item): void {
    target.value = item;
    unhideFacts.value = '';
    unhideError.value = null;
    action.reset();
    unhideOpen.value = true;
}
function unhide(reason: string | null): void {
    if (!target.value) return;
    const length = unhideFacts.value.trim().length;
    if (length < 10 || length > 5000) {
        unhideError.value = trans('decisions.errors.facts');
        return;
    }
    unhideError.value = null;
    action.run('post', url(target.value, 'unhide'), { facts: unhideFacts.value.trim(), reason: reason ?? '' }, { sensitive: true, onSuccess: () => (unhideOpen.value = false) });
}

const vehicleHref = (id: string) => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const emptyKey = computed(() => (props.tab === 'new' ? 'new' : props.tab === 'reported' ? 'reported' : 'hidden'));

// "3 von 47": where the selected card stands in the whole queue of this tab.
const position = computed(() => (list.value.length === 0 ? null : (props.items.meta.from ?? 1) + selected.value));
// Only the shortcuts that can act on a visible card (DQ-548).
const hints = computed(() => ({
    move: list.value.length > 1,
    approve: list.value.some((item) => canApprove(item)),
    hide: list.value.some((item) => canHide(item)),
}));

// ---- the private original of a removed photo (DQ-532): blurred until "Anzeigen", which is audited -------------------------------
const originals = ref<Record<string, string>>({});
const revealing = ref<string | null>(null);
const revealFailed = ref<string | null>(null);
async function reveal(item: Item): Promise<void> {
    revealing.value = item.id;
    revealFailed.value = null;
    try {
        const answer = await requestJson<{ url?: string }>('post', routeOr('admin.media.original', `/admin/media-review/${item.id}/original`, { media: item.id }));
        if (typeof answer.url === 'string') originals.value = { ...originals.value, [item.id]: answer.url };
    } catch {
        revealFailed.value = item.id;
    } finally {
        revealing.value = null;
    }
}

// ---- QA overlays (?dialog=hide|unhide, non-production, DQ-529) ----------------------------------------------------------------
const qaOverlay = qaDialog();
const hidePreset = qaOverlay === 'hide' ? { template: 'nudity' } : null;
onMounted(async () => {
    const first = list.value[0];
    if (!first) return;
    if (qaOverlay === 'hide' && canHide(first)) openHide(first);
    else if (qaOverlay === 'unhide' && props.tab === 'hidden') openUnhide(first);
    else return;
    await nextTick();
    if (qaDialogFailed()) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('media.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-13" :data-qa-state="state">
        <PageHeader :title="trans('media.title')" :crumbs="[{ label: trans('shell.groups.vehicles_media') }]" :description="trans('media.intro')" />

        <Tabs v-model="tabModel" :items="tabs" :label="trans('media.tabs.label')" :panels="false" />

        <!-- keyboard hints for what can act on the visible cards, and where the selection stands -->
        <div class="flex min-h-24 flex-wrap items-center justify-between gap-12" data-testid="ADM-13.toolbar">
            <p v-if="state === 'ready' && list.length > 0" class="flex flex-wrap items-center gap-12 text-caption text-ink-2" data-testid="ADM-13.shortcuts">
                <span>{{ trans('media.keys.scope') }}</span>
                <span v-if="hints.move" class="flex items-center gap-4"><Kbd>{{ trans('media.keys.key_j') }}</Kbd><Kbd>{{ trans('media.keys.key_k') }}</Kbd>{{ trans('media.keys.move') }}</span>
                <span v-if="hints.approve" class="flex items-center gap-4"><Kbd>{{ trans('media.keys.key_a') }}</Kbd>{{ trans('media.keys.approve') }}</span>
                <span v-if="hints.hide" class="flex items-center gap-4"><Kbd>{{ trans('media.keys.key_h') }}</Kbd>{{ trans('media.keys.hide') }}</span>
            </p>
            <p v-if="state === 'ready' && position !== null" class="text-caption text-ink-2 tabular-nums" aria-live="polite" data-testid="ADM-13.position">
                {{ trans('media.position', { n: formatNumber(position), total: formatNumber(items.meta.total) }) }}
            </p>
        </div>

        <div v-if="state === 'loading' || loading" class="grid grid-cols-2 gap-16 tablet:grid-cols-3 wide:grid-cols-4" aria-busy="true" data-testid="ADM-13.loading">
            <!-- The lines of a ready card: photo, vehicle, owner · date · part, badges, one action row (DQ-533). -->
            <div v-for="n in 8" :key="n" class="flex flex-col gap-8 rounded-md border border-line-subtle bg-surface p-12">
                <Skeleton class="aspect-4/3 w-full" />
                <div class="flex flex-col gap-2">
                    <span class="flex h-32 items-center"><Skeleton shape="text" class="w-3/4" /></span>
                    <span class="flex h-32 items-center"><Skeleton shape="text" class="w-1/2" /></span>
                </div>
                <div class="flex gap-8"><Skeleton class="h-32 w-120" /><Skeleton class="size-32" /></div>
            </div>
        </div>
        <StateBlock v-else-if="state === 'error'" kind="error" :title="trans('media.error')" :body="trans('ui.state.error_body')" test-id="ADM-13.error" @retry="visit(tab === 'new' ? {} : { tab })" />
        <EmptyQueue v-else-if="list.length === 0" :variant="tab === 'new' ? 'clear' : 'quiet'" :icon="tab === 'reported' ? PhFlag : tab === 'hidden' ? PhEyeSlash : undefined" :title="trans(`media.empty.${emptyKey}_title`)" :body="trans(`media.empty.${emptyKey}_body`)" data-testid="ADM-13.empty" />

        <template v-else>
            <ul class="grid grid-cols-2 gap-16 tablet:grid-cols-3 wide:grid-cols-4" :aria-label="trans('media.queue')" aria-keyshortcuts="J K A H" data-testid="ADM-13.queue" @keydown="onKey">
                <li v-for="(item, index) in list" :key="item.id">
                    <!-- The selected card carries the focus ring and its actions; the others show theirs on hover or focus, in the same
                         reserved row, so the height never changes (DQ-531). -->
                    <article
                        :ref="(el) => { if (el) cards[index] = el as HTMLElement; }"
                        tabindex="0"
                        :aria-current="index === selected ? 'true' : undefined"
                        :aria-label="trans('media.card_label', { owner: item.owner?.username ? `@${item.owner.username}` : '–', date: formatDateTime(item.created_at) })"
                        :class="[
                            focusRing,
                            'group flex h-full flex-col gap-8 rounded-md border bg-surface p-12',
                            index === selected ? 'border-ink outline-2 outline-offset-2 outline-focus' : 'border-line-subtle',
                        ]"
                        :data-testid="`ADM-13.item`"
                        :data-selected="index === selected || undefined"
                        @focus="select(index, false)"
                        @click="select(index, false)"
                    >
                        <img
                            v-if="item.url && item.moderation_status !== 'rejected'"
                            :src="item.url"
                            :alt="item.alt ?? trans('media.photo_alt')"
                            :width="item.width ?? undefined"
                            :height="item.height ?? undefined"
                            class="aspect-4/3 w-full rounded-sm object-cover"
                            loading="lazy"
                        />
                        <!-- removed: the private original, blurred until "Anzeigen" (audited); without it the placeholder -->
                        <div v-else-if="item.can_reveal" class="relative aspect-4/3 w-full overflow-hidden rounded-sm bg-raised" data-testid="ADM-13.original">
                            <img v-if="originals[item.id]" :src="originals[item.id]" :alt="item.alt ?? trans('media.photo_alt')" class="size-full object-cover" data-testid="ADM-13.original.image" />
                            <template v-else>
                                <img v-if="item.placeholder" :src="item.placeholder" alt="" width="16" height="12" class="size-full object-cover blur-md" />
                                <div class="absolute inset-0 flex flex-col items-center justify-center gap-8 px-12 text-center">
                                    <Button size="sm" variant="secondary" class="bg-surface" :icon="PhEye" :loading="revealing === item.id" data-testid="ADM-13.reveal" @click.stop="reveal(item)">{{ trans('media.reveal') }}</Button>
                                    <p class="rounded-xs bg-surface px-4 text-caption text-ink-2">{{ revealFailed === item.id ? trans('media.reveal_failed') : trans('media.reveal_note') }}</p>
                                </div>
                            </template>
                        </div>
                        <div v-else class="flex aspect-4/3 w-full items-center justify-center rounded-sm border border-line-subtle bg-raised text-ink-3">
                            <PhImageBroken :size="24" :aria-label="trans('media.removed')" />
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <p class="flex min-w-0 items-center gap-8 text-supporting text-ink">
                                <Link v-if="item.vehicle" :href="vehicleHref(item.vehicle.id)" :title="item.vehicle.title" :class="[focusRing, 'inline-flex min-h-32 min-w-0 items-center rounded-xs hover:underline']"><span class="truncate">{{ item.vehicle.title }}</span></Link>
                                <span v-else class="truncate">{{ trans(`media.kinds.${item.kind}`) }}</span>
                            </p>
                            <!-- one meta line, parts separated by "·" (DQ-546) -->
                            <p class="flex min-w-0 flex-wrap items-center gap-x-4 text-caption text-ink-2 tabular-nums">
                                <Link v-if="item.owner" :href="memberHref(item.owner.id)" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs hover:underline']">{{ item.owner.username ? `@${item.owner.username}` : '–' }}</Link>
                                <span aria-hidden="true">·</span>
                                <span :title="formatDateTime(item.created_at)">{{ formatDate(item.created_at) }}</span>
                                <template v-if="item.category">
                                    <span aria-hidden="true">·</span>
                                    <span>{{ trans(`media.categories.${item.category}`) }}</span>
                                </template>
                                <template v-if="item.mod">
                                    <span aria-hidden="true">·</span>
                                    <span class="truncate" :title="item.mod">{{ item.mod }}</span>
                                </template>
                            </p>
                            <p v-if="item.hidden" class="text-caption text-ink-3 tabular-nums" data-testid="ADM-13.hidden-line">
                                {{ item.hidden.ground ? trans('media.hidden_line', { date: formatDateTime(item.hidden.at), ground: item.hidden.ground }) : trans('media.hidden_since', { date: formatDateTime(item.hidden.at) }) }}
                            </p>
                        </div>
                        <div v-if="item.case || item.moderation_status === 'rejected' || item.reviewed_at || (aiTriage && item.ai_score !== null)" class="flex flex-wrap items-center gap-8">
                            <Badge v-if="item.case" tone="warning" tnum><PhWarning :size="16" aria-hidden="true" />{{ trans('media.reports', { count: formatNumber(item.case.report_count) }) }}</Badge>
                            <StatusPill v-if="item.moderation_status === 'rejected'" tone="danger" :label="trans('media.status.hidden')" />
                            <StatusPill v-else-if="item.reviewed_at" tone="success" :label="trans('media.status.approved')" />
                            <!-- [AI] risk score (M3.7): only with ai.moderation_triage -->
                            <Badge v-if="aiTriage && item.ai_score !== null" tone="info" tnum :title="item.ai_summary ?? undefined" data-testid="ADM-13.ai-score">{{ trans('media.ai_score', { score: formatNumber(Math.round(item.ai_score * 100)) }) }}</Badge>
                        </div>
                        <div
                            v-if="canApprove(item) || canHide(item) || (tab === 'hidden' && can('media.hide'))"
                            class="mt-auto flex items-center gap-8"
                            :class="index === selected ? '' : 'invisible group-hover:visible group-focus-within:visible'"
                        >
                            <Button v-if="canApprove(item)" size="sm" variant="secondary" :icon="PhCheck" :loading="approving === item.id" data-testid="ADM-13.approve" @click.stop="approve(item)">{{ trans('media.actions.approve') }}</Button>
                            <IconButton v-if="canHide(item)" :icon="PhEyeSlash" variant="destructive" :label="trans('media.actions.hide_key')" data-testid="ADM-13.hide" @click.stop="openHide(item)" />
                            <Button v-if="tab === 'hidden' && can('media.hide')" size="sm" variant="secondary" :icon="PhEye" data-testid="ADM-13.unhide" @click.stop="openUnhide(item)">{{ trans('media.actions.unhide') }}</Button>
                        </div>
                    </article>
                </li>
            </ul>
            <Pagination :meta="items.meta" :per-page-options="[items.meta.per_page]" :disabled="loading" test-id="ADM-13.pagination" @page="goToPage" />
        </template>

        <HideDialog
            v-model:open="hideOpen"
            :preset="hidePreset"
            :title="trans('media.hide.title')"
            :description="trans('media.hide.body')"
            subject="photo"
            :confirm-label="trans('media.actions.hide')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-13.hide-dialog"
            @submit="hide"
        />
        <ConfirmDialog
            v-model:open="unhideOpen"
            :title="trans('media.unhide.title')"
            :body="trans('media.unhide.body')"
            :confirm-label="trans('media.actions.unhide')"
            tone="neutral"
            reason
            :processing="action.processing.value"
            :error="unhideError ?? action.error.value"
            test-id="ADM-13.unhide-dialog"
            @confirm="unhide"
        >
            <Field :label="trans('vehicles.unhide.facts')" :hint="trans('vehicles.unhide.facts_hint')" required>
                <Textarea v-model="unhideFacts" :rows="3" :maxlength="5000" />
            </Field>
        </ConfirmDialog>
    </div>
</template>
