<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhFloppyDisk, PhInfo, PhTrash, PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import ActivityTimeline, { type TimelineEntry } from '../../../Components/record/ActivityTimeline.vue';
import PageHeader from '../../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, RadioGroup, Select, Skeleton, StatusPill, Switch, Textarea, type SelectOption } from '../../../Components/ui';
import { usePageState } from '../../../composables/pageState';
import { qaDialog } from '../../../composables/qaDialog';
import { actionLabel, actorName } from '../../../lib/audit';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { usePermissions } from '../../../lib/permissions';
import type { FeedEntry } from '../../Members/types';
import { useLeaveGuard } from '../../Content/Partials/configDraft';
import ProductImages from '../Partials/ProductImages.vue';
import ProductPreview from '../Partials/ProductPreview.vue';
import VariantsEditor from '../Partials/VariantsEditor.vue';
import {
    centsToInput,
    firstMessage,
    formatPrice,
    inputToCents,
    productActionUrl,
    productsIndexHref,
    productStoreUrl,
    productUrl,
    type Limits,
    type MissingItem,
    type Option,
    type Preview,
    type ProductRecord,
    type PurchaseMode,
    type StoreInfo,
    type Variant,
} from '../shared';

/**
 * ADM-66 product editor (10 §3, m5.5-contract §5.2): Titel, Adresse (slug), Kategorie, Beschreibung, Preis (gross cents incl. MwSt.,
 * EUR), the chip row, Kauf (Online-Shop with the product address on an allowed store host, or the Sticker-Designer), the photos (own
 * writes) and Sichtbarkeit (shown only when complete: the server answers 422 on `visible` and `product.missing` says what is missing
 * before). The preview is the member payload. A new product is created hidden and opens here; photos follow. A deleted product is
 * read-only with Wiederherstellen (30 days). Löschen needs the recent password (⚿). Every write is audited by the server.
 */
const props = defineProps<{
    product: ProductRecord | null;
    preview: Preview | null;
    activity: FeedEntry[];
    categories: Option[];
    variantKinds: Option[];
    purchaseModes: Option[];
    store: StoreInfo;
    limits: Limits;
    canManage: boolean;
}>();

const { can } = usePermissions();
const state = usePageState();
const creating = computed(() => props.product === null);
const trashed = computed(() => props.product?.deleted_at !== null && props.product?.deleted_at !== undefined);
const readOnly = computed(() => !(props.canManage && can('shop.manage')) || trashed.value);

// ---- form -------------------------------------------------------------------------------------------------------------------
interface FormState {
    title: string;
    slug: string;
    description: string;
    category: string;
    price: string;
    variant_kind: string;
    variants: Variant[];
    purchase_mode: PurchaseMode;
    shopify_url: string;
}
function fromProps(): FormState {
    const p = props.product;
    return {
        title: p?.title ?? '',
        slug: p?.slug ?? '',
        description: p?.description ?? '',
        category: p?.category ?? props.categories[0]?.value ?? 'sticker',
        price: centsToInput(p?.price_cents),
        variant_kind: p?.variant_kind ?? props.variantKinds[0]?.value ?? 'size',
        variants: (p?.variants ?? []).map((v) => ({ ...v })),
        purchase_mode: p?.purchase_mode ?? 'shopify',
        shopify_url: p?.shopify_url ?? '',
    };
}
const form = reactive<FormState>(fromProps());
const baseline = ref(JSON.stringify(form));
const dirty = computed(() => !readOnly.value && JSON.stringify(form) !== baseline.value);
function resetForm(): void {
    Object.assign(form, fromProps());
    baseline.value = JSON.stringify(form);
}
// Review SF-1: every Inertia answer replaces the props, a 422 included, so the form follows the record only when another record
// arrives, or the stored one changed (a photo, restore, another tab) while nothing here is unsaved; a successful save resets in its
// own onSuccess. A refused save keeps the editor's input next to the server's messages.
watch(
    () => `${props.product?.id ?? ''}|${props.product?.updated_at ?? ''}`,
    (now, before) => {
        const sameRecord = now.split('|')[0] === before.split('|')[0];
        if (!sameRecord || !dirty.value) resetForm();
    },
);
const { guardOpen, leave, setGuard } = useLeaveGuard(dirty);

