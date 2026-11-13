<script setup lang="ts">
import { Head, usePoll } from '@inertiajs/vue3';
import { PhCheckCircle, PhDownloadSimple, PhFileCsv, PhUploadSimple } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, onMounted, ref, watch } from 'vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, EmptyQueue, Field, SegmentedControl, Skeleton, StatusPill, type Tone } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import SkeletonRows from './Partials/SkeletonRows.vue';
import { useCatalogWrite } from './shared';

/**
 * ADM-17 CSV import (06 §3 Catalogue, m3.3-contract §2; catalog.import): upload makes/models/generations or part brands (templates in
 * the import's own format) → dry run, the diff per row new / changed / unchanged / error with the reason → "Übernehmen" (⚿, reason,
 * catalog.manage too): one queued job through the same Actions as manual edits, with progress and the result per row. More than 100
 * changed rows ask a second staff member first (ApprovalNotice). The file stays on the private disk for 30 days.
 */
type Kind = 'vehicles' | 'brands';
type ImportStatus = 'analysed' | 'awaiting_approval' | 'queued' | 'applying' | 'applied' | 'failed' | 'expired';
type RowStatus = 'new' | 'changed' | 'unchanged' | 'error';
interface Counts {
    new: number;
    changed: number;
    unchanged: number;
    error: number;
}
interface Summary {
    id: string;
    kind: Kind;
    status: ImportStatus;
    file: string;
    rows: number;
    counts: Counts;
    progress: number;
    created_by: string | null;
    applied_by: string | null;
    created_at: string | null;
    finished_at: string | null;
    expires_at: string | null;
}
interface RowError {
    code: string;
    params: Record<string, string | number>;
}
interface Line {
    line: number;
    status: RowStatus;
    level: string | null;
    label: string;
    changes: Record<string, [unknown, unknown]>;
    creates: string[];
    error: RowError | null;
    result: { status: RowStatus | null; error: RowError | null } | null;
}
interface Current extends Summary {
    lines: Line[];
    approval: { id: string; status: string; expires_at: string } | null;
    can_apply: boolean;
    expired: boolean;
    reason: string | null;
}

const props = defineProps<{ history: Summary[]; current: Current | null; limits: { rows: number; megabytes: number; four_eyes_above: number } }>();

const state = usePageState();
const failed = qaDialogFailed();
const { can } = usePermissions();
const history = computed(() => (state.value === 'empty' ? [] : props.history));
const current = computed(() => (state.value === 'empty' ? null : props.current));

// ---- upload -------------------------------------------------------------------------------------------------------------
const kind = ref<Kind>(props.current?.kind ?? 'vehicles');
const kindModel = computed({ get: () => kind.value, set: (v: string) => (kind.value = v === 'brands' ? 'brands' : 'vehicles') });
const kindOptions = computed(() => (['vehicles', 'brands'] as const).map((value) => ({ value, label: trans(`catalog.import.kinds.${value}`) })));
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const upload = useCatalogWrite();
const fileError = ref<string | null>(null);
function pick(event: Event): void {
    file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
    fileError.value = null;
}
function analyse(): void {
    if (file.value === null) {
        fileError.value = trans('catalog.import.errors.no_file');
        return;
    }
    upload.run('post', routeOr('admin.catalog.import.store', '/admin/catalog/import'), { kind: kind.value, file: file.value }, {
        forceFormData: true,
        onSuccess: () => {
            file.value = null;
            if (fileInput.value) fileInput.value.value = '';
        },
    });
}
const uploadError = computed(() => fileError.value ?? upload.errors.value.file ?? upload.errors.value.kind ?? null);
const templateUrl = (k: Kind): string => routeOr('admin.catalog.import.template', `/admin/catalog/import/template/${k}.csv`, { kind: k });

