<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhCrosshair, PhImage, PhPencilSimple, PhTrash, PhUploadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Badge, Button, ConfirmDialog, Dialog, Field, IconButton, Input } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { qaDialog } from '../../../composables/qaDialog';
import { formatNumber } from '../../../lib/format';
import { ACCEPT, clampUnit, cropWindow, firstMessage, focalStep, imageSize, imagesReorderUrl, imagesStoreUrl, imageUrl, type Limits, type ProductImage } from '../shared';
import ReorderList from './ReorderList.vue';

/**
 * ADM-66 product photos (m5.5-contract §5): upload (JPEG/PNG/WebP, ≤ 15 MB, the source must hold a 1080 × 1350 crop, at most 8), the
 * order (the first photo is the shop tile), and per photo the alt text and the focal point the server crops the 4:5 frame around (from
 * the private original, so moving it needs no new upload). Every write is its own audited request; none needs the password.
 */
const props = defineProps<{ productId: string; images: ProductImage[]; limits: Limits; visible: boolean; readOnly: boolean }>();

// ---- order ------------------------------------------------------------------------------------------------------------------
const order = ref<ProductImage[]>([...props.images]);
watch(
    () => props.images,
    (images) => (order.value = [...images]),
);
const orderDirty = computed(() => order.value.map((i) => i.id).join() !== props.images.map((i) => i.id).join());
const savingOrder = ref(false);
const orderError = ref<string | null>(null);
function saveOrder(): void {
    router.post(
        imagesReorderUrl(props.productId),
        { ids: order.value.map((i) => i.id) },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                savingOrder.value = true;
                orderError.value = null;
            },
            onFinish: () => (savingOrder.value = false),
            onError: (errors) => (orderError.value = firstMessage(errors) ?? trans('ui.state.server_error')),
        },
    );
}
const imageLabel = (image: ProductImage): string => trans('shop.images.photo_n', { n: formatNumber(props.images.findIndex((i) => i.id === image.id) + 1) });

// ---- upload -----------------------------------------------------------------------------------------------------------------
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const progress = ref<number | null>(null);
const uploadError = ref<string | null>(null);
const dragOver = ref(false);
const full = computed(() => props.images.length >= props.limits.max_images);
const rules = computed(() =>
    trans('shop.images.rules', {
        width: formatNumber(props.limits.min_crop.width),
        height: formatNumber(props.limits.min_crop.height),
        size: formatNumber(Math.round(props.limits.max_upload_kb / 1024)),
        max: formatNumber(props.limits.max_images),
    }),
);

async function upload(file: File | undefined): Promise<void> {
    if (file === undefined || props.readOnly || full.value) return;
    uploadError.value = null;
    // Cheap checks first (the server checks again, by content).
    if (!ACCEPT.split(',').includes(file.type)) {
        uploadError.value = trans('shop.images.wrong_type');
        return;
    }
    if (file.size > props.limits.max_upload_kb * 1024) {
        uploadError.value = trans('shop.images.too_large', { size: formatNumber(Math.round(props.limits.max_upload_kb / 1024)) });
        return;
    }
    const size = await imageSize(file);
    if (size !== null && (size.width < props.limits.min_crop.width || size.height < props.limits.min_crop.height)) {
        uploadError.value = trans('shop.images.too_small', {
            width: formatNumber(props.limits.min_crop.width),
            height: formatNumber(props.limits.min_crop.height),
            actual_width: formatNumber(size.width),
            actual_height: formatNumber(size.height),
        });
        return;
    }
    router.post(
        imagesStoreUrl(props.productId),
        { file },
        {
            forceFormData: true,
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                uploading.value = true;
                progress.value = 0;
            },
            onProgress: (event) => (progress.value = event?.percentage ?? null),
            onFinish: () => {
                uploading.value = false;
                progress.value = null;
                if (input.value) input.value.value = '';
            },
            onError: (errors) => (uploadError.value = errors.file ?? firstMessage(errors) ?? trans('ui.state.server_error')),
        },
    );
}
function picked(event: Event): void {
    void upload((event.target as HTMLInputElement).files?.[0]);
}
function dropped(event: DragEvent): void {
    dragOver.value = false;
    void upload(event.dataTransfer?.files?.[0]);
}

