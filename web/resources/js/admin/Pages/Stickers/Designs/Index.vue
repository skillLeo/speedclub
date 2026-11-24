<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFilePdf, PhFileSvg, PhFunnel, PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../../Components/data-table/DataTable.vue';
import NameCell from '../../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../../Components/data-table/table';
import PageHeader from '../../../Components/shell/PageHeader.vue';
import { Badge, Button, Drawer, Field, Input, QrCodeText, Select, StatusPill, Tooltip, type Tone } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { usePageState } from '../../../composables/pageState';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { usePermissions } from '../../../lib/permissions';
import { hasRoute, routeOr } from '../../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../../types/table';

/**
 * ADM-65 Sticker-Designs (10 §2.3, m5.4-contract §8): every design version with its state; the print partner downloads the print files
 * (PDF/SVG) of a validated version whose code still works. The whole page needs `stickers.print` (route middleware): without it the
 * shell's 403 page shows and the nav entry is hidden, so there is no view-only variant. Downloads are plain links to the audited
 * attachment routes; the page never draws or inlines the sticker artwork (the server sends no preview URL for staff), the drawer shows
 * an honest dimension sketch from `size_mm` instead.
 */
type Template = 'classic' | 'minimal' | 'banner' | 'plate' | 'vertical_jdm' | 'round';
type ScanTest = 'passed' | 'failed' | 'not_applicable';
interface DesignRow {
    id: string;
    reference: string;
    version: number;
    template: Template;
    size: 's' | 'm' | 'l';
    size_mm: { width: number; height: number };
    colourway: 'white' | 'black' | 'white_red';
    material: 'transparent' | 'white_vinyl';
    mirrored: boolean;
    qr: boolean;
    scan_test: ScanTest | null;
    state: 'draft' | 'validated';
    validated_at: string | null;
    order_requested_at: string | null;
    code: { display_code: string; active: boolean } | null;
    vehicle: { id: string; title: string; deleted: boolean } | null;
    owner: { id: string; username: string | null } | null;
    downloads: { pdf: string; svg: string } | null;
    created_at: string | null;
}

const props = defineProps<{ rows: Paginated<DesignRow>; query: TableQuery; views: SavedView[] }>();
const state = usePageState();
const { can } = usePermissions();
const canPrint = computed(() => can('stickers.print'));

const TEMPLATES: Template[] = ['classic', 'minimal', 'banner', 'plate', 'vertical_jdm', 'round'];
/** Bleed around the trim box in mm (config speedclub.stickers.bleed_mm, contract §11). */
const BLEED_MM = 3;

// Content-sized columns (DQ-526): what the print partner needs fits 1280 (design id + version, state, template + size, car + owner,
// order, print files); print, film, scan test, code, owner, validated and created are in the column chooser and the drawer.
const columns = computed<TableColumn[]>(() => [
    { key: 'reference', label: trans('stickers.designs.columns.reference'), min: 120, hideable: false },
    { key: 'state', label: trans('stickers.designs.columns.state'), min: 96 },
    { key: 'template', label: trans('stickers.designs.columns.template'), min: 150 },
    { key: 'vehicle', label: trans('stickers.designs.columns.vehicle'), grow: true, min: 200 },
    { key: 'order_requested_at', label: trans('stickers.designs.columns.order_requested_at'), sort: 'order_requested_at', min: 96 },
    { key: 'colourway', label: trans('stickers.designs.columns.colourway'), min: 120, defaultHidden: true },
    { key: 'material', label: trans('stickers.designs.columns.material'), defaultHidden: true },
    { key: 'scan_test', label: trans('stickers.designs.columns.scan_test'), min: 120, defaultHidden: true },
    { key: 'code', label: trans('stickers.designs.columns.code'), min: 96, defaultHidden: true },
    { key: 'owner', label: trans('stickers.designs.columns.owner'), min: 120, defaultHidden: true },
    { key: 'validated_at', label: trans('stickers.designs.columns.validated_at'), sort: 'validated_at', min: 96, defaultHidden: true },
    { key: 'created_at', label: trans('stickers.designs.columns.created_at'), sort: 'created_at', min: 96, defaultHidden: true },
    { key: 'downloads', label: trans('stickers.designs.columns.downloads'), min: 96, hideable: false },
]);
const presets: PresetView[] = [
    { key: 'ordered', name: 'stickers.designs.presets.ordered', query: { filter: { state: 'ordered' }, sort: '-order_requested_at' } },
    { key: 'validated', name: 'stickers.designs.presets.validated', query: { filter: { state: 'validated' }, sort: '-validated_at' } },
    { key: 'drafts', name: 'stickers.designs.presets.drafts', query: { filter: { state: 'draft' }, sort: '-created_at' } },
];

