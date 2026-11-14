<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhEye, PhEyeSlash, PhFunnel, PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import VehicleThumb from '../../Components/patterns/VehicleThumb.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Tabs, type TabItem, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import type { Paginated, SavedView, TableQuery } from '../../types/table';

/**
 * ADM-58 Editorial & Beispiele (09 §8.19, §10.3): whether sample content shows in each environment (the flag `editorial_samples`; only
 * this environment's value takes effect, production stays off until the client supplies real, consented builds), what sample content
 * exists, and the sample builds, meets and businesses with how members see them now. "Ausblenden" takes one item out of every member
 * read (a build goes private, a meet or business is removed) while the flag stays on; "Wieder zeigen" restores it. Both ⚿ with a
 * reason, audited; the flag change goes through ADM-36's rules (a critical flag in production is four-eyes).
 */
type Tab = 'vehicle' | 'event' | 'business';
type ItemState = 'shown' | 'hidden' | 'withdrawn';
interface SampleRow {
    id: string;
    type: Tab;
    title: string;
    caption: string | null;
    owner: string | null;
    cover: string | null;
    cover_placeholder: string | null;
    state: ItemState;
    hidden: { at: string; by: string | null; reason: string } | null;
    created_at: string | null;
}
interface FlagState {
    id: number;
    enabled: boolean;
    environments: Record<'local' | 'staging' | 'production', boolean>;
    critical: boolean;
    pending: boolean;
    updated_at: string | null;
}
type Summary = Record<'members' | 'vehicles' | 'updates' | 'events' | 'businesses' | 'hidden', number>;

const props = defineProps<{
    rows: Paginated<SampleRow>;
    query: TableQuery;
    views: SavedView[];
    tab: Tab;
    environment: 'local' | 'staging' | 'production';
    flag?: FlagState | null;
    summary?: Summary;
    editorial?: { id: string; username: string | null } | null;
    canEdit: boolean;
    canToggle: boolean;
}>();

const { can } = usePermissions();
const state = usePageState();
const editorialUrl = (): string => routeOr('admin.editorial.index', '/admin/editorial');
/** The flag's key, a code identifier (not copy). */
const FLAG_KEY = 'editorial_samples';
const flagKeyClass = 'sc-key inline-flex font-ui h-20 items-center rounded-xs border border-line bg-raised px-4 text-caption text-ink-2';
const flagsHref = computed(() => (can('flags.manage') && hasRoute('admin.config.flags') ? `${routeOr('admin.config.flags', '/admin/config/flags')}?flag=${FLAG_KEY}` : null));

// ---- flag per environment ---------------------------------------------------------------------------------------------------
const ENVIRONMENTS = ['local', 'staging', 'production'] as const;
const flagAction = useAdminAction();
const flagOpen = ref(qaDialog() === 'flag');
const nextEnabled = computed(() => !(props.flag?.enabled ?? false));
const fourEyes = computed(() => props.environment === 'production' && (props.flag?.critical ?? false));
function changeFlag(reason: string | null): void {
    flagAction.run('post', routeOr('admin.editorial.flag', '/admin/editorial/flag'), { enabled: nextEnabled.value, reason: reason ?? '' }, { sensitive: true, onSuccess: () => (flagOpen.value = false) });
}

// ---- summary ------------------------------------------------------------------------------------------------------------------
const SUMMARY_KEYS = ['vehicles', 'updates', 'events', 'businesses', 'members', 'hidden'] as const;
const total = computed(() => (props.summary ? props.summary.vehicles + props.summary.events + props.summary.businesses + props.summary.members : null));
const memberHref = (id: string): string | null => (can('members.view') && hasRoute('admin.members.show') ? routeOr('admin.members.show', `/admin/members/${id}`, { member: id }) : null);

