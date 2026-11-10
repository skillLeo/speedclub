<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhFunnel, PhPencilSimple, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, DateRangeField, Drawer, Field, IconButton, Input, Select, Textarea, Tooltip } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { dayToInstant, instantToDay } from '../Content/Partials/dates';

/**
 * ADM-38 Release-Register (06 §3): every build with version name and code, platform, channel, the APK's SHA-256, notes and date, and
 * where the row came from (docs/RELEASES.md or entered here). "Aus RELEASES.md übernehmen" runs the idempotent sync (same version, build,
 * channel and platform = one row); manual entries and corrections are audited.
 */
interface ReleaseRow {
    id: string;
    version_name: string;
    version_code: number;
    platform: 'android' | 'ios' | 'web';
    channel: 'lan' | 'staging' | 'production';
    apk_sha256: string | null;
    notes: string | null;
    notes_summary: string | null;
    notes_html: string | null;
    released_at: string | null;
    source: 'manual' | 'sync';
    created_by: string | null;
}

const props = defineProps<{ rows: Paginated<ReleaseRow>; query: TableQuery; views: SavedView[]; registerFile: boolean }>();
const state = usePageState();
const failedDialog = qaDialogFailed();

const columns = computed<TableColumn[]>(() => [
    { key: 'version_name', label: trans('config.releases.columns.version'), sort: 'version_name', min: 96, hideable: false },
    { key: 'version_code', label: trans('config.releases.columns.code'), sort: 'version_code', numeric: true },
    { key: 'platform', label: trans('config.releases.columns.platform') },
    { key: 'channel', label: trans('config.releases.columns.channel') },
    { key: 'apk_sha256', label: trans('config.releases.columns.sha'), min: 120 },
    { key: 'notes', label: trans('config.releases.columns.notes'), grow: true, min: 200 },
    { key: 'released_at', label: trans('config.releases.columns.released'), sort: 'released_at', min: 120 },
    { key: 'source', label: trans('config.releases.columns.source'), defaultHidden: true },
    { key: 'actions', label: trans('config.releases.columns.actions'), srOnlyLabel: true, hideable: false },
]);
const presets: PresetView[] = [
    { key: 'production', name: 'config.releases.presets.production', query: { filter: { channel: 'production' } } },
    { key: 'android', name: 'config.releases.presets.android', query: { filter: { platform: 'android' } } },
];

const filters = reactive({ q: '', platform: '', channel: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', platform: filter.platform ?? '', channel: filter.channel ?? '' }),
    { immediate: true },
);
const ANY = '*';
const choice = (name: 'platform' | 'channel') =>
    computed({ get: () => (filters[name] === '' ? undefined : filters[name]), set: (value: string | undefined) => (filters[name] = value === undefined || value === ANY ? '' : value) });
const platformModel = choice('platform');
const channelModel = choice('channel');
const PLATFORMS = ['android', 'ios', 'web'] as const;
const CHANNELS = ['lan', 'staging', 'production'] as const;
const platformOptions = computed(() => [{ value: ANY, label: trans('config.releases.any') }, ...PLATFORMS.map((value) => ({ value, label: trans(`config.releases.platforms.${value}`) }))]);
const channelOptions = computed(() => [{ value: ANY, label: trans('config.releases.any') }, ...CHANNELS.map((value) => ({ value, label: trans(`config.releases.channels.${value}`) }))]);

const action = useAdminAction();
function sync(): void {
    action.run('post', routeOr('admin.config.releases.sync', '/admin/config/releases/sync'), {});
}

// DQ-614: the full note of a build.
const notesOf = ref<ReleaseRow | null>(null);
const prose = 'max-w-720 text-supporting text-ink-2 [&_code]:font-ui [&_code]:text-ink [&_li]:mb-4 [&_p]:mb-12 [&_ul]:list-disc [&_ul]:pl-20';
if (qaDialog() === 'notes') notesOf.value = props.rows.data.find((row) => row.notes_html !== null) ?? null;

// Manual entry and correction.
const editing = ref<ReleaseRow | null>(null);
const drawerOpen = ref(false);
const form = reactive({ version_name: '', version_code: '', platform: 'android', channel: 'production', apk_sha256: '', notes: '', day: '', reason: '' });
const errors = ref<Record<string, string>>({});
function open(row: ReleaseRow | null): void {
    editing.value = row;
    Object.assign(form, row === null
        ? { version_name: '', version_code: '', platform: 'android', channel: 'production', apk_sha256: '', notes: '', day: '', reason: '' }
        : { version_name: row.version_name, version_code: String(row.version_code), platform: row.platform, channel: row.channel, apk_sha256: row.apk_sha256 ?? '', notes: row.notes ?? '', day: instantToDay(row.released_at), reason: '' });
    errors.value = {};
    action.reset();
    drawerOpen.value = true;
}
if (qaDialog() === 'new') open(null);
if (qaDialog() === 'edit' && props.rows.data[0]) open(props.rows.data[0]);
function save(): void {
    const next: Record<string, string> = {};
    if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(form.version_name.trim())) next.version_name = trans('config.releases.version_hint');
    if (!/^\d{1,10}$/.test(form.version_code.trim())) next.version_code = trans('config.releases.code_hint');
    if (form.apk_sha256.trim() !== '' && !/^[0-9A-Fa-f]{64}$/.test(form.apk_sha256.trim())) next.apk_sha256 = trans('config.releases.sha_hint');
    if (form.reason.trim() !== '' && form.reason.trim().length < 10) next.reason = trans('ui.confirm.reason_length');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const data = {
        version_name: form.version_name.trim(),
        version_code: Number(form.version_code),
        platform: form.platform,
        channel: form.channel,
        apk_sha256: form.apk_sha256.trim() === '' ? null : form.apk_sha256.trim(),
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        released_at: form.day === '' ? null : dayToInstant(form.day),
        ...(editing.value && form.reason.trim() !== '' ? { reason: form.reason.trim() } : {}),
    };
    const url = editing.value ? routeOr('admin.config.releases.update', `/admin/config/releases/${editing.value.id}`, { release: editing.value.id }) : routeOr('admin.config.releases.store', '/admin/config/releases');
    action.run(editing.value ? 'patch' : 'post', url, data, { onSuccess: () => (drawerOpen.value = false) });
}
const formPlatform = computed({ get: () => form.platform, set: (value: string | undefined) => (form.platform = value ?? 'android') });
const formChannel = computed({ get: () => form.channel, set: (value: string | undefined) => (form.channel = value ?? 'production') });
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
const shortSha = (sha: string) => `${sha.slice(0, 8)}…${sha.slice(-4)}`;
async function copy(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text);
}
</script>

