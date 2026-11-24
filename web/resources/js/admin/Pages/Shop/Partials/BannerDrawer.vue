<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhCrosshair, PhImage, PhUploadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Button, ConfirmDialog, Drawer, Field, Input, RadioGroup, Select, type SelectOption } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatNumber } from '../../../lib/format';
import { ACCEPT, bannerStoreUrl, bannerUrl, clampUnit, focalStep, imageSize, type BannerRow, type Option } from '../shared';

/**
 * ADM-67 banner editor (contract §5, §5.3): the photo (JPEG/PNG/WebP, ≥ 1600 px wide, ratio 4:5 … 21:9, not cropped: the app crops
 * the 16:9 hero around the focal point), Titel, Untertitel, the link (a product or a category), the alt text. A new banner starts
 * inactive. Closing with unsaved changes asks first.
 */
const props = defineProps<{
    banner: BannerRow | null;
    products: (Option & { visible: boolean })[];
    categories: Option[];
    limits: { min_width: number; max_upload_kb: number };
}>();
const open = defineModel<boolean>('open', { default: false });

const MIN_RATIO = 4 / 5;
const MAX_RATIO = 21 / 9;

interface FormState {
    title: string;
    subtitle: string;
    link_kind: 'product' | 'category';
    product_id: string | undefined;
    category: string | undefined;
    alt: string;
    focal_x: number;
    focal_y: number;
}
function fromProps(): FormState {
    const b = props.banner;
    return {
        title: b?.title ?? '',
        subtitle: b?.subtitle ?? '',
        link_kind: b?.link.kind ?? 'category',
        product_id: b?.link.product?.id ?? undefined,
        category: b?.link.category ?? props.categories[0]?.value,
        alt: b?.image.alt ?? '',
        focal_x: b?.image.focal_x ?? 0.5,
        focal_y: b?.image.focal_y ?? 0.5,
    };
}
const form = reactive<FormState>(fromProps());
const baseline = ref(JSON.stringify(form));
const file = ref<File | null>(null);
const localUrl = ref<string | null>(null);
const localSize = ref<{ width: number; height: number } | null>(null);
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const guardOpen = ref(false);

function reset(): void {
    Object.assign(form, fromProps());
    baseline.value = JSON.stringify(form);
    setFile(null);
    errors.value = {};
}
watch(open, (value) => {
    if (value) reset();
});
watch(() => props.banner, () => open.value && reset());
onBeforeUnmount(() => setFile(null));

const dirty = computed(() => file.value !== null || JSON.stringify(form) !== baseline.value);
const creating = computed(() => props.banner === null);

function setFile(next: File | null): void {
    if (localUrl.value) URL.revokeObjectURL(localUrl.value);
    file.value = next;
    localUrl.value = next ? URL.createObjectURL(next) : null;
    localSize.value = null;
}
const input = ref<HTMLInputElement | null>(null);
async function picked(event: Event): Promise<void> {
    const chosen = (event.target as HTMLInputElement).files?.[0] ?? null;
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([key]) => key !== 'file'));
    if (chosen === null) return;
    if (!ACCEPT.split(',').includes(chosen.type)) {
        errors.value = { ...errors.value, file: trans('shop.images.wrong_type') };
        return;
    }
    if (chosen.size > props.limits.max_upload_kb * 1024) {
        errors.value = { ...errors.value, file: trans('shop.images.too_large', { size: formatNumber(Math.round(props.limits.max_upload_kb / 1024)) }) };
        return;
    }
    const size = await imageSize(chosen);
    if (size !== null && size.width < props.limits.min_width) {
        errors.value = { ...errors.value, file: trans('shop.banners.too_narrow', { width: formatNumber(props.limits.min_width), actual: formatNumber(size.width) }) };
        return;
    }
    if (size !== null && (size.width / size.height < MIN_RATIO || size.width / size.height > MAX_RATIO)) {
        errors.value = { ...errors.value, file: trans('shop.banners.ratio') };
        return;
    }
    setFile(chosen);
    localSize.value = size;
    form.focal_x = 0.5;
    form.focal_y = 0.5;
}

const photo = computed(() => {
    if (localUrl.value) return { url: localUrl.value, width: localSize.value?.width ?? 1600, height: localSize.value?.height ?? 900 };
    const image = props.banner?.image;
    return image?.url ? { url: image.url, width: image.width, height: image.height } : null;
});
function pointAt(event: MouseEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    form.focal_x = clampUnit((event.clientX - box.left) / box.width);
    form.focal_y = clampUnit((event.clientY - box.top) / box.height);
}
function focalKey(event: KeyboardEvent): void {
    const move = focalStep(event);
    if (move === null) return;
    event.preventDefault();
    form.focal_x = clampUnit(form.focal_x + move[0]);
    form.focal_y = clampUnit(form.focal_y + move[1]);
}
const percent = (value: number): string => formatNumber(Math.round(value * 100));