// ---- filters (contract §8: state, template, q = design id, sticker code or username prefix) ---------------------------------
const filters = reactive({ q: '', state: '', template: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.state = filter.state ?? '';
        filters.template = filter.template ?? '';
    },
    { immediate: true },
);
// Reka's Select has no empty-string item: "any" stands for no filter.
const ANY = '*';
function anyModel(key: 'state' | 'template') {
    return computed({
        get: () => (filters[key] === '' ? undefined : filters[key]),
        set: (value: string | undefined) => (filters[key] = value === undefined || value === ANY ? '' : value),
    });
}
const stateModel = anyModel('state');
const templateModel = anyModel('template');
const stateOptions = computed(() => [
    { value: ANY, label: trans('stickers.designs.filters.any') },
    ...(['draft', 'validated', 'ordered'] as const).map((value) => ({ value, label: trans(`stickers.designs.state.${value}`) })),
]);
const templateOptions = computed(() => [{ value: ANY, label: trans('stickers.designs.filters.any') }, ...TEMPLATES.map((value) => ({ value, label: templateLabel(value) }))]);

// ---- labels -------------------------------------------------------------------------------------------------------------
const templateLabel = (template: Template): string => trans(`stickers.designs.templates.${template}`);
const sizeLabel = (row: DesignRow): string =>
    trans('stickers.designs.size', { size: row.size.toUpperCase(), width: formatNumber(row.size_mm.width), height: formatNumber(row.size_mm.height) });
const stateTone = (row: DesignRow): Tone => (row.state === 'validated' ? 'success' : 'neutral');
const scanTone: Record<ScanTest, Tone> = { passed: 'success', failed: 'warning', not_applicable: 'neutral' };
const scanLabel = (row: DesignRow): string => trans(`stickers.designs.scan_test.${row.scan_test ?? 'none'}`);
/** Why a row has no print files: a draft (or a failed test), or a code that was replaced or taken down since. */
const refusal = (row: DesignRow): string =>
    row.state === 'validated' && row.qr && row.code !== null && !row.code.active ? trans('stickers.designs.download.code_inactive') : trans('stickers.designs.download.not_validated');

const vehicleHref = (id: string) => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const canOpenRegister = computed(() => hasRoute('admin.qr.index') && can('qr.view'));

// ---- design drawer ------------------------------------------------------------------------------------------------------
// ?design=SD… opens that design when it is on the page (deep link from the print partner's order note); ?dialog=design (QA) the first.
const selectedRef = ref<string | null>(null);
const drawerOpen = ref(false);
const selected = computed(() => props.rows.data.find((row) => row.reference === selectedRef.value) ?? null);

function initialRef(): string | null {
    if (typeof window === 'undefined') return null;
    const wanted = new URLSearchParams(window.location.search).get('design');
    if (wanted !== null && /^sd[0-9a-z]{8}$/i.test(wanted)) return wanted.toUpperCase();
    return qaDialog() === 'design' ? (props.rows.data[0]?.reference ?? null) : null;
}
const missing = ref(false);
{
    const wanted = initialRef();
    if (wanted !== null) {
        selectedRef.value = wanted;
        drawerOpen.value = props.rows.data.some((row) => row.reference === wanted);
        missing.value = !drawerOpen.value && qaDialog() === null;
    }
}

function openDesign(row: DesignRow): void {
    selectedRef.value = row.reference;
    missing.value = false;
    drawerOpen.value = true;
}

/** The sketch: the bleed box (dashed) around the trim box, in the design's real proportions; round stays round. */
const sketch = computed(() => {
    const row = selected.value;
    if (row === null) return null;
    const width = row.size_mm.width + 2 * BLEED_MM;
    const height = row.size_mm.height + 2 * BLEED_MM;
    return {
        box: { aspectRatio: `${width} / ${height}` },
        trim: { left: `${(BLEED_MM / width) * 100}%`, right: `${(BLEED_MM / width) * 100}%`, top: `${(BLEED_MM / height) * 100}%`, bottom: `${(BLEED_MM / height) * 100}%` },
        round: row.template === 'round',
        tall: row.size_mm.height > row.size_mm.width,
    };
});
const yesNo = (value: boolean): string => trans(value ? 'stickers.designs.detail.yes' : 'stickers.designs.detail.no');
</script>

