<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhTrash } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Checkbox, ConfirmDialog, EmptyQueue, Skeleton, Tabs } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';

/**
 * ADM-49 jobs (06 §3 System, m3.6 §1): failed jobs (class, queue, the exception's class, when) with retry and forget (system.jobs, up to
 * 100 at once), and the waiting ones (class, queue, attempts, running or waiting, due, queued). Never a payload or a message.
 */
interface Failed {
    uuid: string;
    connection: string;
    queue: string;
    job: string;
    exception: string;
    failed_at: string;
}
interface Pending {
    id: number;
    queue: string;
    job: string;
    attempts: number;
    reserved: boolean;
    available_at: string;
    created_at: string;
}
const props = defineProps<{ failed: Failed[]; pending: Pending[]; counts: { pending: number; failed: number }; heartbeat: string | null; canManage: boolean }>();

const { can } = usePermissions();
const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const zero = computed(() => pageState.value === 'empty');
const failedRows = computed(() => (zero.value ? [] : props.failed));
const pendingRows = computed(() => (zero.value ? [] : props.pending));
const tab = ref(props.failed.length === 0 && props.pending.length > 0 ? 'pending' : 'failed');
const tabs = computed(() => [
    { value: 'failed', label: trans('system.jobs.tabs.failed'), count: zero.value ? 0 : props.counts.failed },
    { value: 'pending', label: trans('system.jobs.tabs.pending'), count: zero.value ? 0 : props.counts.pending },
]);
/** "App\Jobs\BuildDataExport" → "BuildDataExport" with the namespace as caption. */
const shortName = (name: string) => name.split('\\').pop() ?? name;
const namespace = (name: string) => (name.includes('\\') ? name.slice(0, name.lastIndexOf('\\')) : '');

