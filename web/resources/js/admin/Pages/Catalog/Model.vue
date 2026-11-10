<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhPlus } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed } from 'vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, EmptyQueue, StatusPill } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import EntryDialogs from './Partials/EntryDialogs.vue';
import EntryMenu from './Partials/EntryMenu.vue';
import MergedNotice from './Partials/MergedNotice.vue';
import SkeletonRows from './Partials/SkeletonRows.vue';
import RecordActions from './Partials/RecordActions.vue';
import { entryPill, makeHref, modelHref, useEntryDialogs, yearsText, type CatalogEntry } from './shared';

/**
 * ADM-14 drill-down, a model (m3.3-contract §2): its generations with build years, slug, vehicles and state. catalog.manage: edit,
 * deactivate, merge and delete the model; add, edit, deactivate, merge and delete its generations.
 */
interface ModelRecord extends CatalogEntry {
    make_id: number;
    active: boolean;
    vehicles: number;
}
interface GenerationRow extends CatalogEntry {
    model_id: number;
    year_from: number | null;
    year_to: number | null;
    active: boolean;
    vehicles: number;
}

const props = defineProps<{ make: { id: number; name: string } | null; model: ModelRecord; generations: GenerationRow[] }>();
const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage') && props.model.merged_into === null);
const list = computed(() => (state.value === 'empty' ? [] : props.generations));
const title = computed(() => [props.make?.name, props.model.name].filter(Boolean).join(' '));
const crumbs = computed(() => [
    { label: trans('shell.groups.catalog') },
    { label: trans('catalog.vehicles.title'), href: routeOr('admin.catalog.vehicles.makes', '/admin/catalog/makes') },
    ...(props.make ? [{ label: props.make.name, href: makeHref(props.make.id) }] : []),
]);

const modelDialogs = useEntryDialogs();
const generationDialogs = useEntryDialogs();
const dialog = qaDialog();
const firstGeneration = props.generations.find((g) => g.merged_into === null) ?? null;
if (dialog === 'new-generation') generationDialogs.show('create');
else if (dialog === 'edit' || dialog === 'merge' || dialog === 'delete' || dialog === 'active') modelDialogs.show(dialog, props.model);
else if (firstGeneration !== null && dialog === 'generation-edit') generationDialogs.show('edit', firstGeneration);

const meta = computed(() => [props.model.slug, transChoice('catalog.make.vehicles', props.model.vehicles, { count: formatNumber(props.model.vehicles) })].join(' · '));
</script>

<template>
    <Head :title="title" />
    <div class="flex flex-col gap-24" data-testid="ADM-14-model" :data-qa-state="state">
        <PageHeader :title="title" :crumbs="crumbs">
            <template #badge><StatusPill v-bind="entryPill(model)" /></template>
            <template #meta>
                <p class="text-supporting text-ink-2 tabular-nums" data-testid="ADM-14-model.meta">{{ meta }}</p>
            </template>
            <template v-if="manage" #actions>
                <RecordActions level="model" :entry="model" :dialogs="modelDialogs" test-id="ADM-14-model.action" />
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-14-model.new-generation" @click="generationDialogs.show('create')">{{ trans('catalog.actions.new_generation') }}</Button>
            </template>
        </PageHeader>

        <MergedNotice v-if="model.merged_into" :name="model.merged_into.name" :href="modelHref(model.merged_into.id)" test-id="ADM-14-model.merged" />

        <section class="flex flex-col gap-12" :aria-label="trans('catalog.model.generations_title')">
            <h2 class="text-title-s text-ink">{{ trans('catalog.model.generations_title') }}</h2>
            <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.model.error')" :body="trans('catalog.error_body')" test-id="ADM-14-model.error" />
            <!-- DQ-601: the header holds the one "Generation hinzufügen". -->
            <EmptyQueue v-else-if="state !== 'loading' && list.length === 0" variant="first" :title="trans('catalog.model.empty_title')" :body="trans('catalog.model.empty_body')" data-testid="ADM-14-model.empty" />
            <ScrollRegion v-else :label="trans('catalog.model.generations_caption', { model: title })" test-id="ADM-14-model.generations">
                <table class="w-full text-supporting" :aria-busy="state === 'loading' || undefined">
                    <caption class="sr-only">{{ trans('catalog.model.generations_caption', { model: title }) }}</caption>
                    <!-- DQ-593: the same column widths while loading and with rows. -->
                    <colgroup><col /><col class="w-160" /><col class="w-120" /><col class="w-240" /><col v-if="manage" class="w-48" /></colgroup>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                            <th scope="col" class="px-12">{{ trans('catalog.columns.generation') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.years') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.vehicles') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                            <th v-if="manage" scope="col" class="px-12"><span class="sr-only">{{ trans('catalog.columns.actions') }}</span></th>
                        </tr>
                    </thead>
                    <SkeletonRows v-if="state === 'loading'" :bars="['w-200', 'ml-auto w-80', 'ml-auto w-24', 'w-80', ...(manage ? ['size-24'] : [])]" :rows="4" test-id="ADM-14-model.loading" />
                    <tbody v-else>
                        <tr v-for="generation in list" :key="generation.id" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-14-model.generation">
                            <td class="px-12"><NameCell :name="generation.name" :caption="generation.slug" /></td>
                            <td class="whitespace-nowrap px-12 text-right text-ink-2 tabular-nums">{{ yearsText(generation.year_from, generation.year_to) }}</td>
                            <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(generation.vehicles) }}</td>
                            <td class="px-12">
                                <span class="flex items-center gap-8 whitespace-nowrap">
                                    <StatusPill v-bind="entryPill(generation)" />
                                    <span v-if="generation.merged_into" class="text-caption text-ink-3">{{ trans('catalog.status.merged_into', { name: generation.merged_into.name }) }}</span>
                                </span>
                            </td>
                            <td v-if="manage" class="px-12"><EntryMenu level="generation" :entry="generation" :dialogs="generationDialogs" test-id="ADM-14-model.row" /></td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <EntryDialogs :dialogs="modelDialogs" level="model" from-record test-id="ADM-14-model" />
        <EntryDialogs :dialogs="generationDialogs" level="generation" :parent="{ model_id: model.id }" :parent-name="title" test-id="ADM-14-model.generations" />
    </div>
</template>
