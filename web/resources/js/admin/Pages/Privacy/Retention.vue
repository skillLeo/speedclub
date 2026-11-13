<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhFloppyDisk, PhLockSimple } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Input, Skeleton } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-47 retention (06 §4, m3.6 §1, ADR-239): every period with its legal note; the adjustable ones as a number within their bounds
 * (the legal or product minimum up to what the privacy policy promises) with the default; the fixed ones read-only. Saving needs
 * retention.manage, a reason and a recent password, and publishes a new version of the config key `retention`.
 */
interface Period {
    key: string;
    editable: boolean;
    unit: 'hours' | 'days' | 'months' | null;
    value: number | null;
    default: number | null;
    min: number | null;
    max: number | null;
}
const props = defineProps<{ periods: Period[]; lastPublished: { version: number; at: string | null; by: string | null } | null; canEdit: boolean }>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const editable = computed(() => props.periods.filter((p) => p.editable));
const fixed = computed(() => props.periods.filter((p) => !p.editable));

const draft = reactive<Record<string, string>>({});
function reset(): void {
    for (const p of editable.value) draft[p.key] = p.value === null ? '' : String(p.value);
}
watch(() => props.periods, reset, { immediate: true });
const parsed = (p: Period) => (/^\d{1,4}$/.test(draft[p.key] ?? '') ? Number(draft[p.key]) : NaN);
const invalid = (p: Period) => {
    const v = parsed(p);
    return Number.isNaN(v) || (p.min !== null && v < p.min) || (p.max !== null && v > p.max);
};
const changed = computed(() => editable.value.filter((p) => !invalid(p) && parsed(p) !== p.value));
const anyInvalid = computed(() => editable.value.some(invalid));
const amount = (unit: Period['unit'], value: number | null) => (unit === null || value === null ? '–' : transChoice(`privacy.retention.units.${unit}`, value, { count: formatNumber(value) }));
const label = (key: string) => trans(`privacy.retention.keys.${key}.label`);
const note = (key: string) => trans(`privacy.retention.keys.${key}.note`);
const fixedValue = (p: Period) => (p.value === null ? trans(`privacy.retention.keys.${p.key}.value`) : amount(p.unit, p.value));

