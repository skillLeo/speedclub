<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhPlus } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed } from 'vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, EmptyQueue, StatusPill } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import EntryDialogs from './Partials/EntryDialogs.vue';
import EntryMenu from './Partials/EntryMenu.vue';
import MergedLink from './Partials/MergedLink.vue';
import MergedNotice from './Partials/MergedNotice.vue';
import SkeletonRows from './Partials/SkeletonRows.vue';
import RecordActions from './Partials/RecordActions.vue';
import { entryPill, makeHref, modelHref, useEntryDialogs, type CatalogEntry } from './shared';

/**
 * ADM-14 drill-down, a make (m3.3-contract §2): its facts and its models (generations, vehicles, state); a model opens its generations.
 * catalog.manage: edit, deactivate, merge and delete the make; add, edit, deactivate, merge and delete its models.
 */
interface MakeRecord extends CatalogEntry {
    country: string | null;
    is_popular: boolean;
    sort: number;
    active: boolean;
    vehicles: number;
}
interface ModelRow extends CatalogEntry {
    make_id: number;
    active: boolean;
    generations: number;
    vehicles: number;
}

const props = defineProps<{ make: MakeRecord; models: ModelRow[] }>();
const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage') && props.make.merged_into === null);
const list = computed(() => (state.value === 'empty' ? [] : props.models));
const listHref = routeOr('admin.catalog.vehicles.makes', '/admin/catalog/makes');
const crumbs = computed(() => [{ label: trans('shell.groups.catalog') }, { label: trans('catalog.vehicles.title'), href: listHref }]);

const makeDialogs = useEntryDialogs();
const modelDialogs = useEntryDialogs();
const dialog = qaDialog();
const firstModel = props.models.find((m) => m.merged_into === null) ?? null;
if (dialog === 'new-model') modelDialogs.show('create');
else if (dialog === 'edit' || dialog === 'merge' || dialog === 'delete' || dialog === 'active') makeDialogs.show(dialog, props.make);
else if (firstModel !== null && dialog === 'model-merge') modelDialogs.show('merge', firstModel);

const meta = computed(() =>
    [
        props.make.slug,
        props.make.country ? trans('catalog.make.country', { country: props.make.country }) : null,
        transChoice('catalog.make.vehicles', props.make.vehicles, { count: formatNumber(props.make.vehicles) }),
    ]
        .filter(Boolean)
        .join(' · '),
);
</script>

<template>
    <Head :title="make.name" />
    <div class="flex flex-col gap-24" data-testid="ADM-14-make" :data-qa-state="state">
        <PageHeader :title="make.name" :crumbs="crumbs">
            <template #badge>
                <StatusPill v-bind="entryPill(make)" />
                <Badge v-if="make.is_popular" tone="neutral">{{ trans('catalog.makes.popular') }}</Badge>
            </template>
            <template #meta>
                <p class="text-supporting text-ink-2 tabular-nums" data-testid="ADM-14-make.meta">{{ meta }}</p>
            </template>
            <template v-if="manage" #actions>
                <RecordActions level="make" :entry="make" :dialogs="makeDialogs" test-id="ADM-14-make.action" />
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-14-make.new-model" @click="modelDialogs.show('create')">{{ trans('catalog.actions.new_model') }}</Button>
            </template>
        </PageHeader>

        <MergedNotice v-if="make.merged_into" :name="make.merged_into.name" :href="makeHref(make.merged_into.id)" test-id="ADM-14-make.merged" />

        <section class="flex flex-col gap-12" :aria-label="trans('catalog.make.models_title')">
            <h2 class="text-title-s text-ink">{{ trans('catalog.make.models_title') }}</h2>
            <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.make.error')" :body="trans('catalog.error_body')" test-id="ADM-14-make.error" />
            <!-- DQ-601: the header holds the one "Modell hinzufügen". -->
            <EmptyQueue v-else-if="state !== 'loading' && list.length === 0" variant="first" :title="trans('catalog.make.empty_title')" :body="trans('catalog.make.empty_body')" data-testid="ADM-14-make.empty" />
            <ScrollRegion v-else :label="trans('catalog.make.models_caption', { make: make.name })" test-id="ADM-14-make.models">
                <table class="w-full text-supporting" :aria-busy="state === 'loading' || undefined">
                    <caption class="sr-only">{{ trans('catalog.make.models_caption', { make: make.name }) }}</caption>
                    <!-- DQ-593: the same column widths while loading and with rows. -->
                    <colgroup><col /><col class="w-120" /><col class="w-120" /><col class="w-240" /><col v-if="manage" class="w-48" /></colgroup>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                            <th scope="col" class="px-12">{{ trans('catalog.columns.model') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.generations') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.vehicles') }}</th>
                            <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                            <th v-if="manage" scope="col" class="px-12"><span class="sr-only">{{ trans('catalog.columns.actions') }}</span></th>
                        </tr>
                    </thead>
                    <SkeletonRows v-if="state === 'loading'" :bars="['w-200', 'ml-auto w-24', 'ml-auto w-24', 'w-80', ...(manage ? ['size-24'] : [])]" test-id="ADM-14-make.loading" />
                    <tbody v-else>
                        <tr v-for="model in list" :key="model.id" class="h-40 border-b border-line-subtle last:border-b-0 hover:bg-hover" data-testid="ADM-14-make.model">
                            <td class="px-12"><NameCell :name="model.name" :caption="model.slug" :href="modelHref(model.id)" test-id="ADM-14-make.open" /></td>
                            <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(model.generations) }}</td>
                            <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(model.vehicles) }}</td>
                            <td class="px-12">
                                <span class="flex items-center gap-8 whitespace-nowrap">
                                    <StatusPill v-bind="entryPill(model)" />
                                    <MergedLink v-if="model.merged_into" :name="model.merged_into.name" :href="modelHref(model.merged_into.id)" />
                                </span>
                            </td>
                            <td v-if="manage" class="px-12"><EntryMenu level="model" :entry="model" :dialogs="modelDialogs" test-id="ADM-14-make.row" /></td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <EntryDialogs :dialogs="makeDialogs" level="make" from-record test-id="ADM-14-make" />
        <EntryDialogs :dialogs="modelDialogs" level="model" :parent="{ make_id: make.id }" :parent-name="make.name" test-id="ADM-14-make.models" />
    </div>
</template>