const categoryOptions = computed<SelectOption[]>(() => props.categories);
const kindOptions = computed<SelectOption[]>(() => props.variantKinds);
const modeOptions = computed(() =>
    props.purchaseModes.map((mode) => ({ value: mode.value, label: mode.label, hint: trans(`shop.form.mode_hint.${mode.value}`) })),
);
const modeModel = computed({ get: () => form.purchase_mode, set: (value: string | undefined) => (form.purchase_mode = value === 'sticker_designer' ? 'sticker_designer' : 'shopify') });
const designer = computed(() => form.purchase_mode === 'sticker_designer');

/** EUR only in M5.5 (contract §1, validation in:EUR). */
const currency = 'EUR';
const cents = computed(() => inputToCents(form.price));
const pricePreview = computed(() => (cents.value !== null && cents.value > 0 ? trans('shop.form.price_reads', { price: formatPrice(cents.value) }) : null));
const hosts = computed(() => [props.store.host, ...props.store.extra_hosts].filter((h): h is string => typeof h === 'string' && h !== ''));
const urlHint = computed(() => (hosts.value.length > 0 ? trans('shop.form.url_hint', { hosts: hosts.value.join(', ') }) : trans('shop.form.url_store_missing')));

// ---- save -------------------------------------------------------------------------------------------------------------------
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const errorAt = (field: string): string | null => errors.value[field] ?? null;
const hasErrors = computed(() => Object.keys(errors.value).length > 0);
// A field's message goes as soon as that field changes (its hint comes back), the others stay until the next save.
const ERROR_KEYS: Record<keyof FormState, string[]> = {
    title: ['title'],
    slug: ['slug'],
    description: ['description'],
    category: ['category'],
    price: ['price_cents', 'currency'],
    variant_kind: ['variant_kind'],
    variants: ['variants'],
    purchase_mode: ['purchase_mode', 'shopify_url'],
    shopify_url: ['shopify_url'],
};
for (const key of Object.keys(ERROR_KEYS) as (keyof FormState)[]) {
    watch(
        () => JSON.stringify(form[key]),
        () => {
            const prefixes = ERROR_KEYS[key];
            errors.value = Object.fromEntries(Object.entries(errors.value).filter(([field]) => !prefixes.some((p) => field === p || field.startsWith(`${p}.`))));
        },
    );
}

function payload(): Record<string, unknown> | null {
    const local: Record<string, string> = {};
    if (form.title.trim().length < 2) local.title = trans('shop.form.title_required');
    if (cents.value === null || cents.value < 1) local.price_cents = trans('shop.form.price_invalid');
    if (Object.keys(local).length > 0) {
        errors.value = local;
        return null;
    }
    const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const before = props.product;
    const url = text(form.shopify_url);
    return {
        title: form.title.trim(),
        // Empty on a new product: the server builds it from the title.
        ...(creating.value && text(form.slug) === null ? {} : { slug: text(form.slug) }),
        description: text(form.description),
        category: form.category,
        price_cents: cents.value,
        currency,
        variant_kind: form.variant_kind,
        variants: form.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), label: v.label.trim(), shopify_variant_id: v.shopify_variant_id })),
        purchase_mode: form.purchase_mode,
        // Sent only when changed: without a configured store the server refuses any address, also an unchanged one.
        ...(url !== (before?.shopify_url ?? null) ? { shopify_url: url } : {}),
    };
}
function save(): void {
    const data = payload();
    if (data === null) return;
    const url = creating.value ? productStoreUrl() : productUrl('update', props.product!.id);
    router.visit(url, {
        method: creating.value ? 'post' : 'patch',
        data: data as never,
        preserveScroll: true,
        preserveState: true,
        onStart: () => (saving.value = true),
        onFinish: () => (saving.value = false),
        // Inertia has the new props by now: take the stored values (the server normalises the slug, the address, the chip ids).
        onSuccess: () => {
            errors.value = {};
            resetForm();
        },
        onError: (bag) => (errors.value = bag),
    });
}
function discard(): void {
    resetForm();
    errors.value = {};
}

// ---- visibility ---------------------------------------------------------------------------------------------------------------
const visibilityBusy = ref(false);
const visibilityError = ref<string | null>(null);
const missing = computed<MissingItem[]>(() => props.product?.missing ?? []);
const missingText = computed(() => missing.value.map((item) => trans(`shop.visibility.missing.${item}`)).join(', '));
function setVisible(visible: boolean): void {
    const product = props.product;
    if (product === null) return;
    router.post(
        productActionUrl('visibility', product.id),
        { visible },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                visibilityBusy.value = true;
                visibilityError.value = null;
            },
            onFinish: () => (visibilityBusy.value = false),
            onError: (bag) => (visibilityError.value = bag.visible ?? firstMessage(bag) ?? trans('ui.state.server_error')),
        },
    );
}
const visibleModel = computed({ get: () => props.product?.visible ?? false, set: (value: boolean) => setVisible(value) });
const visibilityLocked = computed(() => readOnly.value || dirty.value || visibilityBusy.value || (!(props.product?.visible ?? false) && missing.value.length > 0));