const action = useAdminAction();
const confirmOpen = ref(false);
function save(reason: string | null): void {
    const periods = Object.fromEntries(editable.value.map((p) => [p.key, parsed(p)]));
    action.run('patch', routeOr('admin.privacy.retention.update', '/admin/privacy/retention'), { periods, reason: reason ?? '' }, { sensitive: true, onSuccess: () => (confirmOpen.value = false) });
}
const confirmBody = computed(() => [trans('privacy.retention.confirm_body'), ...changed.value.map((p) => `${label(p.key)}: ${amount(p.unit, p.value)} → ${amount(p.unit, parsed(p))}.`)].join(' '));
onMounted(async () => {
    if (qaDialog() !== 'save' || !props.canEdit) return;
    const first = editable.value.find((p) => p.key === 'support_tickets_months') ?? editable.value[0];
    if (first) draft[first.key] = String(first.min ?? first.value ?? 0);
    confirmOpen.value = true;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('privacy.retention.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-47" :data-qa-state="pageState">
        <PageHeader :title="trans('privacy.retention.title')" :crumbs="[{ label: trans('shell.groups.audit_privacy') }]" :description="trans('privacy.retention.intro')">
            <template #meta>
                <p class="text-admin-base text-ink-2 tabular-nums" data-testid="ADM-47.last">{{ lastPublished ? trans('privacy.retention.last', { version: formatNumber(lastPublished.version), date: formatDateTime(lastPublished.at), name: lastPublished.by ?? '–' }) : trans('privacy.retention.never') }}</p>
            </template>
            <template v-if="canEdit && pageState === 'ready'" #actions>
                <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :disabled="changed.length === 0 && !anyInvalid" data-testid="ADM-47.discard" @click="reset()">{{ trans('privacy.retention.discard') }}</Button>
                <Button size="sm" variant="primary" :icon="PhFloppyDisk" :disabled="changed.length === 0 || anyInvalid" data-testid="ADM-47.save" @click="(action.reset(), (confirmOpen = true))">{{ trans('privacy.retention.save') }}</Button>
            </template>
        </PageHeader>
        <p v-if="!canEdit" class="text-admin-base text-ink-2" data-testid="ADM-47.view-only">{{ trans('privacy.retention.view_only') }}</p>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('privacy.retention.error')" :body="trans('ui.state.error_body')" test-id="ADM-47.error" @retry="router.reload()" />
        <template v-else>
            <section class="flex flex-col gap-12" data-testid="ADM-47.editable">
                <h2 class="text-headline text-ink">{{ trans('privacy.retention.editable_title') }}</h2>
                <div v-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true">
                    <div v-for="n in 8" :key="n" class="flex min-h-64 items-center gap-24 border-b border-line-subtle px-12 py-8 last:border-b-0">
                        <span class="flex flex-1 flex-col gap-4"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-full" /></span>
                        <Skeleton class="h-32 w-120" /><Skeleton shape="text" class="w-96" /><Skeleton shape="text" class="w-80" />
                    </div>
                </div>
                <ScrollRegion v-else :label="trans('privacy.retention.caption')">
                    <table class="w-full border-collapse text-admin-base">
                        <caption class="sr-only">{{ trans('privacy.retention.caption') }}</caption>
                        <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                            <tr class="h-40 border-b border-line">
                                <th scope="col" class="px-12">{{ trans('privacy.retention.columns.area') }}</th>
                                <th scope="col" class="w-160 px-12">{{ trans('privacy.retention.columns.period') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12">{{ trans('privacy.retention.columns.bounds') }}</th>
                                <th scope="col" class="whitespace-nowrap px-12">{{ trans('privacy.retention.columns.default') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in editable" :key="p.key" class="border-b border-line-subtle align-top last:border-b-0" :data-testid="`ADM-47.row.${p.key}`">
                                <th scope="row" class="px-12 py-8 text-left font-normal">
                                    <!-- DQ-642: every cell's first line sits on the 32 px line of the input. -->
                                    <label :for="`adm47-${p.key}`" class="flex min-h-32 items-center text-admin-base-strong text-ink">{{ label(p.key) }}</label>
                                    <span :id="`adm47-${p.key}-note`" class="block max-w-560 text-admin-base text-ink-3">{{ note(p.key) }}</span>
                                </th>
                                <td class="px-12 py-8">
                                    <span class="flex items-center gap-8">
                                        <Input
                                            :id="`adm47-${p.key}`"
                                            v-model="draft[p.key]"
                                            size="sm"
                                            tnum
                                            inputmode="numeric"
                                            class="w-80 text-right"
                                            :invalid="invalid(p)"
                                            :disabled="!canEdit"
                                            :aria-describedby="`adm47-${p.key}-note`"
                                            :data-testid="`ADM-47.input.${p.key}`"
                                        />
                                        <span class="text-ink-2">{{ p.unit ? trans(`privacy.retention.unit_names.${p.unit}`) : '' }}</span>
                                    </span>
                                    <span v-if="invalid(p)" class="mt-4 block text-admin-base text-danger" role="alert">{{ trans('privacy.retention.out_of_bounds', { min: formatNumber(p.min), max: formatNumber(p.max) }) }}</span>
                                    <span v-else-if="parsed(p) !== p.value" class="mt-4 block text-admin-base text-ink-3">{{ trans('privacy.retention.changed') }}</span>
                                </td>
                                <td class="whitespace-nowrap px-12 py-8 text-ink-2 tabular-nums"><span class="flex min-h-32 items-center">{{ trans('privacy.retention.bounds', { min: formatNumber(p.min), max: amount(p.unit, p.max) }) }}</span></td>
                                <td class="whitespace-nowrap px-12 py-8 text-ink-2 tabular-nums"><span class="flex min-h-32 items-center">{{ amount(p.unit, p.default) }}</span></td>
                            </tr>
                        </tbody>
                    </table>
                </ScrollRegion>
            </section>

            <section class="flex flex-col gap-12" data-testid="ADM-47.fixed">
                <div class="flex flex-col gap-4">
                    <h2 class="text-headline text-ink">{{ trans('privacy.retention.fixed_title') }}</h2>
                    <p class="max-w-720 text-admin-base text-ink-2">{{ trans('privacy.retention.fixed_body') }}</p>
                </div>
                <div v-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-hidden="true">
                    <div v-for="n in 10" :key="n" class="flex min-h-48 items-center gap-24 border-b border-line-subtle px-12 py-8 last:border-b-0"><span class="flex flex-1 flex-col gap-4"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /></span><Skeleton shape="text" class="w-96" /></div>
                </div>
                <ul v-else class="flex flex-col rounded-sm border border-line-subtle">
                    <li v-for="p in fixed" :key="p.key" class="flex flex-wrap items-start gap-x-24 gap-y-4 border-b border-line-subtle px-12 py-8 last:border-b-0" :data-testid="`ADM-47.fixed.${p.key}`">
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-admin-base-strong text-ink">{{ label(p.key) }}</span>
                            <span class="max-w-560 text-admin-base text-ink-3">{{ note(p.key) }}</span>
                        </span>
                        <span class="inline-flex items-center gap-4 whitespace-nowrap text-admin-base text-ink-2 tabular-nums"><PhLockSimple :size="16" aria-hidden="true" />{{ fixedValue(p) }}</span>
                    </li>
                </ul>
            </section>
        </template>

        <ConfirmDialog v-model:open="confirmOpen" :title="trans('privacy.retention.confirm_title')" :body="confirmBody" :confirm-label="trans('privacy.retention.save')" tone="neutral" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-47.confirm" @confirm="(r: string | null) => save(r)" />
    </div>
</template>
