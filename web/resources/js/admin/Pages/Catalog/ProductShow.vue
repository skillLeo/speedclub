<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArchive, PhArrowCounterClockwise, PhArrowSquareOut, PhArrowsMerge, PhLockSimple, PhPencilSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Badge, Button, ConfirmDialog, SegmentedControl, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import MergedNotice from './Partials/MergedNotice.vue';
import ProductDrawer from './Partials/ProductDrawer.vue';
import ProductMergeDialog from './Partials/ProductMergeDialog.vue';
import { attributePairs, productHref, productPill, productsUrl, productWriteUrl, type CategoryOption, type ProductDetail } from './Partials/products';
import { useCatalogWrite } from './shared';

/**
 * ADM-57 part record (09 §8.9, §10.2 record page): the part as members see it when they link a mod (brand, name, line, the maker's
 * facts per language, maker and affiliate links, other spellings), how many mods link it, and the activity column from the audit log.
 * catalog.manage: Bearbeiten (drawer), Archivieren / Wiederherstellen (reason; an archived part is not offered to new mods), Zusammenführen
 * (⚿, reason). A merged part only says where it went.
 */
type Activity = { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null };
const props = defineProps<{
    product: ProductDetail;
    activity?: Activity[];
    canManage: boolean;
    categories?: CategoryOption[];
    brandChoices?: { value: number; label: string }[];
    mergeCandidates?: { value: string; label: string; mods: number }[];
}>();

const { can } = usePermissions();
const state = usePageState();
const p = computed(() => props.product);
const manage = computed(() => props.canManage && can('catalog.manage') && !p.value.merged);
const categoryLabel = computed(() => props.categories?.find((c) => c.key === p.value.category)?.label ?? p.value.category);

