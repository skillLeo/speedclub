<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhPencilSimple, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, EmptyQueue, IconButton, StatusPill } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import CategoryDrawer, { type CategoryRow } from './Partials/CategoryDrawer.vue';
import SkeletonRows from './Partials/SkeletonRows.vue';
import { categoryGlyph } from './shared';

/**
 * ADM-15 mod categories (06 §3 Catalogue, m3.3-contract §2): name DE/EN, key, icon, order, active, fields (archived ones apart) and the
 * modifications members filed in them; a category opens its field editor. catalog.manage: Neue Kategorie, Bearbeiten.
 */
interface Row extends CategoryRow {
    fields: number;
    archived_fields: number;
}
const props = defineProps<{ categories: Row[] }>();
const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage'));
const list = computed(() => (state.value === 'empty' ? [] : props.categories));
const href = (id: number): string => routeOr('admin.catalog.categories.show', `/admin/catalog/mod-categories/${id}`, { category: id });

const editing = ref<Row | null>(null);
const drawerOpen = ref(false);
function open(row: Row | null): void {
    editing.value = row;
    drawerOpen.value = true;
}
const dialog = qaDialog();
if (dialog === 'new') open(null);
else if (dialog === 'edit' && props.categories[0]) open(props.categories[0]);
</script>

<template>
    <Head :title="trans('catalog.categories.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-15" :data-qa-state="state">
        <PageHeader :title="trans('catalog.categories.title')" :crumbs="[{ label: trans('shell.groups.catalog') }]" :description="trans('catalog.categories.intro')">
            <template v-if="manage" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-15.new" @click="open(null)">{{ trans('catalog.actions.new_category') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.categories.error')" :body="trans('catalog.error_body')" test-id="ADM-15.error" />
        <EmptyQueue v-else-if="state !== 'loading' && list.length === 0" variant="first" :title="trans('catalog.categories.empty_title')" :body="trans('catalog.categories.empty_body')" data-testid="ADM-15.empty" />
        <ScrollRegion v-else :label="trans('catalog.categories.caption')" test-id="ADM-15.table">
            <table class="w-full text-supporting" :aria-busy="state === 'loading' || undefined">
                <caption class="sr-only">{{ trans('catalog.categories.caption') }}</caption>
                <!-- DQ-593: the same column widths while loading and with rows. -->
                <colgroup>
                    <col class="w-80" /><col /><col class="w-200" /><col class="w-80" /><col class="w-160" /><col class="w-96" /><col class="w-120" /><col v-if="manage" class="w-48" />
                </colgroup>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                        <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.sort') }}</th>
                        <th scope="col" class="px-12">{{ trans('catalog.columns.category') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.key') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.icon') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.fields') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.mods') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                        <th v-if="manage" scope="col" class="px-12"><span class="sr-only">{{ trans('catalog.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <SkeletonRows v-if="state === 'loading'" :bars="['ml-auto w-24', 'w-200', 'w-120', 'size-20', 'ml-auto w-24', 'ml-auto w-24', 'w-80', ...(manage ? ['size-24'] : [])]" :rows="10" test-id="ADM-15.loading" />
                <tbody v-else>
                    <tr v-for="c in list" :key="c.id" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-15.category">
                        <td class="px-12 text-right text-ink-3 tabular-nums">{{ c.sort }}</td>
                        <td class="px-12"><NameCell :name="c.name.de ?? c.key" :caption="c.name.en ?? null" :href="href(c.id)" test-id="ADM-15.open" /></td>
                        <td class="whitespace-nowrap px-12"><span class="sc-key text-ink-2">{{ c.key }}</span></td>
                        <!-- DQ-595: the glyph members see, its key as the tooltip. -->
                        <td class="px-12">
                            <span class="flex items-center text-ink-2" :title="c.icon ?? undefined" data-testid="ADM-15.icon">
                                <component :is="categoryGlyph(c.icon)" :size="20" aria-hidden="true" />
                                <span class="sr-only">{{ c.icon ?? '–' }}</span>
                            </span>
                        </td>
                        <td class="whitespace-nowrap px-12 text-right tabular-nums">
                            <span class="text-ink">{{ formatNumber(c.fields) }}</span>
                            <span v-if="c.archived_fields > 0" class="ml-4 text-caption text-ink-3">{{ trans('catalog.categories.archived_count', { count: formatNumber(c.archived_fields) }) }}</span>
                        </td>
                        <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(c.mods) }}</td>
                        <td class="px-12"><StatusPill :tone="c.active ? 'success' : 'neutral'" :label="trans(c.active ? 'catalog.status.active' : 'catalog.status.inactive')" /></td>
                        <td v-if="manage" class="px-12"><IconButton :icon="PhPencilSimple" :label="trans('catalog.categories.edit', { name: c.name.de ?? c.key })" size="xs" data-testid="ADM-15.edit" @click="open(c)" /></td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <CategoryDrawer v-model:open="drawerOpen" :category="editing" test-id="ADM-15.drawer" />
    </div>
</template>
