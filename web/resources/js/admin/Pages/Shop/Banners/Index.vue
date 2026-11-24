<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhPause, PhPencilSimple, PhPlay, PhPlus, PhTrash, PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import PageHeader from '../../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, EmptyQueue, Skeleton, StatusPill } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { usePageState } from '../../../composables/pageState';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDate, formatDateTime } from '../../../lib/format';
import { usePermissions } from '../../../lib/permissions';
import BannerDrawer from '../Partials/BannerDrawer.vue';
import { bannerActionUrl, bannerUrl, productHref, productsIndexHref, type BannerRow, type Option } from '../shared';

/**
 * ADM-67 Shop-Banner (10 §3, m5.5-contract §5.3): the SHOP-01 hero. At most one banner is active (activating one switches the other
 * off, server side in one transaction); a banner whose product is hidden or deleted does not show, and the row says why. New ⇢ inactive.
 * Löschen removes the photo files and needs the recent password (⚿). The page needs shop.manage (route middleware).
 */
const props = defineProps<{
    banners: BannerRow[];
    products: (Option & { visible: boolean })[];
    categories: Option[];
    limits: { min_width: number; max_upload_kb: number };
    canManage: boolean;
}>();

const { can } = usePermissions();
const mayManage = computed(() => props.canManage && can('shop.manage'));
const state = usePageState(() => (props.banners.length === 0 ? 'empty' : 'ready'));
const active = computed(() => props.banners.find((b) => b.active) ?? null);
const categoryLabel = (key: string | null): string => props.categories.find((c) => c.value === key)?.label ?? key ?? '–';

function linkText(banner: BannerRow): string {
    if (banner.link.kind === 'category') return trans('shop.banners.links_to_category', { category: categoryLabel(banner.link.category) });
    return banner.link.product ? trans('shop.banners.links_to_product', { title: banner.link.product.title }) : trans('shop.banners.links_to_gone');
}
function linkProblem(banner: BannerRow): string | null {
    if (banner.link_ok) return null;
    if (banner.link.kind === 'product' && banner.link.product === null) return trans('shop.banners.problem_gone');
    return trans('shop.banners.problem_hidden');
}

// ---- drawer -----------------------------------------------------------------------------------------------------------------
const drawerOpen = ref(false);
const editing = ref<BannerRow | null>(null);
function openNew(): void {
    editing.value = null;
    drawerOpen.value = true;
}
function openEdit(banner: BannerRow): void {
    editing.value = banner;
    drawerOpen.value = true;
}