// ---- edit one photo (alt, focal point) -------------------------------------------------------------------------------------
const editing = ref<ProductImage | null>(null);
const editOpen = ref(false);
const edit = ref({ alt: '', focal_x: 0.5, focal_y: 0.5 });
const saving = ref(false);
const editError = ref<string | null>(null);
function openEdit(image: ProductImage): void {
    editing.value = image;
    edit.value = { alt: image.alt ?? '', focal_x: image.focal_x, focal_y: image.focal_y };
    editError.value = null;
    editOpen.value = true;
}
const focalChanged = computed(() => editing.value !== null && (edit.value.focal_x !== editing.value.focal_x || edit.value.focal_y !== editing.value.focal_y));
const editDirty = computed(() => editing.value !== null && (focalChanged.value || edit.value.alt.trim() !== (editing.value.alt ?? '')));
const frame = computed(() => {
    const image = editing.value;
    if (image === null || image.original_width === null || image.original_height === null) return null;
    return { ratio: `${image.original_width} / ${image.original_height}`, tall: image.original_height > image.original_width, crop: cropWindow(image.original_width, image.original_height, edit.value.focal_x, edit.value.focal_y) };
});
function pointAt(event: MouseEvent): void {
    if (props.readOnly || frame.value?.crop.full) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    edit.value.focal_x = clampUnit((event.clientX - box.left) / box.width);
    edit.value.focal_y = clampUnit((event.clientY - box.top) / box.height);
}
function focalKey(event: KeyboardEvent): void {
    if (props.readOnly || frame.value?.crop.full) return;
    const move = focalStep(event);
    if (move === null) return;
    event.preventDefault();
    edit.value.focal_x = clampUnit(edit.value.focal_x + move[0]);
    edit.value.focal_y = clampUnit(edit.value.focal_y + move[1]);
}
const percent = (value: number): string => formatNumber(Math.round(value * 100));
function saveEdit(): void {
    const image = editing.value;
    if (image === null) return;
    const alt = edit.value.alt.trim();
    router.patch(
        imageUrl('update', props.productId, image.id),
        { alt: alt === '' ? null : alt, ...(focalChanged.value ? { focal_x: edit.value.focal_x, focal_y: edit.value.focal_y } : {}) },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                saving.value = true;
                editError.value = null;
            },
            onFinish: () => (saving.value = false),
            onSuccess: () => (editOpen.value = false),
            onError: (errors) => (editError.value = firstMessage(errors) ?? trans('ui.state.server_error')),
        },
    );
}

// ---- remove -----------------------------------------------------------------------------------------------------------------
const removing = ref<ProductImage | null>(null);
const removeOpen = ref(false);
const removeBusy = ref(false);
const removeError = ref<string | null>(null);
function askRemove(image: ProductImage): void {
    removing.value = image;
    removeError.value = null;
    removeOpen.value = true;
}
function remove(): void {
    const image = removing.value;
    if (image === null) return;
    router.delete(imageUrl('destroy', props.productId, image.id), {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (removeBusy.value = true),
        onFinish: () => (removeBusy.value = false),
        onSuccess: () => (removeOpen.value = false),
        // 422 when a visible product would lose its last photo.
        onError: (errors) => (removeError.value = firstMessage(errors) ?? trans('ui.state.server_error')),
    });
}
const lastOfVisible = computed(() => props.visible && props.images.length === 1);

// QA cells: ?dialog=photo opens the first photo's editor.
if (qaDialog() === 'photo' && props.images[0] && !props.readOnly) openEdit(props.images[0]);
</script>