// ---- delete ⚿ / restore -------------------------------------------------------------------------------------------------------
const remover = useAdminAction();
const { processing: deleteBusy, error: deleteError } = remover;
const deleteOpen = ref(false);
function askDelete(): void {
    remover.reset();
    deleteOpen.value = true;
}
function destroy(): void {
    if (props.product === null) return;
    remover.run('delete', productUrl('destroy', props.product.id), {}, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}
const restoring = ref(false);
const restoreError = ref<string | null>(null);
function restore(): void {
    if (props.product === null) return;
    router.post(productActionUrl('restore', props.product.id), {}, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => {
            restoring.value = true;
            restoreError.value = null;
        },
        onFinish: () => (restoring.value = false),
        onError: (bag) => (restoreError.value = firstMessage(bag) ?? trans('ui.state.server_error')),
    });
}
if (qaDialog() === 'delete' && props.product !== null && !readOnly.value) askDelete();

// ---- header ---------------------------------------------------------------------------------------------------------------------
const title = computed(() => props.product?.title ?? trans('shop.form.create_title'));
const statusPill = computed(() => {
    if (props.product === null) return null;
    if (trashed.value) return { tone: 'danger' as const, label: trans('shop.products.visibility.deleted') };
    return props.product.visible ? { tone: 'success' as const, label: trans('shop.products.visibility.visible') } : { tone: 'neutral' as const, label: trans('shop.products.visibility.hidden') };
});
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
</script>

