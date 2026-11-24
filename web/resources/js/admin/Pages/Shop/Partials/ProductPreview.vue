<script setup lang="ts">
import { PhArrowSquareOut, PhImage } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { SegmentedControl } from '../../../Components/ui';
import { formatNumber } from '../../../lib/format';
import { srcset, variantSrc, type Preview } from '../shared';

/**
 * The member's view of this product, drawn from `preview` = the exact member payload (ShopProductCardResource / ShopProductResource,
 * contract §5.2), so it cannot drift from the app: the shop tile (SHOP-01) and the product page (SHOP-02, first photo, price incl.
 * MwSt., the chip row, the buy button the server built). Photos sit on the dark stage in every theme (09 §4.5, ADR-421 b), so the
 * frame is Carbon. It shows the saved state; the page says when the form has unsaved changes.
 */
const props = defineProps<{ preview: Preview | null; dirty: boolean; hasImages: boolean }>();

const view = ref<'card' | 'detail'>('detail');
const views = computed(() => [
    { value: 'detail', label: trans('shop.preview.detail') },
    { value: 'card', label: trans('shop.preview.card') },
]);
const viewModel = computed({ get: () => view.value, set: (value: string) => (view.value = value === 'card' ? 'card' : 'detail') });

const detail = computed(() => props.preview?.detail ?? null);
const card = computed(() => props.preview?.card ?? null);
const buyLabel = computed(() => {
    const buy = detail.value?.buy;
    if (!buy) return '';
    if (!buy.available) return buy.message ?? trans('shop.preview.soon');
    return buy.kind === 'designer' ? trans('shop.preview.buy_designer') : trans('shop.preview.buy_external');
});
const buyNote = computed(() => {
    const d = detail.value;
    if (!d || !d.buy.available) return null;
    if (d.buy.kind === 'designer') return trans('shop.preview.designer_note');
    return d.store.host ? trans('shop.preview.external_note', { host: d.store.host }) : trans('shop.preview.external_note_no_host');
});
const paragraphs = computed(() => (detail.value?.description ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== ''));
</script>

