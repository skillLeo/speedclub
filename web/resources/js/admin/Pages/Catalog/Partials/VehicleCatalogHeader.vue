<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhDownloadSimple, PhFileArrowUp, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import PageHeader from '../../../Components/shell/PageHeader.vue';
import { Button, Tabs, type TabItem } from '../../../Components/ui';
import { usePermissions } from '../../../lib/permissions';
import { routeOr } from '../../../lib/routes';

/**
 * ADM-14 header (m3.3-contract §2): Fahrzeugkatalog with the tabs Marken and Anfragen (links: each tab is its own URL, so filters and
 * sorting of the other tab never mix), "Neue Marke", CSV of the catalogue (lists.export, ADR-232) and the way to the import.
 */
const props = defineProps<{ tab: 'makes' | 'requests'; counts: { makes: number; requests: number } | null }>();
const emit = defineEmits<{ create: [] }>();
const { can } = usePermissions();

const tabs = computed<TabItem[]>(() => [
    { value: 'makes', label: trans('catalog.tabs.makes'), count: props.counts?.makes ?? null },
    { value: 'requests', label: trans('catalog.tabs.requests'), count: props.counts?.requests ?? null },
]);
const tabModel = computed({
    get: () => props.tab,
    set: (value: string) =>
        router.visit(value === 'requests' ? routeOr('admin.catalog.vehicles.requests', '/admin/catalog/requests') : routeOr('admin.catalog.vehicles.makes', '/admin/catalog/makes')),
});
const exportUrl = routeOr('admin.catalog.export', '/admin/catalog/export/vehicles.csv', { kind: 'vehicles' });
const importUrl = routeOr('admin.catalog.import', '/admin/catalog/import');
</script>

<template>
    <div class="flex flex-col gap-16">
        <PageHeader :title="trans('catalog.vehicles.title')" :crumbs="[{ label: trans('shell.groups.catalog') }]" :description="trans('catalog.vehicles.intro')">
            <template #actions>
                <Button v-if="can('catalog.import')" size="sm" variant="ghost" :icon="PhFileArrowUp" :href="importUrl" data-testid="ADM-14.import">{{ trans('catalog.actions.import') }}</Button>
                <Button v-if="can('lists.export')" size="sm" variant="secondary" :icon="PhDownloadSimple" :href="exportUrl" external data-testid="ADM-14.export">{{ trans('catalog.actions.export_vehicles') }}</Button>
                <Button v-if="tab === 'makes' && can('catalog.manage')" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-14.new" @click="emit('create')">{{ trans('catalog.actions.new_make') }}</Button>
            </template>
        </PageHeader>
        <Tabs v-model="tabModel" :items="tabs" :label="trans('catalog.tabs.label')" :panels="false" data-testid="ADM-14.tabs" />
    </div>
</template>