// ---- selection + actions ------------------------------------------------------------------------------------------------------
const manage = computed(() => props.canManage && can('system.jobs'));
const selected = ref<string[]>([]);
const all = computed<boolean | 'indeterminate'>(() => (selected.value.length === 0 ? false : selected.value.length === failedRows.value.length ? true : 'indeterminate'));
function toggleAll(on: boolean | 'indeterminate'): void {
    selected.value = on === true ? failedRows.value.slice(0, 100).map((j) => j.uuid) : [];
}
function toggle(uuid: string, on: boolean | 'indeterminate'): void {
    selected.value = on === true ? [...new Set([...selected.value, uuid])].slice(0, 100) : selected.value.filter((id) => id !== uuid);
}
const action = useAdminAction();
const confirm = ref<'retry' | 'forget' | null>(null);
const retryOpen = computed({ get: () => confirm.value === 'retry', set: (v: boolean) => (v ? null : (confirm.value = null)) });
const forgetOpen = computed({ get: () => confirm.value === 'forget', set: (v: boolean) => (v ? null : (confirm.value = null)) });
function run(kind: 'retry' | 'forget'): void {
    action.run('post', routeOr(`admin.system.jobs.${kind}`, `/admin/system/jobs/${kind}`), { ids: selected.value }, {
        sensitive: true,
        onSuccess: () => {
            confirm.value = null;
            selected.value = [];
        },
    });
}
onMounted(async () => {
    const overlay = qaDialog();
    if ((overlay !== 'retry' && overlay !== 'forget') || failedRows.value.length === 0) return;
    selected.value = failedRows.value.slice(0, 2).map((j) => j.uuid);
    action.reset();
    confirm.value = overlay;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('system.jobs.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-49" :data-qa-state="pageState">
        <PageHeader :title="trans('system.jobs.title')" :crumbs="[{ label: trans('shell.groups.system') }]" :description="trans('system.jobs.intro')">
            <template #meta>
                <p class="text-supporting tabular-nums" :class="heartbeat ? 'text-ink-2' : 'text-warning'" data-testid="ADM-49.heartbeat">{{ heartbeat ? trans('system.jobs.heartbeat', { date: formatDateTime(heartbeat) }) : trans('system.jobs.heartbeat_never') }}</p>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('system.jobs.error')" :body="trans('ui.state.error_body')" test-id="ADM-49.error" @retry="router.reload()" />
        <Tabs v-else v-model="tab" :items="tabs" :label="trans('system.jobs.tabs_label')">
            <template #failed>
                <div class="flex flex-col gap-12 pt-16">
                    <div v-if="manage && failedRows.length > 0" class="flex min-h-40 flex-wrap items-center gap-12" data-testid="ADM-49.bulk">
                        <span class="text-supporting text-ink-2 tabular-nums" aria-live="polite">{{ selected.length > 0 ? transChoice('system.jobs.selected', selected.length, { count: formatNumber(selected.length) }) : trans('system.jobs.limit') }}</span>
                        <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" :disabled="selected.length === 0" data-testid="ADM-49.retry" @click="(action.reset(), (confirm = 'retry'))">{{ trans('system.jobs.retry') }}</Button>
                        <Button size="sm" variant="destructive" :icon="PhTrash" :disabled="selected.length === 0" data-testid="ADM-49.forget" @click="(action.reset(), (confirm = 'forget'))">{{ trans('system.jobs.forget') }}</Button>
                    </div>
                    <p v-else-if="!manage && failedRows.length > 0" class="text-supporting text-ink-2">{{ trans('system.jobs.view_only') }}</p>
                    <div v-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true" data-testid="ADM-49.loading">
                        <div v-for="n in 6" :key="n" class="flex h-40 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><Skeleton class="size-16" /><Skeleton shape="text" class="w-200" /><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-120" /></div>
                    </div>
                    <EmptyQueue v-else-if="failedRows.length === 0" :title="trans('system.jobs.failed_empty')" :body="trans('system.jobs.failed_empty_body')" data-testid="ADM-49.failed-empty" />
                    <ScrollRegion v-else :label="trans('system.jobs.caption_failed')" test-id="ADM-49.failed">
                        <table class="w-full border-collapse text-supporting">
                            <caption class="sr-only">{{ trans('system.jobs.caption_failed') }}</caption>
                            <thead class="bg-surface text-left text-label-s text-ink-2">
                                <tr class="h-40 border-b border-line">
                                    <th v-if="manage" scope="col" class="w-48 px-12"><Checkbox :model-value="all" :aria-label="trans('system.jobs.select_all')" @update:model-value="toggleAll" /></th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.job') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.queue') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.exception') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.failed_at') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="job in failedRows" :key="job.uuid" class="min-h-40 border-b border-line-subtle last:border-b-0" :data-testid="`ADM-49.failed.${job.uuid}`">
                                    <td v-if="manage" class="px-12"><Checkbox :model-value="selected.includes(job.uuid)" :aria-label="trans('system.jobs.select', { job: shortName(job.job) })" @update:model-value="(on: boolean | 'indeterminate') => toggle(job.uuid, on)" /></td>
                                    <td class="px-12 py-4">
                                        <span class="sc-key block text-ink">{{ shortName(job.job) }}</span>
                                        <span v-if="namespace(job.job)" class="sc-key block text-caption text-ink-3">{{ namespace(job.job) }}</span>
                                    </td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ job.queue }}</td>
                                    <td class="sc-key px-12 text-ink-2">{{ shortName(job.exception) }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(job.failed_at) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                </div>
            </template>
            <template #pending>
                <div class="flex flex-col gap-12 pt-16">
                    <div v-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-hidden="true">
                        <div v-for="n in 6" :key="n" class="flex h-40 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-200" /><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-48" /><Skeleton shape="text" class="w-120" /></div>
                    </div>
                    <EmptyQueue v-else-if="pendingRows.length === 0" :title="trans('system.jobs.pending_empty')" :body="trans('system.jobs.pending_empty_body')" data-testid="ADM-49.pending-empty" />
                    <ScrollRegion v-else :label="trans('system.jobs.caption_pending')" test-id="ADM-49.pending">
                        <table class="w-full border-collapse text-supporting">
                            <caption class="sr-only">{{ trans('system.jobs.caption_pending') }}</caption>
                            <thead class="bg-surface text-left text-label-s text-ink-2">
                                <tr class="h-40 border-b border-line">
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.job') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.queue') }}</th>
                                    <th scope="col" class="px-12 text-right">{{ trans('system.jobs.columns.attempts') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.state') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.available_at') }}</th>
                                    <th scope="col" class="px-12">{{ trans('system.jobs.columns.created_at') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="job in pendingRows" :key="job.id" class="border-b border-line-subtle last:border-b-0">
                                    <td class="px-12 py-4">
                                        <span class="sc-key block text-ink">{{ shortName(job.job) }}</span>
                                        <span v-if="namespace(job.job)" class="sc-key block text-caption text-ink-3">{{ namespace(job.job) }}</span>
                                    </td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ job.queue }}</td>
                                    <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(job.attempts) }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ job.reserved ? trans('system.jobs.running') : trans('system.jobs.waiting') }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(job.available_at) }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(job.created_at) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                </div>
            </template>
        </Tabs>

        <ConfirmDialog v-model:open="retryOpen" :title="transChoice('system.jobs.retry_title', selected.length, { count: formatNumber(selected.length) })" :body="trans('system.jobs.retry_body')" :confirm-label="trans('system.jobs.retry')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-49.retry-dialog" @confirm="() => run('retry')" />
        <ConfirmDialog v-model:open="forgetOpen" :title="transChoice('system.jobs.forget_title', selected.length, { count: formatNumber(selected.length) })" :body="trans('system.jobs.forget_body')" :confirm-label="trans('system.jobs.forget')" :processing="action.processing.value" :error="action.error.value" test-id="ADM-49.forget-dialog" @confirm="() => run('forget')" />
    </div>
</template>
