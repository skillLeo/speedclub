<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhDotsThree, PhCopy, PhPencilSimple, PhProhibit, PhTrash, PhArrowSquareOut } from '@phosphor-icons/vue';
import { currentLocale, trans } from 'laravel-vue-i18n';
import { computed, onMounted, ref } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import ChartCard from '../../Components/patterns/ChartCard.vue';
import CommandPalette from '../../Components/patterns/CommandPalette.vue';
import DiffViewer from '../../Components/patterns/DiffViewer.vue';
import KpiTile from '../../Components/patterns/KpiTile.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import ThemeFrame from '../../Components/patterns/ThemeFrame.vue';
import ActivityTimeline from '../../Components/record/ActivityTimeline.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import {
    Badge,
    Button,
    Checkbox,
    Combobox,
    ConfirmDialog,
    Dialog,
    Drawer,
    DropdownMenu,
    EmptyQueue,
    Field,
    IconButton,
    Input,
    Kbd,
    Pagination,
    RadioGroup,
    Select,
    Skeleton,
    StatusPill,
    Switch,
    Tabs,
    Textarea,
    Tooltip,
    toast,
    type MenuEntry,
} from '../../Components/ui';
import { formatDate, formatDayShort } from '../../lib/format';
import { now } from '../../lib/qa';
import type { Paginated, TableQuery } from '../../types/table';

/** Admin gallery (contract §2.4): every component × state in Carbon and Hell, for design QA and the visual tier. */
/** trans() inside computed values: reading the locale makes them follow a language switch. */
const t = (key: string, replacements?: Record<string, string>): string => {
    void currentLocale.value;
    return trans(key, replacements);
};
const themes = [
    { theme: 'carbon' as const, label: () => t('gallery.theme_carbon') },
    { theme: 'light' as const, label: () => t('gallery.theme_light') },
];

// Sample content: real-looking German data, the same in both frames.
const makes = [
    { value: 'nissan', label: 'Nissan' },
    { value: 'toyota', label: 'Toyota' },
    { value: 'bmw', label: 'BMW' },
    { value: 'porsche', label: 'Porsche' },
    { value: 'mazda', label: 'Mazda' },
];
const statusOptions = computed(() => [
    { value: 'active', label: t('gallery.statuses.active') },
    { value: 'restricted', label: t('gallery.statuses.restricted') },
    { value: 'suspended', label: t('gallery.statuses.suspended') },
]);
const durations = computed(() => [
    { value: '7', label: t('gallery.fields.duration_7'), hint: t('gallery.fields.duration_hint') },
    { value: '30', label: t('gallery.fields.duration_30') },
]);

const username = ref('nightrunner_s14');
const note = ref('');
const status = ref<string | undefined>('active');
const make = ref<string | undefined>('nissan');
const checked = ref<boolean | 'indeterminate'>(true);
const unchecked = ref<boolean | 'indeterminate'>(false);
const indeterminate = ref<boolean | 'indeterminate'>('indeterminate');
const on = ref(true);
const off = ref(false);
const duration = ref<string | undefined>('7');
const tab = ref('overview');
const recordTab = ref('overview');

const tabs = computed(() => [
    { value: 'overview', label: t('gallery.tabs.overview') },
    { value: 'vehicles', label: t('gallery.tabs.vehicles'), count: 3 },
    { value: 'security', label: t('gallery.tabs.security') },
    { value: 'reports', label: t('gallery.tabs.reports'), count: 0 },
]);

const menu = computed<MenuEntry[]>(() => [
    { key: 'open', label: t('gallery.menu.open'), icon: PhArrowSquareOut },
    { key: 'copy', label: t('gallery.menu.copy'), icon: PhCopy },
    { key: 'delete', label: t('gallery.menu.delete'), icon: PhTrash, danger: true, separated: true },
]);

const series = [12, 15, 9, 14, 21, 18, 25, 22, 19, 27, 31, 24, 29, 34];
const days = series.map((_, i) => {
    const d = now();
    d.setDate(d.getDate() - (series.length - 1 - i));
    return formatDayShort(d);
});
const topMakes = { labels: ['Nissan', 'Toyota', 'BMW', 'Mazda', 'Honda', 'Porsche'], values: [148, 131, 97, 64, 51, 38] };