<template>
    <Head :title="trans('stickers.designs.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-65" :data-qa-state="state">
        <PageHeader :title="trans('stickers.designs.title')" :crumbs="[{ label: trans('shell.groups.qr') }]" :description="trans('stickers.designs.intro')" />

        <p v-if="missing" class="text-admin-base text-ink-2" role="status" data-testid="ADM-65.missing">{{ trans('stickers.designs.detail.missing') }}</p>

        <DataTable
            id="sticker_designs"
            row-keys
            clickable-rows
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('stickers.designs.caption')"
            :empty-title="trans('stickers.designs.empty_title')"
            :empty-body="trans('stickers.designs.empty_body')"
            :current-row-id="drawerOpen && selected ? selected.id : null"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-65.table"
            @open="openDesign"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('stickers.designs.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="w-240">
                        <Field :label="trans('stickers.designs.filters.q')">
                            <Input v-model="filters.q" size="sm" maxlength="32" :placeholder="trans('stickers.designs.filters.q_placeholder')" data-testid="ADM-65.filter.q" />
                        </Field>
                    </div>
                    <div class="w-200">
                        <Field :label="trans('stickers.designs.filters.state')">
                            <Select v-model="stateModel" :options="stateOptions" size="sm" :placeholder="trans('stickers.designs.filters.any')" data-testid="ADM-65.filter.state" />
                        </Field>
                    </div>
                    <div class="w-200">
                        <Field :label="trans('stickers.designs.filters.template')">
                            <Select v-model="templateModel" :options="templateOptions" size="sm" :placeholder="trans('stickers.designs.filters.any')" data-testid="ADM-65.filter.template" />
                        </Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" data-testid="ADM-65.filter.apply">{{ trans('stickers.designs.filters.apply') }}</Button>
                </form>
            </template>

            <template #empty>
                <Button v-if="canOpenRegister" size="sm" variant="secondary" :href="routeOr('admin.qr.index', '/admin/qr')" data-testid="ADM-65.empty.register">{{ trans('stickers.designs.empty_action') }}</Button>
            </template>

            <template #cell-reference="{ row }">
                <button
                    type="button"
                    :class="[focusRing, 'flex h-32 min-w-0 items-center gap-8 rounded-xs text-left text-ink tabular-nums hover:underline']"
                    data-testid="ADM-65.open"
                    @click="openDesign(row)"
                >
                    <!-- WCAG 2.5.3: the name is the visible text plus a hidden verb, never a different aria-label. -->
                    <span class="sc-key whitespace-nowrap font-medium">{{ row.reference }}</span>
                    <span class="whitespace-nowrap text-caption text-ink-3">{{ trans('stickers.designs.version', { version: formatNumber(row.version) }) }}</span>
                    <span class="sr-only">{{ trans('stickers.designs.detail.open_hint') }}</span>
                </button>
            </template>
            <template #cell-state="{ row }">
                <StatusPill :tone="stateTone(row)" :label="trans(`stickers.designs.state.${row.state}`)" />
            </template>
            <template #cell-template="{ row }">
                <NameCell :name="templateLabel(row.template)" :caption="sizeLabel(row)" />
            </template>
            <template #cell-colourway="{ row }">
                <span class="flex min-w-0 items-center gap-4">
                    <span class="truncate text-ink-2" :title="`${trans(`stickers.designs.colourways.${row.colourway}`)} · ${trans(`stickers.designs.materials.${row.material}`)}`">{{ trans(`stickers.designs.colourways.${row.colourway}`) }}</span>
                    <Tooltip v-if="row.mirrored" :content="trans('stickers.designs.mirrored_hint')">
                        <span tabindex="0" :class="[focusRing, 'inline-flex h-24 shrink-0 items-center rounded-xs']" :aria-label="trans('stickers.designs.mirrored_hint')">
                            <Badge>{{ trans('stickers.designs.mirrored') }}</Badge>
                        </span>
                    </Tooltip>
                </span>
            </template>
            <template #cell-material="{ row }">
                <span class="block truncate text-ink-2">{{ trans(`stickers.designs.materials.${row.material}`) }}</span>
            </template>
            <template #cell-scan_test="{ row }">
                <StatusPill v-if="row.scan_test" :tone="scanTone[row.scan_test]" :label="scanLabel(row)" />
                <span v-else class="text-ink-3">{{ scanLabel(row) }}</span>
            </template>
            <template #cell-code="{ row }">
                <span v-if="!row.qr" class="text-ink-3">{{ trans('stickers.designs.no_qr') }}</span>
                <Tooltip v-else-if="row.code && !row.code.active" :content="trans('stickers.designs.code_inactive')">
                    <span tabindex="0" :class="[focusRing, 'inline-flex h-24 items-center rounded-xs']" :aria-label="`${row.code.display_code}: ${trans('stickers.designs.code_inactive')}`">
                        <QrCodeText :code="row.code.display_code" muted />
                    </span>
                </Tooltip>
                <QrCodeText v-else-if="row.code" :code="row.code.display_code" />
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-vehicle="{ row }">
                <NameCell v-if="row.vehicle && !row.vehicle.deleted" :name="row.vehicle.title" :caption="row.owner?.username ? `@${row.owner.username}` : null" :href="vehicleHref(row.vehicle.id)" />
                <span v-else class="text-ink-3">{{ row.vehicle ? trans('stickers.designs.vehicle_deleted') : trans('stickers.designs.no_vehicle') }}</span>
            </template>
            <template #cell-owner="{ row }">
                <Link v-if="row.owner" :href="memberHref(row.owner.id)" :title="row.owner.username ? `@${row.owner.username}` : undefined" :class="[focusRing, 'sc-key flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']"><span class="truncate">{{ row.owner.username ? `@${row.owner.username}` : '–' }}</span></Link>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-validated_at="{ row }">
                <time v-if="row.validated_at" :datetime="row.validated_at" :title="formatDateTime(row.validated_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.validated_at) }}</time>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-order_requested_at="{ row }">
                <time v-if="row.order_requested_at" :datetime="row.order_requested_at" :title="formatDateTime(row.order_requested_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.order_requested_at) }}</time>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" :title="formatDateTime(row.created_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-downloads="{ row }">
                <span v-if="row.downloads && canPrint" class="flex items-center gap-4">
                    <Button size="sm" variant="ghost" external :href="row.downloads.pdf" :aria-label="trans('stickers.designs.download.pdf_label', { reference: row.reference })" data-testid="ADM-65.download.pdf">{{ trans('stickers.designs.download.pdf') }}</Button>
                    <Button size="sm" variant="ghost" external :href="row.downloads.svg" :aria-label="trans('stickers.designs.download.svg_label', { reference: row.reference })" data-testid="ADM-65.download.svg">{{ trans('stickers.designs.download.svg') }}</Button>
                </span>
                <Tooltip v-else :content="refusal(row)">
                    <span tabindex="0" :class="[focusRing, 'inline-flex h-24 items-center gap-4 rounded-xs text-ink-3']" :aria-label="refusal(row)" data-testid="ADM-65.download.none">
                        <PhLockSimple :size="16" aria-hidden="true" />{{ trans('stickers.designs.download.none') }}
                    </span>
                </Tooltip>
            </template>
        </DataTable>

        <Drawer
            v-model:open="drawerOpen"
            :title="selected ? trans('stickers.designs.detail.title', { reference: selected.reference }) : trans('stickers.designs.title')"
            :description="selected ? trans('stickers.designs.detail.description', { version: formatNumber(selected.version), template: templateLabel(selected.template) }) : undefined"
            test-id="ADM-65.drawer"
        >
            <div v-if="selected && sketch" class="flex flex-col gap-24" data-testid="ADM-65.detail">
                <!-- Dimension sketch: proportions from size_mm, the dashed bleed (3 mm) around the trim line; no artwork (never inlined). -->
                <figure class="flex flex-col gap-8">
                    <figcaption class="text-admin-base-strong text-ink">{{ trans('stickers.designs.detail.sketch') }}</figcaption>
                    <div class="flex items-center gap-8 rounded-sm border border-line-subtle bg-raised px-24 py-24">
                        <div class="flex min-w-0 flex-1 flex-col items-center gap-4">
                            <div class="relative" :class="sketch.tall ? 'h-160' : 'w-full max-w-320'" :style="sketch.box" data-testid="ADM-65.sketch" aria-hidden="true">
                                <div class="absolute inset-0 border border-dashed border-line-strong" :class="sketch.round ? 'rounded-full' : ''" />
                                <div class="absolute border-2 border-ink" :class="sketch.round ? 'rounded-full' : 'rounded-xs'" :style="sketch.trim" />
                            </div>
                            <span class="text-caption text-ink-2 tabular-nums">{{ trans('stickers.designs.mm', { value: formatNumber(selected.size_mm.width) }) }}</span>
                        </div>
                        <span class="text-caption text-ink-2 tabular-nums">{{ trans('stickers.designs.mm', { value: formatNumber(selected.size_mm.height) }) }}</span>
                    </div>
                    <p class="text-caption text-ink-3">{{ trans(selected.downloads ? 'stickers.designs.detail.sketch_note' : 'stickers.designs.detail.sketch_unavailable') }}</p>
                </figure>

                <section class="flex flex-col gap-8" :aria-label="trans('stickers.designs.detail.facts')">
                    <h3 class="text-admin-base-strong text-ink">{{ trans('stickers.designs.detail.facts') }}</h3>
                    <dl class="grid grid-cols-2 gap-x-24 gap-y-12 text-admin-base">
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.state') }}</dt>
                            <dd class="flex min-w-0 items-center gap-4" data-testid="ADM-65.detail.state">
                                <StatusPill :tone="stateTone(selected)" :label="trans(`stickers.designs.state.${selected.state}`)" />
                            </dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.scan_test') }}</dt>
                            <dd>
                                <StatusPill v-if="selected.scan_test" :tone="scanTone[selected.scan_test]" :label="scanLabel(selected)" />
                                <span v-else class="text-ink-3">{{ scanLabel(selected) }}</span>
                            </dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.template') }}</dt>
                            <dd class="text-ink">{{ templateLabel(selected.template) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.size') }}</dt>
                            <dd class="text-ink tabular-nums">{{ sizeLabel(selected) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.colourway') }}</dt>
                            <dd class="text-ink">{{ trans(`stickers.designs.colourways.${selected.colourway}`) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.material') }}</dt>
                            <dd class="text-ink">{{ trans(`stickers.designs.materials.${selected.material}`) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.mirrored') }}</dt>
                            <dd class="text-ink">{{ selected.mirrored ? trans('stickers.designs.mirrored_hint') : yesNo(false) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.qr') }}</dt>
                            <dd class="text-ink">{{ yesNo(selected.qr) }}</dd>
                        </div>
                        <template v-if="selected.qr">
                            <div class="flex min-w-0 flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.code') }}</dt>
                                <dd class="flex min-w-0 flex-wrap items-center gap-8">
                                    <template v-if="selected.code">
                                        <QrCodeText :code="selected.code.display_code" :muted="!selected.code.active" />
                                        <StatusPill v-if="!selected.code.active" tone="warning" :label="trans('stickers.designs.code_inactive')" />
                                    </template>
                                    <span v-else class="text-ink-3">–</span>
                                </dd>
                            </div>
                        </template>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.vehicle') }}</dt>
                            <dd class="min-w-0">
                                <Link v-if="selected.vehicle && !selected.vehicle.deleted" :href="vehicleHref(selected.vehicle.id)" :class="[focusRing, 'rounded-xs text-ink hover:underline']">{{ selected.vehicle.title }}</Link>
                                <span v-else class="text-ink-3">{{ selected.vehicle ? trans('stickers.designs.vehicle_deleted') : trans('stickers.designs.no_vehicle') }}</span>
                            </dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.owner') }}</dt>
                            <dd class="min-w-0">
                                <Link v-if="selected.owner" :href="memberHref(selected.owner.id)" :class="[focusRing, 'sc-key rounded-xs text-ink hover:underline']">{{ selected.owner.username ? `@${selected.owner.username}` : '–' }}</Link>
                                <span v-else class="text-ink-3">–</span>
                            </dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.created_at') }}</dt>
                            <dd class="text-ink tabular-nums">{{ formatDateTime(selected.created_at) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.validated_at') }}</dt>
                            <dd class="text-ink tabular-nums">{{ selected.validated_at ? formatDateTime(selected.validated_at) : trans('stickers.designs.detail.never') }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('stickers.designs.detail.order_requested_at') }}</dt>
                            <dd class="flex flex-col gap-2">
                                <span class="text-ink tabular-nums">{{ selected.order_requested_at ? formatDateTime(selected.order_requested_at) : trans('stickers.designs.detail.never') }}</span>
                                <span v-if="selected.order_requested_at" class="text-caption text-ink-3">{{ trans('stickers.designs.detail.order_note') }}</span>
                            </dd>
                        </div>
                    </dl>
                </section>
            </div>

            <template v-if="selected" #footer>
                <template v-if="selected.downloads && canPrint">
                    <p class="mr-auto text-caption text-ink-3">{{ trans('stickers.designs.download.audited') }}</p>
                    <Button size="md" variant="secondary" external :href="selected.downloads.svg" :icon="PhFileSvg" data-testid="ADM-65.drawer.download.svg">{{ trans('stickers.designs.download.svg_long') }}</Button>
                    <Button size="md" variant="primary" external :href="selected.downloads.pdf" :icon="PhFilePdf" data-testid="ADM-65.drawer.download.pdf">{{ trans('stickers.designs.download.pdf_long') }}</Button>
                </template>
                <p v-else class="mr-auto flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-65.drawer.refusal">
                    <PhLockSimple :size="16" aria-hidden="true" />{{ refusal(selected) }}
                </p>
            </template>
        </Drawer>
    </div>
</template>