// ---- dry run --------------------------------------------------------------------------------------------------------------
const STATUSES: RowStatus[] = ['new', 'changed', 'unchanged', 'error'];
const rowTones: Record<RowStatus, Tone> = { new: 'info', changed: 'warning', unchanged: 'neutral', error: 'danger' };
const importTones: Record<ImportStatus, Tone> = { analysed: 'info', awaiting_approval: 'warning', queued: 'info', applying: 'info', applied: 'success', failed: 'danger', expired: 'neutral' };
const show = ref<'all' | RowStatus>(props.current && props.current.counts.error > 0 && props.current.lines.length > 0 ? 'error' : 'all');
const showModel = computed({ get: () => show.value, set: (v: string) => (show.value = (STATUSES as string[]).includes(v) ? (v as RowStatus) : 'all') });
const showOptions = computed(() => {
    const c = current.value?.counts;
    return [
        { value: 'all', label: trans('catalog.import.show.all', { count: formatNumber(current.value?.rows ?? 0) }) },
        ...STATUSES.map((s) => ({ value: s, label: trans(`catalog.import.show.${s}`, { count: formatNumber(c?.[s] ?? 0) }) })),
    ];
});
const PAGE = 100;
const limit = ref(PAGE);
watch(show, () => (limit.value = PAGE));
const filtered = computed(() => (current.value?.lines ?? []).filter((l) => show.value === 'all' || l.status === show.value));
const visible = computed(() => filtered.value.slice(0, limit.value));
const changed = computed(() => (current.value ? current.value.counts.new + current.value.counts.changed : 0));
const running = computed(() => current.value?.status === 'queued' || current.value?.status === 'applying');
const progress = computed(() => (current.value && current.value.rows > 0 ? Math.min(100, Math.round((current.value.progress / current.value.rows) * 100)) : 0));
const noLines = computed(() => current.value !== null && current.value.lines.length === 0 && current.value.rows > 0);
const failedLines = computed(() => (current.value?.lines ?? []).filter((l) => l.result?.status === 'error' && l.status !== 'error').length);
const waiting = computed(() => current.value?.status === 'awaiting_approval' && current.value.approval?.status === 'pending');

function attribute(name: string): string {
    const key = `catalog.import.attributes.${name}`;
    const text = trans(key);
    return text === key ? name : text;
}
function value(v: unknown): string {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'boolean') return trans(v ? 'catalog.field.yes' : 'catalog.field.no');
    if (Array.isArray(v)) return v.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ');
    return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v);
}
function changeText(line: Line): string {
    return Object.entries(line.changes)
        .map(([name, [before, after]]) => `${attribute(name)}: ${value(before)} → ${value(after)}`)
        .join(' · ');
}
function errorText(error: RowError | null): string {
    if (error === null) return '';
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(error.params ?? {})) params[k] = k === 'column' || k === 'field' ? attribute(String(v)) : String(v);
    const key = `catalog.import.codes.${error.code}`;
    const text = trans(key, params);
    if (text !== key) return text;
    const refused = `catalog.refused.${error.code}`;
    const fallback = trans(refused, { count: params.count ?? '' });
    return fallback === refused ? trans('catalog.import.codes.failed') : fallback;
}
const levelText = (level: string | null): string => (level ? trans(`catalog.levels.${level}`) : '–');
const createsText = (line: Line): string | null => (line.creates.length === 0 ? null : trans('catalog.import.creates', { levels: line.creates.map((l) => trans(`catalog.levels.${l}`)).join(', ') }));

// ---- apply --------------------------------------------------------------------------------------------------------------
const applyOpen = ref(false);
const apply = useCatalogWrite();
function sendApply(reason: string | null): void {
    const c = current.value;
    if (c === null) return;
    apply.run('post', routeOr('admin.catalog.import.apply', `/admin/catalog/import/${c.id}/apply`, { import: c.id }), { reason }, { sensitive: true, onSuccess: () => (applyOpen.value = false) });
}

