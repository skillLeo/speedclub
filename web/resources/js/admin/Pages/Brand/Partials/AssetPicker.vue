<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhCheck, PhImage, PhUploadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { Button, Dialog, EmptyQueue, Field } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatDate, formatNumber } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import type { AssetKind, BrandAsset } from './brand';

/**
 * Choose an uploaded brand image for a slot, or upload a new one (re-encoded, EXIF stripped, WebP variants; the kind's minimum size and
 * the size limit are named before the upload). A new upload is chosen at once. Nothing is live until the branding draft is published.
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{
    kind: AssetKind;
    slotLabel: string;
    assets: BrandAsset[];
    selected: string | null;
    minimum: { width: number; height: number };
    maxUploadKb: number;
    failed?: boolean;
}>();
const emit = defineEmits<{ choose: [id: string] }>();

const own = computed(() => props.assets.filter((asset) => asset.kind === props.kind));
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const error = ref<string | null>(null);
watch(open, (value) => {
    if (value) {
        file.value = null;
        error.value = null;
    }
});

function pick(event: Event): void {
    const target = event.target as HTMLInputElement;
    file.value = target.files?.[0] ?? null;
    error.value = null;
}

function upload(): void {
    if (file.value === null) {
        error.value = trans('brand.picker.choose_file');
        return;
    }
    const known = new Set(props.assets.map((asset) => asset.id));
    router.post(
        routeOr('admin.brand.assets.store', '/admin/brand/assets'),
        { kind: props.kind, file: file.value },
        {
            forceFormData: true,
            preserveScroll: true,
            preserveState: true,
            onStart: () => (uploading.value = true),
            onFinish: () => (uploading.value = false),
            onError: (errors) => (error.value = errors.file ?? errors.kind ?? Object.values(errors)[0] ?? trans('ui.state.server_error')),
            onSuccess: (page) => {
                const assets = (page.props as unknown as { assets: BrandAsset[] }).assets;
                const fresh = assets.find((asset) => asset.kind === props.kind && !known.has(asset.id));
                if (fresh) {
                    emit('choose', fresh.id);
                    open.value = false;
                }
            },
        },
    );
}

const serverError = computed(() => (props.failed === true ? trans('ui.state.server_error') : error.value));
const logo = computed(() => props.kind !== 'hero' && props.kind !== 'og');
const ground = computed(() => (props.kind === 'wordmark_white' ? 'bg-black' : props.kind === 'wordmark_black' ? 'bg-white' : 'bg-raised'));
</script>

<template>
    <Dialog v-model:open="open" :title="trans('brand.picker.title', { slot: slotLabel })" :description="trans('brand.picker.description')" size="lg" test-id="ADM-28.picker" :dismissible="!uploading">
        <div class="flex flex-col gap-20">
            <EmptyQueue v-if="own.length === 0" variant="first" compact :icon="PhImage" :title="trans('brand.picker.empty_title')" :body="trans('brand.picker.empty_body')" />
            <ul v-else class="grid grid-cols-3 gap-12" :aria-label="trans('brand.picker.list')">
                <li v-for="asset in own" :key="asset.id">
                    <button
                        type="button"
                        :class="[focusRing, 'flex w-full flex-col gap-4 rounded-sm border p-4 text-left', asset.id === selected ? 'border-inverse' : 'border-line hover:border-line-strong']"
                        :aria-pressed="asset.id === selected"
                        :data-testid="`ADM-28.picker.asset`"
                        @click="emit('choose', asset.id), (open = false)"
                    >
                        <span class="relative block aspect-video overflow-hidden rounded-xs" :class="ground">
                            <img v-if="asset.thumb" :src="asset.thumb" alt="" :width="asset.width" :height="asset.height" class="block size-full" :class="logo ? 'object-contain p-8' : 'object-cover'" loading="lazy" />
                            <span v-if="asset.id === selected" class="absolute right-4 top-4 flex size-24 items-center justify-center rounded-full bg-inverse text-ink-inverse"><PhCheck :size="16" aria-hidden="true" /></span>
                        </span>
                        <span class="px-4 text-helper tabular-nums text-ink-2">{{ trans('brand.size', { width: formatNumber(asset.width), height: formatNumber(asset.height) }) }}</span>
                        <span class="px-4 pb-4 text-helper text-ink-3">{{ formatDate(asset.uploaded_at) }}<template v-if="asset.uploaded_by"> · {{ asset.uploaded_by }}</template></span>
                        <span class="sr-only">{{ asset.id === selected ? trans('brand.picker.chosen') : trans('brand.picker.choose') }}</span>
                    </button>
                </li>
            </ul>

            <form id="adm28-upload" class="flex flex-col gap-8 border-t border-line-subtle pt-16" novalidate @submit.prevent="upload">
                <Field id="adm28-file" :label="trans('brand.picker.upload')" :hint="trans('brand.picker.rules', { width: formatNumber(minimum.width), height: formatNumber(minimum.height), size: formatNumber(Math.round(maxUploadKb / 1024)) })" :error="serverError">
                    <input id="adm28-file" ref="input" type="file" tabindex="-1" accept="image/jpeg,image/png,image/webp" class="sr-only" data-testid="ADM-28.picker.file" @change="pick" />
                </Field>
                <div class="flex flex-wrap items-center gap-12">
                    <Button size="sm" variant="secondary" :icon="PhImage" @click="input?.click()">{{ trans('brand.picker.select_file') }}</Button>
                    <span class="min-w-0 truncate text-supporting text-ink-2">{{ file ? file.name : trans('brand.picker.no_file') }}</span>
                </div>
            </form>
        </div>
        <template #footer>
            <Button variant="ghost" :disabled="uploading" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" form="adm28-upload" variant="primary" :icon="PhUploadSimple" :loading="uploading" :disabled="file === null" data-testid="ADM-28.picker.submit">{{ trans('brand.picker.submit') }}</Button>
        </template>
    </Dialog>
</template>