// ---- tabs, table --------------------------------------------------------------------------------------------------------------
const SUMMARY_OF: Record<Tab, 'vehicles' | 'events' | 'businesses'> = { vehicle: 'vehicles', event: 'events', business: 'businesses' };
const tabs = computed<TabItem[]>(() => (['vehicle', 'event', 'business'] as const).map((value) => ({ value, label: trans(`editorial.tabs.${value}`), count: state.value === 'empty' ? 0 : props.summary ? props.summary[SUMMARY_OF[value]] : null })));
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => router.get(editorialUrl(), tab === 'vehicle' ? {} : { tab }, { preserveState: false }),
});
const columns = computed<TableColumn[]>(() => [
    { key: 'cover', label: trans('editorial.columns.cover'), srOnlyLabel: true, hideable: false },
    { key: 'title', label: trans('editorial.columns.title'), grow: true, hideable: false },
    { key: 'owner', label: trans('editorial.columns.owner'), min: 160 },
    { key: 'state', label: trans('editorial.columns.state'), min: 160 },
    { key: 'created_at', label: trans('editorial.columns.created'), sort: 'created_at', min: 120 },
    ...(props.canEdit ? [{ key: 'actions', label: trans('editorial.columns.actions'), srOnlyLabel: true, hideable: false } satisfies TableColumn] : []),
]);
const RECORDS: Record<Tab, { route: string; path: string; param: string }> = {
    vehicle: { route: 'admin.vehicles.show', path: 'vehicles', param: 'vehicle' },
    event: { route: 'admin.events.show', path: 'events', param: 'event' },
    business: { route: 'admin.businesses.show', path: 'businesses', param: 'business' },
};
const recordHref = (row: SampleRow): string | null => {
    const record = RECORDS[row.type];
    return hasRoute(record.route) ? routeOr(record.route, `/admin/${record.path}/${row.id}`, { [record.param]: row.id }) : null;
};
const stateTones: Record<ItemState, Tone> = { shown: 'success', hidden: 'warning', withdrawn: 'neutral' };

const filters = reactive({ q: '', state: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.state = filter.state ?? '';
    },
    { immediate: true },
);
const ANY = '*';
const stateModel = computed({ get: () => filters.state || undefined, set: (v: string | undefined) => (filters.state = v === undefined || v === ANY ? '' : v) });
const stateOptions = computed(() => [{ value: ANY, label: trans('editorial.filters.any') }, ...(['shown', 'hidden'] as const).map((v) => ({ value: v, label: trans(`editorial.filters.state_${v}`) }))]);

// ---- hide / show one item -------------------------------------------------------------------------------------------------------
const itemAction = useAdminAction();
const target = ref<SampleRow | null>(null);
const itemOpen = ref(false);
function ask(row: SampleRow): void {
    target.value = row;
    itemAction.reset();
    itemOpen.value = true;
}
// QA cell ADM-58-hide (non-production): the dialog over the first visible row.
watch(
    () => props.rows.data,
    (rows) => {
        if (qaDialog() !== 'hide' || target.value !== null) return;
        const first = rows.find((row) => row.state === 'shown');
        if (first) ask(first);
    },
    { immediate: true },
);
const hiding = computed(() => target.value?.state !== 'hidden');
function confirmItem(reason: string | null): void {
    const row = target.value;
    if (!row) return;
    const verb = hiding.value ? 'hide' : 'show';
    itemAction.run('post', routeOr(`admin.editorial.items.${verb}`, `/admin/editorial/items/${row.id}/${verb}`, { item: row.id }), { type: row.type, reason: reason ?? '' }, { sensitive: true, onSuccess: () => (itemOpen.value = false) });
}
// The server names refusals by key (editorial.errors.*); validation messages come in words.
const itemError = computed(() => {
    const error = itemAction.error.value;
    return error !== null && error.startsWith('editorial.') ? trans(error) : error;
});

const forcedTable = computed(() => (state.value === 'loading' || state.value === 'error' || state.value === 'empty' ? state.value : undefined));
const flagState = computed(() => (state.value === 'loading' ? 'loading' : state.value === 'error' ? 'error' : 'ready'));
</script>