<template>
    <Head :title="title" />
    <div class="flex flex-col gap-24" data-testid="ADM-66R" :data-qa-state="state">
        <PageHeader :title="title" :crumbs="[{ label: trans('shell.groups.brand_content') }, { label: trans('shop.products.title'), href: productsIndexHref() }]" :loading="state === 'loading'">
            <template v-if="statusPill" #badge>
                <StatusPill :tone="statusPill.tone" :label="statusPill.label" data-testid="ADM-66R.status" />
                <Badge v-if="product?.is_sample">{{ trans('shop.sample') }}</Badge>
            </template>
            <template v-if="product" #meta>
                <p class="flex min-h-20 flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums">
                    <span class="sc-key">{{ product.slug }}</span><span aria-hidden="true">·</span>
                    <span>{{ trans('shop.form.updated', { date: formatDateTime(product.updated_at) }) }}</span>
                </p>
            </template>
            <template v-if="product && canManage" #actions>
                <Button v-if="trashed" size="sm" variant="secondary" :icon="PhArrowCounterClockwise" :loading="restoring" data-testid="ADM-66R.restore" @click="restore">{{ trans('shop.products.actions.restore') }}</Button>
                <Button v-else size="sm" variant="destructive" :icon="PhTrash" data-testid="ADM-66R.delete" @click="askDelete">{{ trans('shop.products.actions.delete') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('shop.form.load_error')" :body="trans('ui.state.error_body')" test-id="ADM-66R.error" @retry="router.reload()" />
        <div v-else-if="state === 'loading'" class="flex flex-col gap-24 desktop:flex-row desktop:items-start" aria-busy="true" data-testid="ADM-66R.loading">
            <div class="flex min-w-0 flex-1 flex-col gap-16">
                <div v-for="height in ['h-320', 'h-160', 'h-200']" :key="height" :class="[height, 'flex flex-col gap-12 rounded-sm border border-line p-16']" aria-hidden="true">
                    <Skeleton shape="text" class="w-160" />
                    <Skeleton class="h-40 w-full rounded-sm" />
                    <Skeleton class="h-40 w-full rounded-sm" />
                </div>
            </div>
            <div class="flex shrink-0 flex-col gap-12 desktop:w-360" aria-hidden="true">
                <Skeleton shape="text" class="w-120" />
                <Skeleton class="aspect-4/5 w-full rounded-sm" />
            </div>
        </div>
        <div v-else class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <div class="flex min-w-0 flex-1 flex-col gap-16">
                <div v-if="trashed && product" class="flex items-start gap-8 rounded-sm border border-line bg-surface px-16 py-12" role="status" data-testid="ADM-66R.trashed">
                    <PhWarningCircle :size="20" class="shrink-0 text-warning" aria-hidden="true" />
                    <div class="flex flex-col gap-4">
                        <p class="text-admin-base-strong text-ink">{{ trans('shop.form.trashed_title', { date: formatDate(product.deleted_at) }) }}</p>
                        <p class="text-admin-base text-ink-2">{{ trans('shop.form.trashed_body', { date: formatDate(product.purge_at) }) }}</p>
                        <p v-if="restoreError" class="text-admin-base text-danger" role="alert">{{ restoreError }}</p>
                    </div>
                </div>
                <p v-if="!store.configured && !readOnly" class="flex items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-66R.store-missing">
                    <PhInfo :size="16" class="mt-2 shrink-0 text-info" aria-hidden="true" />{{ trans('shop.notices.store_missing') }}
                </p>

                <form id="adm66-form" class="flex flex-col gap-16" novalidate data-testid="ADM-66R.form" @submit.prevent="save">
                    <StateBlock v-if="hasErrors" kind="error" :title="trans('shop.form.error')" :retryable="false" test-id="ADM-66R.form-error" />

                    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-basics">
                        <h2 id="adm66-basics" class="text-headline text-ink">{{ trans('shop.form.basics') }}</h2>
                        <Field :label="trans('shop.form.title')" :hint="trans('shop.form.title_hint')" :error="errorAt('title')" required>
                            <Input v-model="form.title" :maxlength="limits.title_max" :disabled="readOnly" data-testid="ADM-66R.title" />
                        </Field>
                        <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                            <Field :label="trans('shop.form.slug')" :hint="trans(creating ? 'shop.form.slug_hint_new' : 'shop.form.slug_hint')" :error="errorAt('slug')" :optional="creating">
                                <Input v-model="form.slug" maxlength="140" autocomplete="off" spellcheck="false" :disabled="readOnly" data-testid="ADM-66R.slug" />
                            </Field>
                            <Field :label="trans('shop.form.category')" :error="errorAt('category')" required>
                                <Select v-model="form.category" :options="categoryOptions" :disabled="readOnly" data-testid="ADM-66R.category" />
                            </Field>
                        </div>
                        <Field :label="trans('shop.form.description')" :hint="trans('shop.form.description_hint')" :error="errorAt('description')" optional>
                            <Textarea v-model="form.description" :rows="6" :maxlength="limits.description_max" show-count :disabled="readOnly" data-testid="ADM-66R.description" />
                        </Field>
                    </section>

                    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-price">
                        <div class="flex flex-col gap-4">
                            <h2 id="adm66-price" class="text-headline text-ink">{{ trans('shop.form.price_title') }}</h2>
                            <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.form.price_intro') }}</p>
                        </div>
                        <div class="flex flex-wrap items-start gap-12">
                            <div class="w-200">
                                <Field :label="trans('shop.form.price')" :hint="pricePreview ?? trans('shop.form.price_hint')" :error="errorAt('price_cents')" required>
                                    <Input v-model="form.price" inputmode="decimal" maxlength="12" tnum :disabled="readOnly" :placeholder="trans('shop.form.price_placeholder')" data-testid="ADM-66R.price" />
                                </Field>
                            </div>
                            <dl class="flex flex-col gap-4 pt-4">
                                <dt class="text-admin-base-strong text-ink">{{ trans('shop.form.currency') }}</dt>
                                <dd class="flex h-40 items-center gap-8 text-admin-base text-ink-2"><span class="tabular-nums">{{ currency }}</span><span aria-hidden="true">·</span>{{ trans('shop.form.vat') }}</dd>
                            </dl>
                        </div>
                    </section>

                    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-variants">
                        <div class="flex flex-col gap-4">
                            <h2 id="adm66-variants" class="text-headline text-ink">{{ trans('shop.variants.title') }}</h2>
                            <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.variants.intro') }}</p>
                        </div>
                        <VariantsEditor v-model="form.variants" v-model:kind="form.variant_kind" :kinds="kindOptions" :max="limits.max_variants" :disabled="readOnly" :show-shopify-ids="!designer" :error-at="errorAt" />
                    </section>

                    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-buy">
                        <div class="flex flex-col gap-4">
                            <h2 id="adm66-buy" class="text-headline text-ink">{{ trans('shop.form.buy_title') }}</h2>
                            <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.form.buy_intro') }}</p>
                        </div>
                        <RadioGroup v-model="modeModel" :options="modeOptions" :legend="trans('shop.form.mode')" :disabled="readOnly" data-testid="ADM-66R.mode" />
                        <p v-if="errorAt('purchase_mode')" class="text-admin-base text-danger" role="alert">{{ errorAt('purchase_mode') }}</p>
                        <Field v-if="!designer" :label="trans('shop.form.url')" :hint="urlHint" :error="errorAt('shopify_url')" optional>
                            <Input
                                v-model="form.shopify_url"
                                type="url"
                                inputmode="url"
                                maxlength="500"
                                autocomplete="off"
                                spellcheck="false"
                                :disabled="readOnly || (!store.configured && form.shopify_url === '')"
                                :placeholder="store.host ? `https://${store.host}/products/…` : undefined"
                                data-testid="ADM-66R.url"
                            />
                        </Field>
                        <p v-if="!designer && form.shopify_url.trim() === '' && !product?.is_sample" class="text-caption text-ink-3">{{ trans('shop.form.url_empty') }}</p>
                    </section>

                    <div v-if="!readOnly" class="flex flex-wrap items-center gap-12">
                        <Button type="submit" variant="primary" :icon="PhFloppyDisk" :loading="saving" :disabled="!creating && !dirty" data-testid="ADM-66R.save">{{ trans(creating ? 'shop.form.create' : 'shop.form.save') }}</Button>
                        <Button v-if="dirty && !creating" variant="ghost" :disabled="saving" data-testid="ADM-66R.discard-changes" @click="discard">{{ trans('shop.form.discard_changes') }}</Button>
                        <span v-if="dirty" class="text-caption text-ink-3" role="status">{{ trans('shop.form.unsaved') }}</span>
                    </div>
                </form>

                <ProductImages v-if="product" :product-id="product.id" :images="product.images" :limits="limits" :visible="product.visible" :read-only="readOnly" />
                <section v-else class="flex flex-col gap-8 rounded-sm border border-dashed border-line p-16" aria-labelledby="adm66-photos-new" data-testid="ADM-66R.photos-later">
                    <h2 id="adm66-photos-new" class="text-headline text-ink">{{ trans('shop.images.title') }}</h2>
                    <p class="text-admin-base text-ink-2">{{ trans('shop.images.after_create') }}</p>
                </section>

                <section v-if="product && !trashed" class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-visibility" data-testid="ADM-66R.visibility">
                    <div class="flex flex-col gap-4">
                        <h2 id="adm66-visibility" class="text-headline text-ink">{{ trans('shop.visibility.title') }}</h2>
                        <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.visibility.intro') }}</p>
                    </div>
                    <Switch v-model="visibleModel" :label="trans(product.visible ? 'shop.visibility.on' : 'shop.visibility.off')" :disabled="visibilityLocked" data-testid="ADM-66R.visible" />
                    <p v-if="missing.length > 0" class="flex items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-66R.missing">
                        <PhWarningCircle :size="16" class="mt-2 shrink-0 text-warning" aria-hidden="true" />{{ trans('shop.visibility.missing_list', { items: missingText }) }}
                    </p>
                    <p v-else-if="dirty" class="text-caption text-ink-3">{{ trans('shop.visibility.save_first') }}</p>
                    <p v-if="visibilityError" class="text-admin-base text-danger" role="alert" data-testid="ADM-66R.visible-error">{{ visibilityError }}</p>
                </section>
            </div>

            <aside class="flex min-w-0 shrink-0 flex-col gap-24 desktop:sticky desktop:top-24 desktop:w-360" :aria-label="trans('shop.form.aside')">
                <ProductPreview :preview="preview" :dirty="dirty && !creating" :has-images="(product?.images.length ?? 0) > 0" />
                <ActivityTimeline v-if="product" :entries="activity" test-id="ADM-66R.activity" />
                <p v-if="product" class="text-caption text-ink-3 tabular-nums">{{ trans('shop.form.position', { position: formatNumber(product.sort) }) }}</p>
            </aside>
        </div>

        <ConfirmDialog
            v-if="product"
            v-model:open="deleteOpen"
            :title="trans('shop.products.delete.title', { title: product.title })"
            :body="trans('shop.products.delete.body')"
            :confirm-label="trans('shop.products.delete.confirm')"
            :processing="deleteBusy"
            :error="deleteError"
            test-id="ADM-66R.delete-dialog"
            @confirm="destroy"
        />
        <ConfirmDialog
            :open="guardOpen"
            :title="trans('shop.form.discard_title')"
            :body="trans('shop.form.discard_body')"
            :confirm-label="trans('shop.form.discard')"
            tone="neutral"
            test-id="ADM-66R.discard"
            @update:open="setGuard"
            @confirm="leave"
        />
    </div>
</template>