// A running apply reports its progress: the page asks every 3 s while it runs.
const poll = usePoll(3000, { only: ['current', 'history'] }, { autoStart: false });
watch(
    running,
    (value) => (value ? poll.start() : poll.stop()),
);
onMounted(() => {
    if (running.value) poll.start();
});

const showHref = (id: string): string => routeOr('admin.catalog.import.show', `/admin/catalog/import/${id}`, { import: id });
const dialog = qaDialog();
if (dialog === 'apply' && props.current?.can_apply) applyOpen.value = true;
const title = computed(() => trans('catalog.import.title'));
</script>

<template>
    <Head :title="title" />
    <div class="flex flex-col gap-32" data-testid="ADM-17" :data-qa-state="state">
        <PageHeader :title="title" :crumbs="[{ label: trans('shell.groups.catalog') }]" :description="trans('catalog.import.intro', { rows: formatNumber(limits.rows), mb: String(limits.megabytes) })">
            <template #actions>
                <Button size="sm" variant="ghost" :icon="PhDownloadSimple" :href="templateUrl('vehicles')" external data-testid="ADM-17.template.vehicles">{{ trans('catalog.import.template_vehicles') }}</Button>
                <Button size="sm" variant="ghost" :icon="PhDownloadSimple" :href="templateUrl('brands')" external data-testid="ADM-17.template.brands">{{ trans('catalog.import.template_brands') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.import.error')" :body="trans('catalog.error_body')" test-id="ADM-17.error" />
        <template v-else>
            <!-- upload -->
            <section class="flex flex-col gap-16 rounded-sm border border-line px-24 py-24" :aria-label="trans('catalog.import.upload_title')" data-testid="ADM-17.upload">
                <div v-if="state === 'loading'" class="flex flex-col gap-12" aria-busy="true">
                    <Skeleton shape="text" class="w-160" /><Skeleton class="h-32 w-240" /><Skeleton class="h-40 w-full" />
                </div>
                <template v-else>
                    <h2 class="text-headline text-ink">{{ trans('catalog.import.upload_title') }}</h2>
                    <form class="flex flex-wrap items-end gap-16" novalidate @submit.prevent="analyse">
                        <div class="flex flex-col gap-4">
                            <span id="adm17-kind" class="text-admin-base-strong text-ink">{{ trans('catalog.import.kind') }}</span>
                            <SegmentedControl v-model="kindModel" class="self-start" size="field-md" :options="kindOptions" aria-labelledby="adm17-kind" :label="trans('catalog.import.kind')" data-testid="ADM-17.kind" />
                        </div>
                        <div class="min-w-240 grow basis-0">
                            <Field :label="trans('catalog.import.file')" :error="uploadError" required>
                                <span class="flex h-40 items-center gap-12 rounded-sm border border-line-control bg-raised px-12">
                                    <PhFileCsv :size="20" class="shrink-0 text-ink-3" aria-hidden="true" />
                                    <span class="min-w-0 grow truncate text-admin-base" :class="file ? 'text-ink' : 'text-ink-3'">{{ file ? file.name : trans('catalog.import.no_file') }}</span>
                                    <input id="adm17-file" ref="fileInput" type="file" accept=".csv,text/csv,text/plain" class="peer sr-only" data-testid="ADM-17.file" @change="pick" />
                                    <label for="adm17-file" :class="['inline-flex h-32 shrink-0 cursor-pointer items-center rounded-sm border border-line-control px-12 text-admin-base-strong text-ink hover:bg-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus']">{{ trans('catalog.import.choose') }}</label>
                                </span>
                            </Field>
                        </div>
                        <Button type="submit" variant="primary" :icon="PhUploadSimple" :loading="upload.processing.value" data-testid="ADM-17.analyse">{{ trans('catalog.import.analyse') }}</Button>
                    </form>
                    <p class="text-admin-base text-ink-3">{{ trans('catalog.import.rules') }}</p>
                </template>
            </section>

            <!-- the dry run of the chosen import -->
            <section v-if="current" class="flex flex-col gap-16" :aria-label="trans('catalog.import.dry_run_title')" data-testid="ADM-17.dry-run">
                <div class="flex flex-wrap items-start justify-between gap-16">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 class="flex flex-wrap items-center gap-12 text-headline text-ink">
                            <span class="truncate">{{ trans(current.status === 'analysed' || current.status === 'awaiting_approval' || current.status === 'expired' ? 'catalog.import.dry_run_of' : 'catalog.import.import_of', { file: current.file }) }}</span>
                            <StatusPill :tone="importTones[current.status]" :label="trans(`catalog.import.statuses.${current.status}`)" data-testid="ADM-17.status" />
                        </h2>
                        <p class="text-admin-base text-ink-2 tabular-nums">
                            {{
                                [
                                    trans(`catalog.import.kinds.${current.kind}`),
                                    transChoice('catalog.import.row_count', current.rows, { count: formatNumber(current.rows) }),
                                    current.created_by,
                                    formatDateTime(current.created_at),
                                    current.expires_at ? trans('catalog.import.kept_until', { date: formatDate(current.expires_at) }) : null,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')
                            }}
                        </p>
                    </div>
                    <Button v-if="current.can_apply && can('catalog.manage')" variant="primary" :icon="PhCheckCircle" :disabled="changed === 0" data-testid="ADM-17.apply" @click="applyOpen = true">
                        {{ transChoice(changed > limits.four_eyes_above ? 'catalog.import.apply_request' : 'catalog.import.apply', changed, { count: formatNumber(changed) }) }}
                    </Button>
                </div>

                <ApprovalNotice v-if="current.can_apply && changed > limits.four_eyes_above" test-id="ADM-17.four-eyes" />
                <p v-if="waiting" class="rounded-sm border border-line bg-raised px-16 py-12 text-admin-base text-ink-2" role="status" data-testid="ADM-17.waiting">
                    {{ trans('catalog.import.waiting', { until: formatDateTime(current.approval?.expires_at) }) }}
                </p>
                <StateBlock v-if="current.expired && current.status !== 'applied'" kind="forbidden" :retryable="false" :title="trans('catalog.import.expired_title')" :body="trans('catalog.import.expired_body')" test-id="ADM-17.expired" />

                <div v-if="running" class="flex flex-col gap-8" role="status" aria-live="polite" data-testid="ADM-17.progress">
                    <p class="text-admin-base text-ink tabular-nums">{{ trans('catalog.import.progress', { done: formatNumber(current.progress), total: formatNumber(current.rows), percent: String(progress) }) }}</p>
                    <div class="h-8 w-full overflow-hidden rounded-full bg-raised" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="trans('catalog.import.progress_label')">
                        <div class="h-full rounded-full bg-inverse" :style="{ width: `${progress}%` }" />
                    </div>
                </div>
                <p v-if="current.status === 'applied'" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-17.applied">
                    <PhCheckCircle :size="16" class="text-success" aria-hidden="true" />{{ trans('catalog.import.applied', { date: formatDateTime(current.finished_at), name: current.applied_by ?? '–' }) }}
                </p>
                <StateBlock
                    v-if="current.status === 'applied' && current.lines.some((l) => l.result?.status === 'error' && l.status !== 'error')"
                    kind="partial"
                    :retryable="false"
                    :title="transChoice('catalog.import.partial_title', failedLines, { count: formatNumber(failedLines) })"
                    :body="trans('catalog.import.partial_body')"
                    test-id="ADM-17.partial"
                />
                <StateBlock v-if="current.status === 'failed'" kind="error" :retryable="false" :title="trans('catalog.import.failed_title')" :body="trans('catalog.import.failed_body')" test-id="ADM-17.failed" />

                <!-- DQ-590: without the rows (not stored for this import) no counts above an empty list: one sentence instead. -->
                <p v-if="noLines" class="rounded-sm border border-line-subtle px-16 py-12 text-admin-base text-ink-2" data-testid="ADM-17.no-lines">
                    {{ trans(running ? 'catalog.import.lines_later' : 'catalog.import.lines_missing') }}
                </p>
                <SegmentedControl v-if="!noLines" v-model="showModel" class="self-start" :options="showOptions" :label="trans('catalog.import.show.label')" data-testid="ADM-17.show" />
                <template v-if="noLines" />
                <EmptyQueue v-else-if="filtered.length === 0" variant="quiet" :title="trans(`catalog.import.none.${show}`)" />
                <template v-else>
                    <ScrollRegion :label="trans('catalog.import.rows_caption')" test-id="ADM-17.rows">
                        <table class="w-full text-admin-base">
                            <caption class="sr-only">{{ trans('catalog.import.rows_caption') }}</caption>
                            <thead>
                                <tr class="h-40 border-b border-line text-left text-admin-base-strong text-ink-2">
                                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.line') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.level') }}</th>
                                    <th scope="col" class="min-w-200 px-12">{{ trans('catalog.columns.entry') }}</th>
                                    <th scope="col" class="px-12">{{ trans('catalog.columns.changes') }}</th>
                                    <th v-if="current.status === 'applied' || current.status === 'applying' || current.status === 'failed'" scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.result') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="l in visible" :key="l.line" class="h-40 border-b border-line-subtle align-middle last:border-b-0" :data-row-status="l.status" data-testid="ADM-17.row">
                                    <td class="px-12 text-right text-ink-3 tabular-nums">{{ l.line }}</td>
                                    <td class="px-12"><StatusPill :tone="rowTones[l.status]" :label="trans(`catalog.import.row_statuses.${l.status}`)" /></td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ levelText(l.level) }}</td>
                                    <td class="px-12 py-4">
                                        <span class="flex min-w-0 flex-col">
                                            <span class="text-ink">{{ l.label || '–' }}</span>
                                            <span v-if="createsText(l)" class="text-caption text-ink-3">{{ createsText(l) }}</span>
                                        </span>
                                    </td>
                                    <td class="px-12 py-4">
                                        <span v-if="l.error" class="text-danger" data-testid="ADM-17.row-error">{{ errorText(l.error) }}</span>
                                        <span v-else-if="Object.keys(l.changes).length > 0" class="text-ink-2">{{ changeText(l) }}</span>
                                        <span v-else class="text-ink-3">{{ trans(l.status === 'new' ? 'catalog.import.new_entry' : 'catalog.import.no_change') }}</span>
                                    </td>
                                    <td v-if="current.status === 'applied' || current.status === 'applying' || current.status === 'failed'" class="whitespace-nowrap px-12">
                                        <span v-if="l.status === 'error'" class="text-ink-3" :title="trans('catalog.import.result_skipped')">–</span>
                                        <span v-else-if="l.result === null" class="text-ink-3">{{ trans('catalog.import.result_pending') }}</span>
                                        <span v-else-if="l.result.status === 'error'" class="text-danger" :title="errorText(l.result.error)">{{ trans('catalog.import.result_error') }}</span>
                                        <span v-else class="text-ink-2">{{ trans('catalog.import.result_done') }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                    <div v-if="filtered.length > visible.length" class="flex items-center gap-12">
                        <Button size="sm" variant="secondary" data-testid="ADM-17.more" @click="limit += PAGE">{{ trans('catalog.import.more', { count: formatNumber(Math.min(PAGE, filtered.length - visible.length)) }) }}</Button>
                        <span class="text-caption text-ink-3 tabular-nums">{{ trans('catalog.import.shown', { shown: formatNumber(visible.length), total: formatNumber(filtered.length) }) }}</span>
                    </div>
                </template>
            </section>

            <!-- history -->
            <section class="flex flex-col gap-12" :aria-label="trans('catalog.import.history_title')" data-testid="ADM-17.history">
                <h2 class="text-headline text-ink">{{ trans('catalog.import.history_title') }}</h2>
                <EmptyQueue v-if="state !== 'loading' && history.length === 0" variant="first" :title="trans('catalog.import.history_empty_title')" :body="trans('catalog.import.history_empty_body')" data-testid="ADM-17.history-empty" />
                <ScrollRegion v-else :label="trans('catalog.import.history_caption')">
                    <table class="w-full text-admin-base" :aria-busy="state === 'loading' || undefined">
                        <caption class="sr-only">{{ trans('catalog.import.history_caption') }}</caption>
                        <!-- DQ-593: fixed widths for every column but the file, the same while loading and with rows. -->
                        <colgroup>
                            <col class="w-120" /><col /><col class="w-80" /><col class="w-120" /><col class="w-80" /><col class="w-160" /><col class="w-200" />
                        </colgroup>
                        <thead>
                            <tr class="h-40 border-b border-line text-left text-admin-base-strong text-ink-2">
                                <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.uploaded') }}</th>
                                <th scope="col" class="px-12">{{ trans('catalog.columns.file') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.import.row_statuses.new') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.import.row_statuses.changed') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.import.row_statuses.error') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.by') }}</th>
                            </tr>
                        </thead>
                        <SkeletonRows v-if="state === 'loading'" :bars="['w-80', 'w-200', 'ml-auto w-24', 'ml-auto w-24', 'ml-auto w-24', 'w-96', 'w-120']" :rows="5" test-id="ADM-17.history-loading" />
                        <tbody v-else>
                            <tr v-for="h in history" :key="h.id" class="h-40 border-b border-line-subtle last:border-b-0" :class="current?.id === h.id ? 'bg-raised' : ''" data-testid="ADM-17.import">
                                <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums" :title="formatDateTime(h.created_at)">{{ formatDate(h.created_at) }}</td>
                                <td class="px-12">
                                    <NameCell
                                        :name="h.file"
                                        :caption="[trans(`catalog.import.kinds.${h.kind}`), transChoice('catalog.import.row_count', h.rows, { count: formatNumber(h.rows) })].join(' · ')"
                                        :href="showHref(h.id)"
                                        test-id="ADM-17.open"
                                    />
                                </td>
                                <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(h.counts.new) }}</td>
                                <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(h.counts.changed) }}</td>
                                <td class="px-12 text-right tabular-nums" :class="h.counts.error > 0 ? 'text-danger' : 'text-ink'">{{ formatNumber(h.counts.error) }}</td>
                                <td class="whitespace-nowrap px-12">
                                    <StatusPill :tone="importTones[h.status]" :label="h.status === 'applying' || h.status === 'queued' ? trans('catalog.import.running', { percent: String(h.rows > 0 ? Math.round((h.progress / h.rows) * 100) : 0) }) : trans(`catalog.import.statuses.${h.status}`)" />
                                </td>
                                <td class="whitespace-nowrap px-12 text-ink-2">{{ h.applied_by ?? h.created_by ?? '–' }}</td>
                            </tr>
                        </tbody>
                    </table>
                </ScrollRegion>
            </section>
        </template>

        <ConfirmDialog
            v-model:open="applyOpen"
            :title="trans('catalog.import.apply_title', { file: current?.file ?? '' })"
            :body="trans('catalog.import.apply_body', { new: formatNumber(current?.counts.new ?? 0), changed: formatNumber(current?.counts.changed ?? 0), errors: formatNumber(current?.counts.error ?? 0) })"
            :confirm-label="trans(changed > limits.four_eyes_above ? 'catalog.import.apply_request_short' : 'catalog.import.apply_short')"
            tone="neutral"
            reason
            :four-eyes="changed > limits.four_eyes_above"
            :processing="apply.processing.value"
            :error="failed ? trans('ui.state.server_error') : apply.error.value"
            test-id="ADM-17.apply-dialog"
            @confirm="sendApply"
        />
    </div>
</template>