const iso = (minutesAgo: number): string => new Date(now().getTime() - minutesAgo * 60000).toISOString();
const timeline = computed(() => [
    { id: 3, occurred_at: iso(12), label: t('gallery.timeline.restricted'), actor: 'Demo Moderator', reason: 'Mehrfach unerwünschte Nachrichten an neue Mitglieder' },
    { id: 2, occurred_at: iso(60 * 26), label: t('gallery.timeline.reset'), actor: 'Demo Support' },
    { id: 1, occurred_at: iso(60 * 24 * 9), label: t('gallery.timeline.viewed'), actor: 'Demo Support' },
]);

const before = { username: 'nightrunner', bio: 'S14 Kouki, SR20DET', restrictions: { messaging: null }, visibility: 'public' };
const after = { username: 'nightrunner_s14', bio: 'S14 Kouki, SR20DET, 2JZ-Swap geplant', restrictions: { messaging: '2026-06-21' }, visibility: 'public' };

interface MemberRow {
    id: string;
    username: string;
    vehicles: number;
    followers: number;
    registered: string;
    status: string;
}
const members: MemberRow[] = [
    { id: '01JZ8K1', username: '@nightrunner_s14', vehicles: 3, followers: 1284, registered: iso(60 * 24 * 140), status: 'active' },
    { id: '01JZ8K2', username: '@kouki_lena', vehicles: 1, followers: 312, registered: iso(60 * 24 * 60), status: 'restricted' },
    { id: '01JZ8K3', username: '@e30_tobi', vehicles: 2, followers: 89, registered: iso(60 * 24 * 21), status: 'active' },
    { id: '01JZ8K4', username: '@gt3_marie', vehicles: 1, followers: 2051, registered: iso(60 * 24 * 7), status: 'suspended' },
];
const rows: Paginated<MemberRow> = { data: members, meta: { current_page: 1, last_page: 3, per_page: 25, total: 61, from: 1, to: 25 } };
const emptyRows: Paginated<MemberRow> = { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0, from: null, to: null } };
const query: TableQuery = { filter: {}, sort: '-registered', per_page: 25 };
const columns = computed<TableColumn[]>(() => [
    { key: 'username', label: t('gallery.table.username'), hideable: false },
    { key: 'status', label: t('gallery.table.status'), width: 'sm' },
    { key: 'vehicles', label: t('gallery.table.vehicles'), numeric: true, width: 'sm', sort: 'vehicles' },
    { key: 'followers', label: t('gallery.table.followers'), numeric: true, width: 'sm', sort: 'followers' },
    { key: 'registered', label: t('gallery.table.registered'), width: 'md', sort: 'registered' },
]);
const statusTone = (s: string): 'success' | 'warning' | 'danger' => (s === 'active' ? 'success' : s === 'restricted' ? 'warning' : 'danger');
const bulkActions = computed(() => [{ key: 'restrict', label: t('gallery.table.restrict'), icon: PhProhibit }]);

// Overlays: buttons, or ?dialog=… for captures.
const dialogOpen = ref(false);
const drawerOpen = ref(false);
const confirmOpen = ref(false);
const bulkOpen = ref(false);
const paletteOpen = ref(false);
onMounted(() => {
    const which = new URLSearchParams(window.location.search).get('dialog');
    dialogOpen.value = which === 'dialog';
    drawerOpen.value = which === 'drawer';
    confirmOpen.value = which === 'confirm';
    bulkOpen.value = which === 'bulk';
    paletteOpen.value = which === 'palette';
});
const bulkResults = [
    { id: '01JZ8K1', ok: true, code: null },
    { id: '01JZ8K2', ok: false, code: 'already_suspended' },
    { id: '01JZ8K3', ok: true, code: null },
];
const memberName = (id: string): string => members.find((m) => m.id === id)?.username ?? id;
const approval = { id: '01JZAPPROVAL', title: 'Audit-Export (CSV)', expires_at: iso(-60 * 24) };
</script>