<template>
    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm66-photos" data-testid="ADM-66R.photos">
        <div class="flex flex-wrap items-start justify-between gap-12">
            <div class="flex flex-col gap-4">
                <h2 id="adm66-photos" class="text-headline text-ink">
                    {{ trans('shop.images.title') }}
                    <span class="text-admin-base text-ink-3 tabular-nums">{{ trans('shop.images.count', { count: formatNumber(images.length), max: formatNumber(limits.max_images) }) }}</span>
                </h2>
                <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.images.intro') }}</p>
            </div>
            <Button v-if="orderDirty && !readOnly" size="sm" variant="secondary" :loading="savingOrder" data-testid="ADM-66R.photos.save-order" @click="saveOrder">{{ trans('shop.images.save_order') }}</Button>
        </div>

        <StateBlock v-if="orderError" kind="error" :title="trans('shop.images.order_failed')" :body="orderError" :retryable="false" test-id="ADM-66R.photos.order-error" />

        <ReorderList v-if="order.length > 0" v-model="order" layout="grid" :label="imageLabel" :list-label="trans('shop.images.list')" :disabled="readOnly || savingOrder" test-id="ADM-66R.photos.list">
            <template #default="{ item, index }">
                <figure class="flex flex-col gap-8">
                    <span class="relative block aspect-4/5 overflow-hidden rounded-xs bg-raised">
                        <img :src="item.url" :alt="item.alt ?? ''" :width="item.width" :height="item.height" class="block size-full object-cover" loading="lazy" draggable="false" />
                        <Badge v-if="index === 0" class="absolute left-8 top-8">{{ trans('shop.images.cover') }}</Badge>
                    </span>
                    <figcaption class="line-clamp-2 min-h-32 text-caption" :class="item.alt ? 'text-ink-2' : 'text-warning'" :title="item.alt ?? undefined">{{ item.alt ?? trans('shop.images.no_alt') }}</figcaption>
                </figure>
            </template>
            <template v-if="!readOnly" #actions="{ item }">
                <IconButton :icon="PhPencilSimple" size="sm" :label="trans('shop.images.edit_named', { name: imageLabel(item) })" data-testid="ADM-66R.photos.edit" @click="openEdit(item)" />
                <IconButton :icon="PhTrash" size="sm" class="hover:text-danger" :label="trans('shop.images.remove_named', { name: imageLabel(item) })" data-testid="ADM-66R.photos.remove" @click="askRemove(item)" />
            </template>
        </ReorderList>

        <div
            v-if="!readOnly"
            class="flex flex-wrap items-center gap-12 rounded-sm border border-dashed px-16 py-16"
            :class="dragOver ? 'border-line-strong bg-selected' : 'border-line'"
            data-testid="ADM-66R.photos.dropzone"
            @dragover.prevent="dragOver = !full"
            @dragleave="dragOver = false"
            @drop.prevent="dropped"
        >
            <PhImage :size="24" class="shrink-0 text-ink-3" aria-hidden="true" />
            <div class="flex min-w-0 flex-1 flex-col gap-2">
                <p class="text-admin-base text-ink">{{ full ? trans('shop.images.full') : images.length === 0 ? trans('shop.images.empty') : trans('shop.images.drop') }}</p>
                <p class="text-caption text-ink-3 tabular-nums">{{ rules }}</p>
            </div>
            <Field id="adm66-file" :label="trans('shop.images.file')" hide-label :error="null">
                <input id="adm66-file" ref="input" type="file" tabindex="-1" :accept="ACCEPT" class="sr-only" data-testid="ADM-66R.photos.file" @change="picked" />
            </Field>
            <Button size="sm" variant="secondary" :icon="PhUploadSimple" :loading="uploading" :disabled="full" data-testid="ADM-66R.photos.upload" @click="input?.click()">
                {{ uploading && progress !== null ? trans('shop.images.uploading', { percent: formatNumber(Math.round(progress)) }) : trans('shop.images.upload') }}
            </Button>
        </div>
        <p v-if="uploadError" class="text-admin-base text-danger" role="alert" data-testid="ADM-66R.photos.error">{{ uploadError }}</p>

        <Dialog
            v-model:open="editOpen"
            :title="editing ? trans('shop.images.edit_title', { name: imageLabel(editing) }) : trans('shop.images.title')"
            :description="trans('shop.images.edit_description')"
            size="lg"
            :dismissible="!saving"
            test-id="ADM-66R.photo-dialog"
        >
            <form v-if="editing" id="adm66-photo-form" class="flex flex-col gap-20" novalidate @submit.prevent="saveEdit">
                <div class="flex flex-wrap items-start gap-16">
                    <div v-if="frame" class="flex min-w-240 flex-1 basis-320 flex-col gap-8">
                        <p class="text-admin-base-strong text-ink">{{ trans('shop.images.frame') }}</p>
                        <!-- The uncropped original as a frame (the original itself stays private); the inner box is the 4:5 crop. -->
                        <div
                            :class="[focusRing, 'relative w-full overflow-hidden rounded-xs border border-line bg-raised', frame.crop.full ? '' : 'cursor-crosshair', frame.tall ? 'max-w-240' : '']"
                            :style="{ aspectRatio: frame.ratio }"
                            role="slider"
                            :tabindex="frame.crop.full ? -1 : 0"
                            :aria-label="trans('shop.images.focal_label')"
                            :aria-valuetext="trans('shop.images.focal_value', { x: percent(edit.focal_x), y: percent(edit.focal_y) })"
                            :aria-disabled="frame.crop.full"
                            data-testid="ADM-66R.photo-dialog.focal"
                            @click="pointAt"
                            @keydown="focalKey"
                        >
                            <span
                                class="pointer-events-none absolute overflow-hidden border-2"
                                :class="focalChanged ? 'border-dashed border-ink' : 'border-ink'"
                                :style="{ left: `${frame.crop.left}%`, top: `${frame.crop.top}%`, width: `${frame.crop.width}%`, height: `${frame.crop.height}%` }"
                                aria-hidden="true"
                            >
                                <img v-if="!focalChanged" :src="editing.url" alt="" class="block size-full object-cover" draggable="false" />
                            </span>
                            <span
                                class="pointer-events-none absolute flex size-32 -translate-x-16 -translate-y-16 items-center justify-center rounded-full border-2 border-on-photo bg-scrim text-on-photo outline-1 outline-on-photo-chip"
                                :style="{ left: `${edit.focal_x * 100}%`, top: `${edit.focal_y * 100}%` }"
                                aria-hidden="true"
                            >
                                <PhCrosshair :size="20" />
                            </span>
                        </div>
                        <p class="text-caption text-ink-3 tabular-nums">
                            {{ frame.crop.full ? trans('shop.images.already_45') : trans('shop.images.focal_hint') }}
                            {{ trans('shop.images.original_size', { width: formatNumber(editing.original_width), height: formatNumber(editing.original_height) }) }}
                        </p>
                    </div>
                    <figure class="flex w-160 shrink-0 flex-col gap-4">
                        <span class="block aspect-4/5 overflow-hidden rounded-xs bg-raised" data-testid="ADM-66R.photo-dialog.crop">
                            <img :src="editing.url" :alt="editing.alt ?? ''" :width="editing.width" :height="editing.height" class="block size-full object-cover" />
                        </span>
                        <figcaption class="text-caption text-ink-3">{{ focalChanged ? trans('shop.images.crop_pending') : trans('shop.images.crop_now') }}</figcaption>
                    </figure>
                </div>
                <Field :label="trans('shop.images.alt')" :hint="trans('shop.images.alt_hint')" optional>
                    <Input v-model="edit.alt" maxlength="200" data-testid="ADM-66R.photo-dialog.alt" />
                </Field>
                <p v-if="editError" class="text-admin-base text-danger" role="alert">{{ editError }}</p>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="saving" data-dialog-cancel @click="editOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm66-photo-form" variant="primary" :loading="saving" :disabled="!editDirty" data-testid="ADM-66R.photo-dialog.save">{{ trans('shop.images.save') }}</Button>
            </template>
        </Dialog>

        <ConfirmDialog
            v-model:open="removeOpen"
            :title="removing ? trans('shop.images.remove_title', { name: imageLabel(removing) }) : trans('shop.images.title')"
            :body="trans(lastOfVisible ? 'shop.images.remove_last_visible' : 'shop.images.remove_body')"
            :confirm-label="trans('shop.images.remove')"
            :processing="removeBusy"
            :error="removeError"
            test-id="ADM-66R.photo-remove"
            @confirm="remove"
        />
    </section>
</template>