<template>
    <Head :title="trans('config.releases.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-38" :data-qa-state="state">
        <PageHeader :title="trans('config.releases.title')" :crumbs="[{ label: trans('shell.groups.configuration') }]" :description="trans('config.releases.intro')">
            <template #actions>
                <Button v-if="registerFile" size="sm" variant="secondary" :icon="PhArrowsClockwise" :loading="action.processing.value && !drawerOpen" data-testid="ADM-38.sync" @click="sync">{{ trans('config.releases.sync') }}</Button>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-38.new" @click="open(null)">{{ trans('config.releases.new') }}</Button>
            </template>
        </PageHeader>

        <DataTable
            id="releases"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('config.releases.caption')"
            :empty-title="trans('config.releases.empty_title')"
            :empty-body="registerFile ? trans('config.releases.empty_body') : trans('config.releases.empty_body_manual')"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-38.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('config.releases.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="w-160"><Field :label="trans('config.releases.filters.q')"><Input v-model="filters.q" size="sm" maxlength="32" tnum :placeholder="trans('config.releases.filters.q_placeholder')" /></Field></div>
                    <div class="w-160"><Field :label="trans('config.releases.filters.platform')"><Select v-model="platformModel" :options="platformOptions" size="sm" :placeholder="trans('config.releases.any')" /></Field></div>
                    <div class="w-160"><Field :label="trans('config.releases.filters.channel')"><Select v-model="channelModel" :options="channelOptions" size="sm" :placeholder="trans('config.releases.any')" /></Field></div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading">{{ trans('config.releases.filters.apply') }}</Button>
                </form>
            </template>
            <template #cell-version_name="{ row }"><span class="whitespace-nowrap tabular-nums text-ink">{{ row.version_name }}</span></template>
            <template #cell-version_code="{ row }">{{ formatNumber(row.version_code) }}</template>
            <template #cell-platform="{ row }">{{ trans(`config.releases.platforms.${row.platform}`) }}</template>
            <template #cell-channel="{ row }"><Badge :tone="row.channel === 'production' ? 'success' : 'neutral'">{{ trans(`config.releases.channels.${row.channel}`) }}</Badge></template>
            <template #cell-apk_sha256="{ row }">
                <Tooltip v-if="row.apk_sha256" :content="row.apk_sha256">
                    <button type="button" :class="[focusRing, 'inline-flex h-24 items-center rounded-xs tabular-nums text-ink-2 hover:text-ink']" :aria-label="trans('config.releases.copy_sha', { sha: shortSha(row.apk_sha256) })" @click="copy(row.apk_sha256)">{{ shortSha(row.apk_sha256) }}</button>
                </Tooltip>
                <span v-else class="text-ink-3">–</span>
            </template>
            <!-- DQ-614: one line in the table (40 px rows); the whole note in the Notizen drawer. -->
            <template #cell-notes="{ row }">
                <!-- Absolutely placed, so the one-line note never widens the table (the column takes what is left, the rest is cut). -->
                <span v-if="row.notes_summary" class="relative block h-24 w-full min-w-200">
                    <button
                        type="button"
                        :class="[focusRing, 'absolute inset-x-0 top-0 h-24 truncate rounded-xs text-left text-ink-2 hover:text-ink hover:underline']"
                        :title="row.notes_summary"
                        data-testid="ADM-38.notes"
                        @click.stop="notesOf = row"
                    >
                        {{ row.notes_summary }}
                    </button>
                </span>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-released_at="{ row }"><span class="whitespace-nowrap tabular-nums text-ink-2">{{ formatDateTime(row.released_at) }}</span></template>
            <template #cell-source="{ row }">{{ row.source === 'sync' ? trans('config.releases.sources.sync') : trans('config.releases.sources.manual', { name: row.created_by ?? trans('config.draft.person') }) }}</template>
            <template #cell-actions="{ row }"><IconButton :icon="PhPencilSimple" size="sm" :label="trans('config.releases.edit', { version: row.version_name })" data-testid="ADM-38.edit" @click.stop="open(row)" /></template>
        </DataTable>
        <p v-if="action.error.value && !drawerOpen" class="text-helper text-danger" role="alert">{{ action.error.value }}</p>

        <Drawer
            :open="notesOf !== null"
            :title="trans('config.releases.notes_title', { version: notesOf?.version_name ?? '', code: String(notesOf?.version_code ?? '') })"
            size="md"
            test-id="ADM-38.notes-drawer"
            @update:open="(value: boolean) => (value ? null : (notesOf = null))"
        >
            <!-- Rendered by SafeMarkdown on the server (escaped, no raw HTML). -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="notesOf?.notes_html" :class="prose" v-html="notesOf.notes_html" />
        </Drawer>

        <Drawer v-model:open="drawerOpen" :title="editing ? trans('config.releases.edit_title', { version: editing.version_name }) : trans('config.releases.new')" size="md" :dismissible="!action.processing.value" test-id="ADM-38.drawer">
            <form id="adm38-form" class="flex flex-col gap-16" novalidate @submit.prevent="save">
                <StateBlock v-if="serverError" kind="error" :title="serverError" :retryable="false" test-id="ADM-38.form.error" />
                <div class="grid grid-cols-2 gap-12">
                    <Field :label="trans('config.releases.fields.version')" :hint="trans('config.releases.version_hint')" :error="errors.version_name" required><Input v-model="form.version_name" maxlength="32" tnum data-testid="ADM-38.form.version" /></Field>
                    <Field :label="trans('config.releases.fields.code')" :error="errors.version_code" required><Input v-model="form.version_code" inputmode="numeric" maxlength="10" tnum data-testid="ADM-38.form.code" /></Field>
                    <Field :label="trans('config.releases.fields.platform')" required><Select v-model="formPlatform" :options="platformOptions.slice(1)" /></Field>
                    <Field :label="trans('config.releases.fields.channel')" required><Select v-model="formChannel" :options="channelOptions.slice(1)" /></Field>
                </div>
                <Field :label="trans('config.releases.fields.sha')" :hint="trans('config.releases.sha_hint')" :error="errors.apk_sha256" optional><Input v-model="form.apk_sha256" maxlength="64" spellcheck="false" class="sc-key" /></Field>
                <Field :label="trans('config.releases.fields.released')" optional><DateRangeField v-model:from="form.day" single test-id="ADM-38.form.day" /></Field>
                <Field :label="trans('config.releases.fields.notes')" optional><Textarea v-model="form.notes" :rows="4" :maxlength="5000" /></Field>
                <Field v-if="editing" :label="trans('config.releases.fields.reason')" :hint="trans('config.releases.reason_hint')" :error="errors.reason" optional><Textarea v-model="form.reason" :rows="2" :maxlength="1000" /></Field>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm38-form" variant="primary" :loading="action.processing.value" data-testid="ADM-38.form.save">{{ trans('config.releases.save') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