<template>
    <Head :title="trans('gallery.title')" />
    <div class="flex flex-col gap-32" data-testid="ADM-DEV.gallery" data-qa-state="ready">
        <PageHeader :title="trans('gallery.title')" :description="trans('gallery.intro')" />

        <!-- buttons -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.buttons') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <div v-for="size in (['md', 'sm'] as const)" :key="size" class="flex flex-wrap items-center gap-8">
                        <Button variant="primary" :size="size">{{ trans('gallery.variants.primary') }}</Button>
                        <Button variant="secondary" :size="size" :icon="PhPencilSimple">{{ trans('gallery.variants.secondary') }}</Button>
                        <Button variant="ghost" :size="size">{{ trans('gallery.variants.ghost') }}</Button>
                        <Button variant="danger" :size="size" :icon="PhTrash">{{ trans('gallery.variants.danger') }}</Button>
                        <Button variant="destructive" :size="size" :icon="PhProhibit">{{ trans('gallery.variants.destructive') }}</Button>
                        <Button variant="primary" :size="size" loading>{{ trans('gallery.variants.primary') }}</Button>
                        <Button variant="secondary" :size="size" disabled>{{ trans('gallery.variants.secondary') }}</Button>
                        <IconButton :icon="PhDotsThree" :label="trans('gallery.variants.icon')" :size="size" variant="secondary" />
                        <IconButton :icon="PhDotsThree" :label="trans('gallery.variants.icon')" :size="size" />
                        <IconButton :icon="PhTrash" :label="trans('gallery.menu.delete')" :size="size" variant="danger" />
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- inputs -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.inputs') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <div class="grid grid-cols-1 gap-16 tablet:grid-cols-2">
                        <Field :label="trans('gallery.fields.username')" :hint="trans('gallery.fields.username_hint')">
                            <Input v-model="username" />
                        </Field>
                        <Field :label="trans('gallery.fields.username')" :error="trans('gallery.fields.username_error')">
                            <Input model-value="nightrunner" />
                        </Field>
                        <Field :label="trans('gallery.fields.username')" optional>
                            <Input model-value="kouki_lena" disabled />
                        </Field>
                        <Field :label="trans('gallery.fields.username')">
                            <Input model-value="e30_tobi" size="sm" />
                        </Field>
                        <div class="tablet:col-span-2">
                            <Field :label="trans('gallery.fields.note')">
                                <Textarea v-model="note" :maxlength="1000" show-count />
                            </Field>
                        </div>
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- choices -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.choices') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <div class="grid grid-cols-1 gap-16 tablet:grid-cols-2">
                        <Field :label="trans('gallery.fields.status')"><Select v-model="status" :options="statusOptions" /></Field>
                        <Field :label="trans('gallery.fields.make')"><Combobox v-model="make" :options="makes" :placeholder="trans('gallery.fields.make_placeholder')" /></Field>
                        <div class="flex flex-col gap-8">
                            <Checkbox v-model="checked" :label="trans('gallery.fields.notify')" />
                            <Checkbox v-model="unchecked" :label="trans('gallery.fields.notify')" />
                            <Checkbox v-model="indeterminate" :label="trans('gallery.fields.notify')" />
                            <Checkbox :model-value="true" :label="trans('gallery.fields.notify')" disabled />
                        </div>
                        <div class="flex flex-col gap-8">
                            <Switch v-model="on" :label="trans('gallery.fields.restrict')" />
                            <Switch v-model="off" :label="trans('gallery.fields.restrict')" />
                            <Switch :model-value="true" :label="trans('gallery.fields.restrict')" disabled />
                        </div>
                        <RadioGroup v-model="duration" :legend="trans('gallery.fields.duration')" :options="durations" />
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- status -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.status') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <div class="flex flex-wrap items-center gap-8">
                        <StatusPill tone="success" :label="trans('gallery.statuses.active')" />
                        <StatusPill tone="warning" :label="trans('gallery.statuses.restricted')" />
                        <StatusPill tone="danger" :label="trans('gallery.statuses.suspended')" />
                        <StatusPill tone="info" :label="trans('gallery.statuses.new')" />
                        <StatusPill :label="trans('gallery.statuses.pending')" />
                    </div>
                    <div class="flex flex-wrap items-center gap-8">
                        <Badge>{{ trans('gallery.statuses.pending') }}</Badge>
                        <Badge tone="info">{{ trans('gallery.statuses.new') }}</Badge>
                        <Badge tone="success">{{ trans('gallery.statuses.verified') }}</Badge>
                        <Badge tone="warning">{{ trans('gallery.statuses.restricted') }}</Badge>
                        <Badge tone="danger">{{ trans('gallery.statuses.suspended') }}</Badge>
                        <Badge tone="accent" tnum>{{ 12 }}</Badge>
                        <Kbd>{{ trans('shell.palette.esc') }}</Kbd>
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- navigation -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.navigation') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <Tabs v-model="tab" :items="tabs" :label="trans('gallery.sections.navigation')">
                        <template v-for="item in tabs" :key="item.value" #[item.value]>
                            <p class="text-admin-base text-ink-2">{{ trans('gallery.tabs.panel', { tab: item.label }) }}</p>
                        </template>
                    </Tabs>
                    <div class="flex flex-wrap items-center gap-12">
                        <DropdownMenu :items="menu">
                            <template #trigger><Button size="sm" :icon="PhDotsThree">{{ trans('gallery.variants.icon') }}</Button></template>
                        </DropdownMenu>
                        <Tooltip :content="trans('gallery.menu.tooltip')">
                            <Button size="sm" variant="ghost">{{ trans('gallery.menu.copy') }}</Button>
                        </Tooltip>
                    </div>
                    <Pagination :meta="rows.meta" />
                </ThemeFrame>
            </div>
        </section>

        <!-- feedback -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.feedback') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <EmptyQueue variant="clear" :title="trans('gallery.feedback.clear')" :body="trans('gallery.feedback.clear_body')" />
                    <EmptyQueue variant="quiet" :title="trans('gallery.feedback.quiet')" :body="trans('gallery.feedback.quiet_body')" />
                    <EmptyQueue variant="first" :title="trans('gallery.feedback.first')" :body="trans('gallery.feedback.first_body')" />
                    <StateBlock kind="error" :title="trans('ui.state.error_title')" :body="trans('ui.state.error_body')" />
                    <StateBlock kind="forbidden" :title="trans('gallery.feedback.forbidden')" :body="trans('gallery.feedback.forbidden_body')" />
                    <StateBlock kind="partial" :title="trans('gallery.feedback.partial')" :retryable="false" />
                    <ApprovalNotice />
                    <ApprovalNotice :approval="approval" dismissible />
                    <div class="flex flex-col gap-8">
                        <Skeleton shape="text" class="w-240" />
                        <Skeleton class="h-40 w-full" />
                        <div class="flex items-center gap-8"><Skeleton shape="circle" class="size-32" /><Skeleton shape="text" class="w-160" /></div>
                    </div>
                    <div class="flex gap-8">
                        <Button size="sm" @click="toast('success', trans('gallery.feedback.toast_text'))">{{ trans('gallery.feedback.toast_success') }}</Button>
                        <Button size="sm" @click="toast('error', trans('gallery.feedback.toast_error_text'), trans('ui.state.error_body'))">{{ trans('gallery.feedback.toast_error') }}</Button>
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- overlays -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.overlays') }}</h2>
            <div class="flex flex-wrap gap-8">
                <Button size="sm" data-testid="ADM-DEV.open-dialog" @click="dialogOpen = true">{{ trans('gallery.overlays.dialog') }}</Button>
                <Button size="sm" data-testid="ADM-DEV.open-drawer" @click="drawerOpen = true">{{ trans('gallery.overlays.drawer') }}</Button>
                <Button size="sm" variant="danger" data-testid="ADM-DEV.open-confirm" @click="confirmOpen = true">{{ trans('gallery.overlays.confirm') }}</Button>
                <Button size="sm" data-testid="ADM-DEV.open-bulk" @click="bulkOpen = true">{{ trans('gallery.overlays.bulk') }}</Button>
                <Button size="sm" data-testid="ADM-DEV.open-palette" @click="paletteOpen = true">{{ trans('gallery.overlays.palette') }}</Button>
            </div>
            <Dialog v-model:open="dialogOpen" test-id="ADM-DEV.dialog" :title="trans('gallery.overlays.dialog_title')" :description="trans('gallery.overlays.dialog_body')">
                <RadioGroup v-model="duration" :legend="trans('gallery.fields.duration')" :options="durations" />
                <template #footer>
                    <Button variant="ghost" @click="dialogOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                    <Button variant="primary" @click="dialogOpen = false">{{ trans('gallery.variants.primary') }}</Button>
                </template>
            </Dialog>
            <Drawer v-model:open="drawerOpen" test-id="ADM-DEV.drawer" :title="trans('gallery.overlays.drawer_title')">
                <div class="flex flex-col gap-16">
                    <Field :label="trans('gallery.fields.username')" :hint="trans('gallery.fields.username_hint')"><Input v-model="username" /></Field>
                    <Field :label="trans('gallery.fields.note')"><Textarea v-model="note" /></Field>
                </div>
                <template #footer>
                    <Button variant="ghost" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                    <Button variant="primary" @click="drawerOpen = false">{{ trans('gallery.variants.primary') }}</Button>
                </template>
            </Drawer>
            <ConfirmDialog
                v-model:open="confirmOpen"
                test-id="ADM-DEV.confirm"
                :title="trans('gallery.overlays.confirm_title')"
                :body="trans('gallery.overlays.confirm_body')"
                :confirm-label="trans('gallery.overlays.confirm_submit')"
                typed
                reason
                four-eyes
                @confirm="confirmOpen = false"
            />
            <BulkResultPanel v-model:open="bulkOpen" test-id="ADM-DEV.bulk" :title="trans('gallery.overlays.bulk_title')" :results="bulkResults" :label="memberName" :reason="() => trans('gallery.overlays.bulk_reason')" />
            <CommandPalette v-model:open="paletteOpen" />
        </section>

        <!-- KPIs & charts -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.kpis') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <div data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3">
                        <KpiTile :label="trans('gallery.kpis.members')" :value="284" :previous="241" :series="series" :period="trans('dashboard.kpis.series')" />
                        <KpiTile :label="trans('gallery.kpis.members')" :value="198" :previous="241" :series="[...series].reverse()" :period="trans('dashboard.kpis.series')" />
                        <KpiTile :label="trans('gallery.kpis.members')" :value="null" loading />
                    </div>
                    <ChartCard :title="trans('gallery.kpis.chart_line')" :labels="days" :series="[{ key: 'scans', label: trans('dashboard.charts.series_scans'), values: series.map((v) => v * 3) }, { key: 'reg', label: trans('dashboard.charts.series_registrations'), values: series, accent: true }]" />
                    <ChartCard type="bar" :title="trans('gallery.kpis.chart_bar')" :labels="topMakes.labels" :series="[{ key: 'vehicles', label: trans('dashboard.charts.series_vehicles'), values: topMakes.values }]" />
                    <div class="grid grid-cols-1 gap-16 tablet:grid-cols-3 wide:grid-cols-1">
                        <ChartCard :title="trans('gallery.states.loading')" :labels="[]" :series="[]" state="loading" />
                        <ChartCard :title="trans('gallery.states.empty')" :labels="[]" :series="[]" state="empty" />
                        <ChartCard :title="trans('gallery.states.error')" :labels="[]" :series="[]" state="error" />
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- diff & activity -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.diff') }}</h2>
            <div class="grid grid-cols-1 gap-16 wide:grid-cols-2">
                <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                    <DiffViewer :before="before" :after="after" />
                    <DiffViewer mode="text" :before="'Willkommen bei SPEED CLUB.\nZeig deine Garage.'" :after="'Willkommen bei SPEED CLUB.\nZeig deine Garage und deine Builds.\nScanne den QR-Code am Auto.'" />
                    <div class="grid grid-cols-1 gap-24 tablet:grid-cols-3 wide:grid-cols-1">
                        <ActivityTimeline :entries="timeline" />
                        <ActivityTimeline :entries="[]" state="loading" />
                        <ActivityTimeline :entries="[]" state="error" />
                    </div>
                </ThemeFrame>
            </div>
        </section>

        <!-- table -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.table') }}</h2>
            <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                <DataTable :id="`gallery-${frame.theme}`" :columns="columns" :rows="rows" :query="query" :caption="trans('gallery.table.caption')" :empty-title="trans('gallery.table.empty')" selectable :bulk-actions="bulkActions" export-url="/admin/dev/gallery" :test-id="`ADM-DEV.table.${frame.theme}`">
                    <template #cell-username="{ row }"><span class="font-semibold text-ink">{{ row.username }}</span></template>
                    <template #cell-status="{ row }"><StatusPill :tone="statusTone(row.status)" :label="trans(`gallery.statuses.${row.status}`)" /></template>
                    <template #cell-registered="{ row }"><span class="tabular-nums text-ink-2">{{ formatDate(row.registered) }}</span></template>
                </DataTable>
                <div class="grid grid-cols-1 gap-16 desktop:grid-cols-3">
                    <DataTable :id="`gallery-loading-${frame.theme}`" :columns="columns" :rows="rows" :query="query" :caption="trans('gallery.table.caption')" :empty-title="trans('gallery.table.empty')" force-state="loading" :test-id="`ADM-DEV.table-loading.${frame.theme}`" />
                    <DataTable :id="`gallery-empty-${frame.theme}`" :columns="columns" :rows="emptyRows" :query="query" :caption="trans('gallery.table.caption')" :empty-title="trans('gallery.table.empty')" :test-id="`ADM-DEV.table-empty.${frame.theme}`" />
                    <DataTable :id="`gallery-error-${frame.theme}`" :columns="columns" :rows="rows" :query="query" :caption="trans('gallery.table.caption')" :empty-title="trans('gallery.table.empty')" force-state="error" :test-id="`ADM-DEV.table-error.${frame.theme}`" />
                </div>
            </ThemeFrame>
        </section>

        <!-- record -->
        <section class="flex flex-col gap-12">
            <h2 class="text-headline text-ink">{{ trans('gallery.sections.record') }}</h2>
            <ThemeFrame v-for="frame in themes" :key="frame.theme" :theme="frame.theme" :label="frame.label()">
                <RecordLayout
                    v-model:tab="recordTab"
                    :title="trans('gallery.record.title')"
                    :crumbs="[{ label: trans('gallery.record.crumb') }]"
                    :status="{ tone: 'warning', label: trans('gallery.statuses.restricted') }"
                    :tabs="tabs"
                    :tabs-label="trans('gallery.sections.record')"
                    :activity="timeline"
                    :test-id="`ADM-DEV.record.${frame.theme}`"
                >
                    <template #meta><p class="text-admin-base text-ink-2">{{ trans('gallery.record.meta') }}</p></template>
                    <template #actions>
                        <Button size="sm" :icon="PhPencilSimple">{{ trans('gallery.record.edit') }}</Button>
                        <Button size="sm" variant="danger" :icon="PhProhibit">{{ trans('gallery.table.restrict') }}</Button>
                    </template>
                    <template #overview>
                        <DiffViewer :before="before" :after="after" />
                    </template>
                    <template #vehicles><EmptyQueue variant="first" :title="trans('gallery.feedback.first')" /></template>
                    <template #security><StateBlock kind="forbidden" :title="trans('gallery.feedback.forbidden')" /></template>
                    <template #reports><EmptyQueue variant="clear" :title="trans('gallery.feedback.clear')" /></template>
                </RecordLayout>
            </ThemeFrame>
        </section>
    </div>
</template>