const tab = ref('overview');
const tabs = computed<TabItem[]>(() => [{ value: 'overview', label: trans('catalog.products.record.overview') }]);
const crumbs = computed(() => [{ label: trans('shell.groups.catalog') }, { label: trans('catalog.products.title'), href: productsUrl() }]);
const activity = computed<TimelineEntry[]>(() => (props.activity ?? []).map((a) => ({ id: a.id, occurred_at: a.occurred_at, label: actionLabel(a.action), actor: actorName(a), reason: a.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=product&filter[target_id]=${p.value.id}` : undefined));

const factsLocale = ref<'de' | 'en'>('de');
const localeModel = computed({ get: () => factsLocale.value, set: (v: string) => (factsLocale.value = v === 'en' ? 'en' : 'de') });
const localeOptions = computed(() => [
    { value: 'de', label: trans('catalog.products.facts.de') },
    { value: 'en', label: trans('catalog.products.facts.en') },
]);
const facts = computed(() => attributePairs(p.value.attributes, factsLocale.value));
const enMissing = computed(() => factsLocale.value === 'en' && facts.value.length === 0 && attributePairs(p.value.attributes, 'de').length > 0);
const safeLink = (url: string | null): string | null => (url && /^https:\/\//.test(url) ? url : null);

// ---- actions ------------------------------------------------------------------------------------------------------------
const qa = qaDialog();
const drawer = ref(manage.value && qa === 'edit');
const mergeOpen = ref(manage.value && qa === 'merge');
const stateDialog = ref(manage.value && (qa === 'archive' || qa === 'restore'));
const archived = computed(() => p.value.status === 'archived');
const write = useCatalogWrite();
function setArchived(reason: string | null): void {
    write.run('post', productWriteUrl(p.value.id, archived.value ? 'restore' : 'archive'), { reason }, { onSuccess: () => (stateDialog.value = false) });
}
</script>

<template>
    <Head :title="p.name" />
    <div data-testid="ADM-57-record" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.products.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-57-record.error" @retry="router.reload()" />
        <RecordLayout
            v-else
            v-model:tab="tab"
            :title="p.name"
            :crumbs="crumbs"
            :status="productPill(p)"
            :tabs="tabs"
            :tabs-label="trans('catalog.products.record.tabs')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            :loading-actions="3"
            loading-meta="line"
            test-id="ADM-57-record"
        >
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-57-record.meta">
                    <span class="text-ink">{{ p.brand.name }}</span>
                    <span aria-hidden="true">·</span><span>{{ categoryLabel }}</span>
                    <template v-if="p.line"><span aria-hidden="true">·</span><span>{{ p.line }}</span></template>
                    <span aria-hidden="true">·</span><span>{{ trans('catalog.products.record.created', { date: formatDate(p.created_at) }) }}</span>
                </p>
            </template>
            <template #actions>
                <template v-if="manage">
                    <Button size="sm" variant="secondary" :icon="PhPencilSimple" data-testid="ADM-57-record.edit" @click="drawer = true">{{ trans('catalog.actions.edit') }}</Button>
                    <Button size="sm" variant="secondary" :icon="PhArrowsMerge" data-testid="ADM-57-record.merge" @click="mergeOpen = true">{{ trans('catalog.actions.merge') }}</Button>
                    <Button size="sm" :variant="archived ? 'secondary' : 'destructive'" :icon="archived ? PhArrowCounterClockwise : PhArchive" data-testid="ADM-57-record.archive" @click="stateDialog = true">
                        {{ trans(archived ? 'catalog.products.actions.restore' : 'catalog.products.actions.archive') }}
                    </Button>
                </template>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24">
                    <MergedNotice v-if="p.merged && p.merged_into" :name="p.merged_into_name ?? p.merged_into" :href="productHref(p.merged_into)" test-id="ADM-57-record.merged" />
                    <p v-else-if="!canManage" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-57-record.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('catalog.products.view_only') }}</p>

                    <dl class="grid grid-cols-1 gap-x-24 gap-y-12 tablet:grid-cols-3" data-testid="ADM-57-record.facts-key">
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('catalog.products.record.mods') }}</dt>
                            <dd class="font-numeral text-hero-numeral-s text-ink tabular-nums">{{ formatNumber(p.mods) }}</dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('catalog.products.fields.url') }}</dt>
                            <dd class="min-w-0 text-admin-base">
                                <a v-if="safeLink(p.url)" :href="safeLink(p.url) ?? undefined" target="_blank" rel="noopener noreferrer" :class="[focusRing, 'inline-flex min-h-32 max-w-full items-center gap-4 rounded-xs text-ink hover:underline']">
                                    <span class="truncate">{{ p.url }}</span><PhArrowSquareOut :size="16" class="shrink-0" aria-hidden="true" />
                                </a>
                                <span v-else class="text-ink-3">{{ trans('catalog.products.record.none') }}</span>
                            </dd>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('catalog.products.fields.affiliate_url') }}</dt>
                            <dd class="flex min-w-0 flex-col gap-4 text-admin-base">
                                <a v-if="safeLink(p.affiliate_url)" :href="safeLink(p.affiliate_url) ?? undefined" target="_blank" rel="noopener noreferrer sponsored" :class="[focusRing, 'inline-flex min-h-32 max-w-full items-center gap-4 rounded-xs text-ink hover:underline']">
                                    <span class="truncate">{{ p.affiliate_url }}</span><PhArrowSquareOut :size="16" class="shrink-0" aria-hidden="true" />
                                </a>
                                <span v-else class="text-ink-3">{{ trans('catalog.products.record.none') }}</span>
                                <span v-if="p.has_affiliate" class="text-caption text-ink-3">{{ trans('catalog.products.record.affiliate_note') }}</span>
                            </dd>
                        </div>
                    </dl>

                    <section class="flex flex-col gap-12 border-t border-line-subtle pt-20" aria-labelledby="adm57-facts">
                        <div class="flex flex-wrap items-center justify-between gap-12">
                            <h2 id="adm57-facts" class="text-admin-base-strong text-ink">{{ trans('catalog.products.facts.title') }}</h2>
                            <SegmentedControl v-model="localeModel" :options="localeOptions" :label="trans('catalog.products.facts.language')" data-testid="ADM-57-record.facts-locale" />
                        </div>
                        <dl v-if="facts.length > 0" class="flex flex-col" data-testid="ADM-57-record.facts">
                            <div v-for="fact in facts" :key="fact.label" class="flex min-h-40 items-center gap-16 border-t border-line-subtle first:border-t-0">
                                <dt class="w-200 shrink-0 text-admin-base text-ink-2">{{ fact.label }}</dt>
                                <dd class="min-w-0 text-admin-base text-ink tabular-nums">{{ fact.value }}</dd>
                            </div>
                        </dl>
                        <p v-else class="text-admin-base text-ink-3" data-testid="ADM-57-record.no-facts">{{ trans(enMissing ? 'catalog.products.facts.en_missing' : 'catalog.products.facts.none') }}</p>
                    </section>

                    <section class="flex flex-col gap-8 border-t border-line-subtle pt-20">
                        <h2 class="text-admin-base-strong text-ink">{{ trans('catalog.products.record.aliases') }}</h2>
                        <ul v-if="p.aliases.length > 0" class="flex flex-wrap gap-8">
                            <li v-for="alias in p.aliases" :key="alias"><Badge tone="neutral">{{ alias }}</Badge></li>
                        </ul>
                        <p v-else class="text-admin-base text-ink-3">{{ trans('catalog.products.record.no_aliases') }}</p>
                    </section>
                </div>
            </template>
        </RecordLayout>

        <template v-if="manage">
            <ProductDrawer v-model:open="drawer" :product="p" :categories="categories ?? []" :brand-choices="brandChoices" test-id="ADM-57-record.drawer" />
            <ProductMergeDialog v-model:open="mergeOpen" :product="p" :candidates="mergeCandidates" test-id="ADM-57-record.merge-dialog" />
            <ConfirmDialog
                v-model:open="stateDialog"
                :title="trans(archived ? 'catalog.products.restore_dialog.title' : 'catalog.products.archive_dialog.title', { name: p.name })"
                :body="trans(archived ? 'catalog.products.restore_dialog.body' : 'catalog.products.archive_dialog.body')"
                :confirm-label="trans(archived ? 'catalog.products.actions.restore' : 'catalog.products.actions.archive')"
                :tone="archived ? 'neutral' : 'danger'"
                reason
                :processing="write.processing.value"
                :error="write.error.value"
                :test-id="`ADM-57-record.${archived ? 'restore' : 'archive'}-dialog`"
                @confirm="setArchived"
            />
        </template>
    </div>
</template>