const linkOptions = computed(() => [
    { value: 'category', label: trans('shop.banners.link.category'), hint: trans('shop.banners.link.category_hint') },
    { value: 'product', label: trans('shop.banners.link.product'), hint: trans('shop.banners.link.product_hint') },
]);
const linkModel = computed({ get: () => form.link_kind, set: (value: string | undefined) => (form.link_kind = value === 'product' ? 'product' : 'category') });
const productOptions = computed<SelectOption[]>(() =>
    props.products.map((p) => ({ value: p.value, label: p.visible ? p.label : trans('shop.banners.product_hidden', { title: p.label }) })),
);
const chosenHidden = computed(() => form.link_kind === 'product' && props.products.some((p) => p.value === form.product_id && !p.visible));
const errorAt = (field: string): string | null => errors.value[field] ?? null;

function save(): void {
    const local: Record<string, string> = {};
    if (creating.value && file.value === null) local.file = trans('shop.banners.file_required');
    if (form.title.trim().length < 2) local.title = trans('shop.banners.title_required');
    if (form.link_kind === 'product' && !form.product_id) local.product_id = trans('shop.banners.product_required');
    if (Object.keys(local).length > 0) {
        errors.value = local;
        return;
    }
    const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const data: Record<string, unknown> = {
        title: form.title.trim(),
        subtitle: text(form.subtitle),
        link_kind: form.link_kind,
        product_id: form.link_kind === 'product' ? form.product_id : null,
        category: form.link_kind === 'category' ? form.category : null,
        alt: text(form.alt),
        focal_x: form.focal_x,
        focal_y: form.focal_y,
    };
    const options = {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (saving.value = true),
        onFinish: () => (saving.value = false),
        onSuccess: () => {
            baseline.value = JSON.stringify(form);
            setFile(null);
            open.value = false;
        },
        onError: (bag: Record<string, string>) => (errors.value = bag),
    };
    if (file.value !== null) {
        // Multipart: PHP reads files only from POST, so an edit spoofs PATCH (Laravel's _method).
        const url = creating.value ? bannerStoreUrl() : bannerUrl('update', props.banner!.id);
        router.post(url, { ...data, ...(creating.value ? {} : { _method: 'patch' }), file: file.value } as never, { ...options, forceFormData: true });
    } else if (props.banner !== null) {
        router.patch(bannerUrl('update', props.banner.id), data as never, options);
    }
}

/** Reka asks to close (Escape, outside, the X): with changes, the discard guard first. */
function requestOpen(value: boolean): void {
    if (!value && dirty.value && !saving.value) {
        guardOpen.value = true;
        return;
    }
    open.value = value;
}
function discard(): void {
    guardOpen.value = false;
    reset();
    open.value = false;
}
const serverError = computed(() => {
    const known = ['file', 'title', 'subtitle', 'link_kind', 'product_id', 'category', 'alt', 'focal_x', 'focal_y'];
    const other = Object.entries(errors.value).find(([key]) => !known.includes(key));
    return other ? other[1] : null;
});
</script>