<template>
    <section class="flex flex-col gap-12" aria-labelledby="adm66-preview" data-testid="ADM-66R.preview">
        <div class="flex flex-wrap items-center justify-between gap-8">
            <h2 id="adm66-preview" class="text-headline text-ink">{{ trans('shop.preview.title') }}</h2>
            <SegmentedControl v-if="preview" v-model="viewModel" :options="views" :label="trans('shop.preview.view')" data-testid="ADM-66R.preview.view" />
        </div>
        <p class="text-caption text-ink-3" :class="dirty ? 'text-warning' : ''" role="status">{{ dirty ? trans('shop.preview.unsaved') : trans('shop.preview.saved_state') }}</p>

        <div v-if="!preview" class="flex flex-col items-center gap-8 rounded-sm border border-dashed border-line px-16 py-24 text-center" data-testid="ADM-66R.preview.none">
            <PhImage :size="24" class="text-ink-3" aria-hidden="true" />
            <p class="max-w-240 text-admin-base text-ink-2">{{ hasImages ? trans('shop.preview.unavailable') : trans('shop.preview.needs_photo') }}</p>
        </div>

        <!-- The app's stage: Carbon tokens whatever the admin theme, max phone width. Not interactive (a picture of the app). -->
        <div v-else data-theme="carbon" class="mx-auto w-full max-w-360 overflow-hidden rounded-sm border border-line-subtle bg-canvas text-ink" :aria-label="trans('shop.preview.frame')" role="group" data-testid="ADM-66R.preview.frame">
            <template v-if="view === 'detail' && detail">
                <div class="relative aspect-4/5 bg-raised">
                    <img v-if="detail.images[0]" :src="variantSrc(detail.images[0], 640) ?? undefined" :srcset="srcset(detail.images[0])" sizes="360px" :alt="detail.images[0].alt ?? ''" class="block size-full object-cover" :style="{ objectPosition: `${detail.images[0].focal_x * 100}% ${detail.images[0].focal_y * 100}%` }" />
                    <span v-if="detail.is_sample" class="absolute left-12 top-12 rounded-xs bg-scrim px-8 py-2 text-caption text-on-photo">{{ trans('shop.sample') }}</span>
                    <span v-if="detail.images.length > 1" class="absolute bottom-12 right-12 rounded-xs bg-scrim px-8 py-2 text-caption text-on-photo tabular-nums">{{ trans('shop.preview.photos', { current: formatNumber(1), total: formatNumber(detail.images.length) }) }}</span>
                </div>
                <div class="flex flex-col gap-16 px-20 py-20">
                    <div class="flex flex-col gap-4">
                        <p class="text-caption text-ink-3">{{ detail.category.label }}</p>
                        <p class="text-title-2 text-ink">{{ detail.title }}</p>
                        <p class="flex flex-wrap items-baseline gap-8">
                            <span class="text-headline text-ink tabular-nums">{{ detail.price.formatted }}</span>
                            <span class="text-caption text-ink-2">{{ trans(detail.store.shipping_url ? 'shop.preview.vat_shipping' : 'shop.preview.vat') }}</span>
                        </p>
                    </div>
                    <div v-if="detail.variants.length > 0" class="flex flex-col gap-8">
                        <p class="text-caption text-ink-2">{{ detail.variant_kind.label }}</p>
                        <ul class="flex flex-wrap gap-8">
                            <li v-for="(variant, index) in detail.variants" :key="variant.id" class="flex h-32 items-center rounded-full border px-12 text-admin-base" :class="index === 0 ? 'border-inverse bg-inverse text-ink-inverse' : 'border-line text-ink'">{{ variant.label }}</li>
                        </ul>
                    </div>
                    <div class="flex flex-col gap-8">
                        <span class="flex h-48 items-center justify-center gap-8 rounded-sm text-admin-base-strong" :class="detail.buy.available ? 'bg-inverse text-ink-inverse' : 'bg-raised text-ink-3'" data-testid="ADM-66R.preview.buy">
                            {{ buyLabel }}<PhArrowSquareOut v-if="detail.buy.kind === 'external'" :size="16" aria-hidden="true" />
                        </span>
                        <p v-if="buyNote" class="text-caption text-ink-3">{{ buyNote }}</p>
                    </div>
                    <div v-if="paragraphs.length > 0" class="flex flex-col gap-8 border-t border-line-subtle pt-16">
                        <p class="text-admin-base-strong text-ink">{{ trans('shop.preview.description') }}</p>
                        <p v-for="(paragraph, i) in paragraphs" :key="i" class="whitespace-pre-line text-admin-base text-ink-2">{{ paragraph }}</p>
                    </div>
                </div>
            </template>
            <!-- One tile at its real width: half of a phone's 2-column grid. -->
            <div v-else-if="card" class="grid grid-cols-2 gap-2 py-16">
                <figure class="flex flex-col gap-8">
                    <span class="relative block aspect-4/5 bg-raised">
                        <img v-if="card.image" :src="variantSrc(card.image, 320) ?? undefined" :alt="card.image.alt ?? ''" class="block size-full object-cover" :style="{ objectPosition: `${card.image.focal_x * 100}% ${card.image.focal_y * 100}%` }" />
                        <span v-if="card.is_sample" class="absolute left-8 top-8 rounded-xs bg-scrim px-4 py-2 text-caption text-on-photo">{{ trans('shop.sample') }}</span>
                    </span>
                    <figcaption class="flex flex-col gap-2 px-8">
                        <span class="line-clamp-2 text-admin-base-strong text-ink">{{ card.title }}</span>
                        <span class="text-admin-base text-ink tabular-nums">{{ card.price.formatted }}</span>
                        <span class="text-caption text-ink-3">{{ trans('shop.preview.vat') }}</span>
                    </figcaption>
                </figure>
            </div>
        </div>
    </section>
</template>