<template>
    <Head :title="trans('editorial.title')" />
    <div class="flex flex-col gap-32" data-testid="ADM-58" :data-qa-state="state">
        <PageHeader :title="trans('editorial.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('editorial.intro')" />

        <!-- 1 · visibility per environment -->
        <section aria-labelledby="editorial-flag" class="flex flex-col gap-12" data-testid="ADM-58.flag">
            <div class="flex flex-wrap items-baseline justify-between gap-8">
                <h2 id="editorial-flag" class="text-headline text-ink">{{ trans('editorial.flag.title') }}</h2>
                <!-- DQ-1203: the flag by its name; the key only as a code chip that opens Feature-Flags -->
                <p class="flex items-center gap-8 text-caption text-ink-3">
                    {{ trans('editorial.flag.hint') }}
                    <Link v-if="flagsHref" :href="flagsHref" :class="[focusRing, 'inline-flex min-h-32 items-center rounded-xs hover:underline']" data-testid="ADM-58.flag.key"><code :class="flagKeyClass">{{ FLAG_KEY }}</code></Link>
                    <code v-else :class="flagKeyClass">{{ FLAG_KEY }}</code>
                </p>
            </div>
            <div v-if="flagState === 'loading'" class="flex flex-col gap-8" aria-hidden="true"><Skeleton v-for="n in 3" :key="n" class="h-40 w-full max-w-720" /></div>
            <StateBlock v-else-if="flagState === 'error'" kind="error" :title="trans('editorial.flag.error')" :body="trans('ui.state.error_body')" test-id="ADM-58.flag.error" @retry="router.reload({ only: ['flag'] })" />
            <StateBlock v-else-if="!flag" kind="partial" :title="trans('editorial.flag.missing_title')" :body="trans('editorial.flag.missing_body')" :retryable="false" test-id="ADM-58.flag.missing" />
            <template v-else>
                <table class="w-full max-w-720 border-collapse text-admin-base">
                    <caption class="sr-only">{{ trans('editorial.flag.caption') }}</caption>
                    <thead>
                        <tr class="h-32 border-b border-line-subtle text-left text-caption text-ink-3">
                            <th scope="col" class="font-normal">{{ trans('editorial.flag.environment') }}</th>
                            <th scope="col" class="font-normal">{{ trans('editorial.flag.samples') }}</th>
                            <th scope="col" class="font-normal"><span class="sr-only">{{ trans('editorial.flag.note') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="env in ENVIRONMENTS" :key="env" class="h-40 border-b border-line-subtle" :data-testid="`ADM-58.flag.${env}`">
                            <th scope="row" class="text-left font-normal text-ink">
                                <span class="flex items-center gap-8">
                                    {{ trans(`editorial.environments.${env}`) }}
                                    <Badge v-if="env === environment" tone="neutral">{{ trans('editorial.flag.here') }}</Badge>
                                </span>
                            </th>
                            <td><StatusPill :tone="flag.environments[env] ? 'success' : 'neutral'" :label="trans(flag.environments[env] ? 'editorial.flag.on' : 'editorial.flag.off')" /></td>
                            <td class="text-caption text-ink-3">{{ env === environment ? trans('editorial.flag.effective') : trans('editorial.flag.documented') }}</td>
                        </tr>
                    </tbody>
                </table>
                <div class="flex flex-wrap items-center gap-12">
                    <Button v-if="canToggle" size="sm" variant="secondary" :icon="flag.enabled ? PhEyeSlash : PhEye" :disabled="flag.pending" data-testid="ADM-58.flag.toggle" @click="flagOpen = true">
                        {{ trans(flag.enabled ? 'editorial.flag.turn_off' : 'editorial.flag.turn_on') }}
                    </Button>
                    <p v-if="flag.pending" class="text-admin-base text-ink-2" data-testid="ADM-58.flag.pending">{{ trans('editorial.flag.pending') }}</p>
                    <p v-else-if="!canToggle" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-58.flag.view-only">
                        <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('editorial.flag.view_only') }}
                    </p>
                    <p v-if="flag.updated_at" class="text-caption text-ink-3 tabular-nums">{{ trans('editorial.flag.updated', { date: formatDateTime(flag.updated_at) }) }}</p>
                </div>
            </template>
        </section>

        <!-- 2 · what exists -->
        <section aria-labelledby="editorial-summary" class="flex flex-col gap-12" data-testid="ADM-58.summary">
            <div class="flex flex-wrap items-baseline justify-between gap-8">
                <h2 id="editorial-summary" class="text-headline text-ink">{{ trans('editorial.summary.title') }}</h2>
                <p v-if="editorial" class="flex items-center gap-4 text-admin-base text-ink-2">
                    {{ trans('editorial.summary.account') }}
                    <Link v-if="memberHref(editorial.id)" :href="memberHref(editorial.id) ?? ''" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" data-testid="ADM-58.editorial">
                        {{ `@${editorial.username ?? '–'}` }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                    </Link>
                    <span v-else class="sc-key text-ink">{{ `@${editorial.username ?? '–'}` }}</span>
                </p>
            </div>
            <div data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3 wide:grid-cols-6">
                <div v-for="key in SUMMARY_KEYS" :key="key" class="flex min-w-0 flex-col gap-4 bg-surface px-16 py-12" :data-testid="`ADM-58.summary.${key}`">
                    <p class="truncate text-caption text-ink-2">{{ trans(`editorial.summary.${key}`) }}</p>
                    <Skeleton v-if="state === 'loading' || !summary" class="h-28 w-48" />
                    <p v-else class="font-numeral text-hero-numeral-s tabular-nums" :class="state === 'empty' || summary[key] === 0 ? 'text-ink-3' : 'text-ink'">{{ formatNumber(state === 'empty' ? 0 : summary[key]) }}</p>
                </div>
            </div>
            <p v-if="total === 0 || state === 'empty'" class="text-admin-base text-ink-2" data-testid="ADM-58.summary.none">{{ trans('editorial.summary.none') }}</p>
        </section>

        <!-- 3 · the items -->
        <section aria-labelledby="editorial-items" class="flex flex-col gap-12">
            <h2 id="editorial-items" class="text-headline text-ink">{{ trans('editorial.items.title') }}</h2>
            <Tabs v-model="tabModel" :items="tabs" :label="trans('editorial.tabs.label')" :panels="false" data-testid="ADM-58.tabs" />
            <p v-if="!canEdit" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-58.view-only">
                <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('editorial.items.view_only') }}
            </p>
            <DataTable
                :id="`editorial-${tab}`"
                :key="tab"
                :columns="columns"
                :rows="rows"
                :query="query"
                :views="views"
                :only="['rows', 'query', 'views', 'summary']"
                :caption="trans(`editorial.items.caption_${tab}`)"
                :empty-title="trans(`editorial.empty.${tab}_title`)"
                :empty-body="trans(`editorial.empty.${tab}_body`)"
                :row-href="recordHref"
                :force-state="forcedTable"
                test-id="ADM-58.table"
            >
                <template #filters="{ apply, loading }">
                    <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('editorial.filters.label')" @submit.prevent="apply({ ...filters })">
                        <div class="min-w-200 grow-2 basis-0">
                            <Field :label="trans('editorial.filters.q')">
                                <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans(`editorial.filters.q_${tab}`)" data-testid="ADM-58.filter.q" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('editorial.filters.state')">
                                <Select v-model="stateModel" :options="stateOptions" size="sm" :placeholder="trans('editorial.filters.any')" data-testid="ADM-58.filter.state" />
                            </Field>
                        </div>
                        <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-58.filter.apply">
                            {{ trans('editorial.filters.apply') }}
                        </Button>
                    </form>
                </template>

                <template #cell-cover="{ row }">
                    <VehicleThumb :src="row.cover" :placeholder="row.cover_placeholder" />
                </template>
                <template #cell-title="{ row }">
                    <NameCell :name="row.title" :caption="row.caption" :href="recordHref(row)" test-id="ADM-58.open">
                        <template #preview>
                            <div class="flex flex-col gap-8" data-testid="ADM-58.hover">
                                <img v-if="row.cover" :src="row.cover" alt="" width="64" height="48" class="h-48 w-64 rounded-xs object-cover" />
                                <p class="text-admin-base-strong text-ink">{{ row.title }}</p>
                                <p class="text-caption text-ink-2">{{ trans(`editorial.state_hint.${row.state}`) }}</p>
                                <p v-if="row.hidden" class="text-caption text-ink-3 tabular-nums">{{ trans('editorial.hidden_by', { name: row.hidden.by ?? '–', date: formatDateTime(row.hidden.at) }) }}</p>
                                <p v-if="row.hidden" class="line-clamp-3 text-caption text-ink-2">{{ row.hidden.reason }}</p>
                            </div>
                        </template>
                    </NameCell>
                </template>
                <template #cell-owner="{ row }">
                    <span class="sc-key block truncate text-admin-base text-ink-2">{{ row.owner ? `@${row.owner}` : '–' }}</span>
                </template>
                <template #cell-state="{ row }">
                    <span class="flex flex-col items-start gap-2">
                        <StatusPill :tone="stateTones[row.state as ItemState]" :label="trans(`editorial.states.${row.state}`)" />
                        <span v-if="row.hidden" class="text-caption text-ink-3 tabular-nums">{{ formatDate(row.hidden.at) }}</span>
                    </span>
                </template>
                <template #cell-created_at="{ row }">
                    <time :datetime="row.created_at ?? undefined" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
                </template>
                <template #cell-actions="{ row }">
                    <span class="flex justify-end">
                        <Button
                            v-if="row.state !== 'withdrawn'"
                            size="sm"
                            variant="ghost"
                            :icon="row.state === 'hidden' ? PhEye : PhEyeSlash"
                            :data-testid="row.state === 'hidden' ? 'ADM-58.show' : 'ADM-58.hide'"
                            :aria-label="trans(row.state === 'hidden' ? 'editorial.actions.show_named' : 'editorial.actions.hide_named', { name: row.title })"
                            @click.stop.prevent="ask(row as SampleRow)"
                        >
                            {{ trans(row.state === 'hidden' ? 'editorial.actions.show' : 'editorial.actions.hide') }}
                        </Button>
                    </span>
                </template>
            </DataTable>
        </section>

        <ConfirmDialog
            v-if="flag"
            v-model:open="flagOpen"
            :title="trans(nextEnabled ? 'editorial.flag_dialog.on_title' : 'editorial.flag_dialog.off_title', { environment: trans(`editorial.environments.${environment}`) })"
            :body="trans(nextEnabled ? 'editorial.flag_dialog.on_body' : 'editorial.flag_dialog.off_body')"
            :confirm-label="trans(nextEnabled ? 'editorial.flag.turn_on' : 'editorial.flag.turn_off')"
            tone="neutral"
            reason
            reason-first
            :four-eyes="fourEyes"
            :processing="flagAction.processing.value"
            :error="flagAction.error.value"
            test-id="ADM-58.flag-dialog"
            @confirm="changeFlag"
        />
        <ConfirmDialog
            v-if="target"
            v-model:open="itemOpen"
            :title="trans(hiding ? 'editorial.item_dialog.hide_title' : 'editorial.item_dialog.show_title', { name: target.title })"
            :body="trans(hiding ? `editorial.item_dialog.hide_body_${target.type}` : 'editorial.item_dialog.show_body')"
            :confirm-label="trans(hiding ? 'editorial.actions.hide' : 'editorial.actions.show')"
            :tone="hiding ? 'danger' : 'neutral'"
            reason
            reason-first
            :processing="itemAction.processing.value"
            :error="itemError"
            test-id="ADM-58.item-dialog"
            @confirm="confirmItem"
        />
    </div>
</template>