<template>
    <Drawer
        :open="open"
        :title="banner ? trans('shop.banners.edit_title', { title: banner.title }) : trans('shop.banners.new_title')"
        :description="trans('shop.banners.drawer_description')"
        size="lg"
        :dismissible="!saving"
        test-id="ADM-67.drawer"
        @update:open="requestOpen"
    >
        <form id="adm67-form" class="flex flex-col gap-20" novalidate data-testid="ADM-67.form" @submit.prevent="save">
            <section class="flex flex-col gap-12" aria-labelledby="adm67-photo">
                <h3 id="adm67-photo" class="text-admin-base-strong text-ink">{{ trans('shop.banners.photo') }}</h3>
                <div v-if="photo" class="flex flex-wrap items-start gap-16">
                    <div class="min-w-240 flex-1 basis-320">
                        <div
                            :class="[focusRing, 'relative cursor-crosshair overflow-hidden rounded-xs bg-raised']"
                            role="slider"
                            tabindex="0"
                            :aria-label="trans('shop.banners.focal_label')"
                            :aria-valuetext="trans('shop.images.focal_value', { x: percent(form.focal_x), y: percent(form.focal_y) })"
                            data-testid="ADM-67.focal"
                            @click="pointAt"
                            @keydown="focalKey"
                        >
                            <img :src="photo.url" alt="" :width="photo.width" :height="photo.height" class="block h-auto w-full select-none" draggable="false" />
                            <span
                                class="pointer-events-none absolute flex size-32 -translate-x-16 -translate-y-16 items-center justify-center rounded-full border-2 border-on-photo bg-scrim text-on-photo outline-1 outline-on-photo-chip"
                                :style="{ left: `${form.focal_x * 100}%`, top: `${form.focal_y * 100}%` }"
                                aria-hidden="true"
                            >
                                <PhCrosshair :size="20" />
                            </span>
                        </div>
                        <p class="mt-8 text-caption text-ink-3">{{ trans('shop.banners.focal_hint') }}</p>
                    </div>
                    <figure class="flex w-240 shrink-0 flex-col gap-4">
                        <span class="block aspect-16/9 overflow-hidden rounded-xs bg-raised" data-testid="ADM-67.crop">
                            <img :src="photo.url" alt="" class="block size-full object-cover" :style="{ objectPosition: `${form.focal_x * 100}% ${form.focal_y * 100}%` }" />
                        </span>
                        <figcaption class="text-caption text-ink-3">{{ trans('shop.banners.crop') }}</figcaption>
                    </figure>
                </div>
                <div v-else class="flex min-h-120 flex-col items-center justify-center gap-8 rounded-xs border border-dashed border-line px-16 py-24 text-center">
                    <PhImage :size="24" class="text-ink-3" aria-hidden="true" />
                    <p class="text-admin-base text-ink-2">{{ trans('shop.banners.no_photo') }}</p>
                </div>
                <Field
                    id="adm67-file"
                    :label="trans(creating ? 'shop.banners.file' : 'shop.banners.file_replace')"
                    :hint="trans('shop.banners.rules', { width: formatNumber(limits.min_width), size: formatNumber(Math.round(limits.max_upload_kb / 1024)) })"
                    :error="errorAt('file')"
                    :required="creating"
                    :optional="!creating"
                >
                    <input id="adm67-file" ref="input" type="file" tabindex="-1" :accept="ACCEPT" class="sr-only" data-testid="ADM-67.file" @change="picked" />
                </Field>
                <div class="-mt-4 flex flex-wrap items-center gap-12">
                    <Button size="sm" variant="secondary" :icon="PhUploadSimple" :disabled="saving" data-testid="ADM-67.choose" @click="input?.click()">{{ trans(photo ? 'shop.banners.choose_other' : 'shop.banners.choose') }}</Button>
                    <span class="min-w-0 truncate text-admin-base text-ink-2">{{ file ? file.name : trans('shop.banners.no_file') }}</span>
                </div>
                <Field :label="trans('shop.banners.alt')" :hint="trans('shop.images.alt_hint')" :error="errorAt('alt')" optional>
                    <Input v-model="form.alt" maxlength="200" data-testid="ADM-67.alt" />
                </Field>
            </section>

            <section class="flex flex-col gap-12 border-t border-line-subtle pt-20" aria-labelledby="adm67-texts">
                <h3 id="adm67-texts" class="text-admin-base-strong text-ink">{{ trans('shop.banners.texts') }}</h3>
                <Field :label="trans('shop.banners.title_field')" :error="errorAt('title')" required>
                    <Input v-model="form.title" maxlength="80" data-testid="ADM-67.title" />
                </Field>
                <Field :label="trans('shop.banners.subtitle')" :error="errorAt('subtitle')" optional>
                    <Input v-model="form.subtitle" maxlength="140" data-testid="ADM-67.subtitle" />
                </Field>
            </section>

            <section class="flex flex-col gap-12 border-t border-line-subtle pt-20" aria-labelledby="adm67-link">
                <h3 id="adm67-link" class="text-admin-base-strong text-ink">{{ trans('shop.banners.link.title') }}</h3>
                <RadioGroup v-model="linkModel" :options="linkOptions" :legend="trans('shop.banners.link.legend')" hide-legend data-testid="ADM-67.link-kind" />
                <p v-if="errorAt('link_kind')" class="text-admin-base text-danger" role="alert">{{ errorAt('link_kind') }}</p>
                <div v-if="form.link_kind === 'product'" class="w-full max-w-480">
                    <Field :label="trans('shop.banners.link.product')" :error="errorAt('product_id')" required>
                        <Select v-model="form.product_id" :options="productOptions" :placeholder="trans('shop.banners.link.product_placeholder')" data-testid="ADM-67.product" />
                    </Field>
                    <p v-if="products.length === 0" class="mt-4 text-caption text-ink-3">{{ trans('shop.banners.link.no_products') }}</p>
                    <p v-else-if="chosenHidden" class="mt-4 text-caption text-warning">{{ trans('shop.banners.link.hidden_warning') }}</p>
                </div>
                <div v-else class="w-240">
                    <Field :label="trans('shop.banners.link.category')" :error="errorAt('category')" required>
                        <Select v-model="form.category" :options="categories" data-testid="ADM-67.category" />
                    </Field>
                </div>
            </section>
            <p v-if="serverError" class="text-admin-base text-danger" role="alert" data-testid="ADM-67.server-error">{{ serverError }}</p>
        </form>
        <template #footer>
            <p v-if="creating" class="mr-auto text-caption text-ink-3">{{ trans('shop.banners.starts_inactive') }}</p>
            <Button variant="ghost" :disabled="saving" data-dialog-cancel @click="requestOpen(false)">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" form="adm67-form" variant="primary" :loading="saving" :disabled="!creating && !dirty" data-testid="ADM-67.save">{{ trans(creating ? 'shop.banners.create' : 'shop.banners.save') }}</Button>
        </template>
    </Drawer>
    <ConfirmDialog
        v-model:open="guardOpen"
        :title="trans('shop.form.discard_title')"
        :body="trans('shop.form.discard_body')"
        :confirm-label="trans('shop.form.discard')"
        tone="neutral"
        test-id="ADM-67.discard"
        @confirm="discard"
    />
</template>