// ---- activate / deactivate / delete ------------------------------------------------------------------------------------------
const action = useAdminAction();
const target = ref<BannerRow | null>(null);
const activateOpen = ref(false);
const deleteOpen = ref(false);
function askActivate(banner: BannerRow): void {
    action.reset();
    target.value = banner;
    activateOpen.value = true;
}
function toggleActive(): void {
    const banner = target.value;
    if (banner === null) return;
    action.run('post', bannerActionUrl(banner.active ? 'deactivate' : 'activate', banner.id), {}, { onSuccess: () => (activateOpen.value = false) });
}
const activateBody = computed(() => {
    const banner = target.value;
    if (banner === null) return '';
    if (banner.active) return trans('shop.banners.deactivate_body');
    const other = active.value;
    return other ? trans('shop.banners.activate_replaces', { title: other.title }) : trans('shop.banners.activate_body');
});
function askDelete(banner: BannerRow): void {
    action.reset();
    target.value = banner;
    deleteOpen.value = true;
}
function destroy(): void {
    const banner = target.value;
    if (banner === null) return;
    action.run('delete', bannerUrl('destroy', banner.id), {}, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}

// QA cells: ?dialog=new · edit · activate · delete.
{
    const dialog = qaDialog();
    const first = props.banners[0];
    const inactive = props.banners.find((b) => !b.active);
    if (mayManage.value) {
        if (dialog === 'new') openNew();
        else if (dialog === 'edit' && first) openEdit(first);
        else if (dialog === 'activate' && (inactive ?? first)) askActivate((inactive ?? first)!);
        else if (dialog === 'delete' && first) askDelete(first);
    }
}
</script>

<template>
    <Head :title="trans('shop.banners.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-67" :data-qa-state="state">
        <PageHeader :title="trans('shop.banners.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('shop.banners.intro')">
            <template v-if="mayManage" #actions>
                <Button size="sm" variant="ghost" :href="productsIndexHref()" data-testid="ADM-67.products">{{ trans('shop.banners.to_products') }}</Button>
                <Button v-if="banners.length > 0 && state !== 'empty'" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-67.new" @click="openNew">{{ trans('shop.banners.new') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('shop.banners.load_error')" :body="trans('ui.state.error_body')" test-id="ADM-67.error" @retry="router.reload()" />
        <ul v-else-if="state === 'loading'" class="flex flex-col overflow-hidden rounded-sm border border-line" aria-busy="true" data-testid="ADM-67.loading">
            <li v-for="n in 3" :key="n" class="flex items-center gap-16 border-line-subtle px-16 py-12" :class="n > 1 ? 'border-t' : ''" aria-hidden="true">
                <Skeleton class="aspect-16/9 w-160 shrink-0 rounded-xs" />
                <div class="flex min-w-0 flex-1 flex-col gap-8">
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton shape="text" class="w-320" />
                </div>
                <Skeleton class="h-32 w-200" />
            </li>
        </ul>
        <!-- Empty: the hero the app shows today is none at all, so the one action is to make the first banner. -->
        <EmptyQueue v-else-if="state === 'empty'" variant="first" :title="trans('shop.banners.empty_title')" :body="trans('shop.banners.empty_body')" data-testid="ADM-67.empty">
            <Button v-if="mayManage" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-67.empty.new" @click="openNew">{{ trans('shop.banners.new') }}</Button>
        </EmptyQueue>
        <template v-else>
            <p class="text-admin-base text-ink-2" role="status" data-testid="ADM-67.summary">
                {{ active ? (active.link_ok ? trans('shop.banners.summary_active', { title: active.title }) : trans('shop.banners.summary_blocked', { title: active.title })) : trans('shop.banners.summary_none') }}
            </p>
            <ul class="flex flex-col overflow-hidden rounded-sm border border-line" :aria-label="trans('shop.banners.list')" data-testid="ADM-67.list">
                <li v-for="(banner, index) in banners" :key="banner.id" class="flex flex-wrap items-center gap-16 bg-surface px-16 py-12" :class="index > 0 ? 'border-t border-line-subtle' : ''" data-testid="ADM-67.row">
                    <span class="block aspect-16/9 w-160 shrink-0 overflow-hidden rounded-xs bg-raised">
                        <img v-if="banner.image.url" :src="banner.image.url" :alt="banner.image.alt ?? ''" :width="banner.image.width" :height="banner.image.height" class="block size-full object-cover" :style="{ objectPosition: `${banner.image.focal_x * 100}% ${banner.image.focal_y * 100}%` }" loading="lazy" />
                    </span>
                    <div class="flex min-w-240 flex-1 flex-col gap-4">
                        <p class="flex flex-wrap items-center gap-8">
                            <span class="text-admin-base-strong text-ink">{{ banner.title }}</span>
                            <StatusPill :tone="banner.active ? (banner.link_ok ? 'success' : 'warning') : 'neutral'" :label="trans(banner.active ? 'shop.banners.active' : 'shop.banners.inactive')" data-testid="ADM-67.row.status" />
                            <Badge v-if="banner.is_sample">{{ trans('shop.sample') }}</Badge>
                        </p>
                        <p v-if="banner.subtitle" class="text-admin-base text-ink-2">{{ banner.subtitle }}</p>
                        <p class="text-caption text-ink-3">
                            <Link v-if="banner.link.kind === 'product' && banner.link.product" :href="productHref(banner.link.product.id)" :class="[focusRing, 'rounded-xs hover:text-ink hover:underline']">{{ linkText(banner) }}</Link>
                            <template v-else>{{ linkText(banner) }}</template>
                            <span aria-hidden="true"> · </span>
                            <time :datetime="banner.updated_at ?? undefined" :title="formatDateTime(banner.updated_at)" class="tabular-nums">{{ formatDate(banner.updated_at) }}</time>
                            <template v-if="banner.updated_by"> · {{ banner.updated_by }}</template>
                        </p>
                        <p v-if="linkProblem(banner)" class="flex items-start gap-4 text-caption text-warning" data-testid="ADM-67.row.problem">
                            <PhWarningCircle :size="16" class="shrink-0" aria-hidden="true" />{{ linkProblem(banner) }}
                        </p>
                    </div>
                    <span v-if="mayManage" class="flex shrink-0 flex-wrap items-center gap-4">
                        <Button size="sm" variant="secondary" :icon="banner.active ? PhPause : PhPlay" :data-testid="banner.active ? 'ADM-67.deactivate' : 'ADM-67.activate'" :aria-label="trans(banner.active ? 'shop.banners.deactivate_named' : 'shop.banners.activate_named', { title: banner.title })" @click="askActivate(banner)">
                            {{ trans(banner.active ? 'shop.banners.deactivate' : 'shop.banners.activate') }}
                        </Button>
                        <Button size="sm" variant="ghost" :icon="PhPencilSimple" :aria-label="trans('shop.banners.edit_named', { title: banner.title })" data-testid="ADM-67.edit" @click="openEdit(banner)">{{ trans('shop.banners.edit') }}</Button>
                        <Button size="sm" variant="ghost" :icon="PhTrash" class="hover:text-danger" :aria-label="trans('shop.banners.delete_named', { title: banner.title })" data-testid="ADM-67.delete" @click="askDelete(banner)">{{ trans('shop.banners.delete') }}</Button>
                    </span>
                </li>
            </ul>
        </template>

        <BannerDrawer v-model:open="drawerOpen" :banner="editing" :products="products" :categories="categories" :limits="limits" />
        <ConfirmDialog
            v-model:open="activateOpen"
            :title="target ? trans(target.active ? 'shop.banners.deactivate_title' : 'shop.banners.activate_title', { title: target.title }) : ''"
            :body="activateBody"
            :confirm-label="trans(target?.active ? 'shop.banners.deactivate' : 'shop.banners.activate')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-67.activate-dialog"
            @confirm="toggleActive"
        />
        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('shop.banners.delete_title', { title: target?.title ?? '' })"
            :body="trans('shop.banners.delete_body')"
            :confirm-label="trans('shop.banners.delete')"
            typed
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-67.delete-dialog"
            @confirm="destroy"
        />
    </div>
</template>
