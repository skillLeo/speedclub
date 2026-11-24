<script setup lang="ts">
import { PhArrowDown, PhArrowUp, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick } from 'vue';
import { Button, Field, IconButton, Input, Select, type SelectOption } from '../../../Components/ui';
import { formatNumber } from '../../../lib/format';
import type { Variant } from '../shared';

/**
 * The one chip row of a product (contract §1 `variants`): its label kind (Größe · Farbe · Ausführung) and up to 24 chips, each a label
 * and an optional Shopify variant id (digits; the buy button then goes straight to that variant in the shop's cart). Chip ids are
 * the server's and stay with the chip, so a member's choice survives an edit; a new chip gets its id on save.
 */
const props = defineProps<{ kinds: SelectOption[]; max: number; disabled: boolean; showShopifyIds: boolean; errorAt: (field: string) => string | null }>();
const variants = defineModel<Variant[]>({ required: true });
const kind = defineModel<string>('kind', { required: true });

const full = computed(() => variants.value.length >= props.max);
async function add(): Promise<void> {
    if (full.value) return;
    variants.value = [...variants.value, { id: null, label: '', shopify_variant_id: null }];
    await nextTick();
    document.querySelector<HTMLInputElement>(`[data-variant-label="${variants.value.length - 1}"]`)?.focus();
}
function remove(index: number): void {
    variants.value = variants.value.filter((_, i) => i !== index);
}
function move(index: number, by: -1 | 1): void {
    const to = index + by;
    if (to < 0 || to >= variants.value.length) return;
    const next = [...variants.value];
    [next[index], next[to]] = [next[to]!, next[index]!];
    variants.value = next;
}
function setLabel(index: number, value: string): void {
    variants.value = variants.value.map((v, i) => (i === index ? { ...v, label: value } : v));
}
function setShopifyId(index: number, value: string): void {
    const id = value.trim();
    variants.value = variants.value.map((v, i) => (i === index ? { ...v, shopify_variant_id: id === '' ? null : id } : v));
}
const name = (index: number): string => variants.value[index]?.label.trim() || trans('shop.variants.unnamed', { n: formatNumber(index + 1) });
</script>

<template>
    <div class="flex flex-col gap-12" data-testid="ADM-66R.variants">
        <div class="w-200">
            <Field :label="trans('shop.variants.kind')" :error="errorAt('variant_kind')">
                <Select v-model="kind" :options="kinds" :disabled="disabled" data-testid="ADM-66R.variant-kind" />
            </Field>
        </div>
        <p v-if="errorAt('variants')" class="text-admin-base text-danger" role="alert">{{ errorAt('variants') }}</p>
        <ol v-if="variants.length > 0" class="flex flex-col gap-8" :aria-label="trans('shop.variants.list')">
            <li v-for="(variant, index) in variants" :key="variant.id ?? `new-${index}`" class="flex flex-wrap items-start gap-8" data-testid="ADM-66R.variant">
                <div class="min-w-160 grow basis-200">
                    <Field :label="trans('shop.variants.label', { n: formatNumber(index + 1) })" :error="errorAt(`variants.${index}.label`)" required>
                        <Input :model-value="variant.label" size="sm" maxlength="40" :disabled="disabled" :placeholder="trans('shop.variants.label_placeholder')" :data-variant-label="index" data-testid="ADM-66R.variant.label" @update:model-value="(v) => setLabel(index, v)" />
                    </Field>
                </div>
                <div v-if="showShopifyIds" class="min-w-160 grow basis-160">
                    <Field :label="trans('shop.variants.shopify_id')" :error="errorAt(`variants.${index}.shopify_variant_id`)" optional>
                        <Input :model-value="variant.shopify_variant_id ?? ''" size="sm" maxlength="20" inputmode="numeric" tnum :disabled="disabled" data-testid="ADM-66R.variant.shopify-id" @update:model-value="(v) => setShopifyId(index, v)" />
                    </Field>
                </div>
                <span v-if="!disabled" class="mt-24 flex shrink-0 gap-4">
                    <IconButton :icon="PhArrowUp" size="sm" :label="trans('shop.reorder.earlier', { name: name(index) })" :disabled="index === 0" @click="move(index, -1)" />
                    <IconButton :icon="PhArrowDown" size="sm" :label="trans('shop.reorder.later', { name: name(index) })" :disabled="index === variants.length - 1" @click="move(index, 1)" />
                    <IconButton :icon="PhTrash" size="sm" class="hover:text-danger" :label="trans('shop.variants.remove', { name: name(index) })" data-testid="ADM-66R.variant.remove" @click="remove(index)" />
                </span>
            </li>
        </ol>
        <p v-else class="text-admin-base text-ink-3">{{ trans('shop.variants.none') }}</p>
        <div v-if="!disabled" class="flex flex-wrap items-center gap-12">
            <Button size="sm" variant="secondary" :icon="PhPlus" :disabled="full" data-testid="ADM-66R.variant.add" @click="add">{{ trans('shop.variants.add') }}</Button>
            <span class="text-caption text-ink-3 tabular-nums">{{ trans('shop.variants.count', { count: formatNumber(variants.length), max: formatNumber(max) }) }}</span>
        </div>
    </div>
</template>
