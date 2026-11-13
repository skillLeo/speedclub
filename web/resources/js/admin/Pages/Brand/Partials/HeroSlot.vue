<script setup lang="ts">
import { PhCheckCircle, PhCrosshair, PhImage, PhWarningCircle } from '@phosphor-icons/vue';
import { getActiveLanguage, trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Button, Skeleton } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { isCancelled, requestJson } from '../../../lib/http';
import { routeOr } from '../../../lib/routes';
import { ratioText, type BrandAsset, type Contrast, type HeroSlotKey, type HeroValue } from './brand';

/**
 * One hero photo of ADM-28 (FS-1 welcome, WEB-03 landing, splash) with its focal point (BL-4): click or use the arrow keys on the photo
 * to move the point (stored as x/y 0–1); the app crops around it (the 9:16 frame shows how). The contrast verdict is measured by the
 * server at that point (MeasureHeroContrast, ADR-129/151/152: logo and text over the scrim at ≥ 4.5:1); a failing photo is refused by
 * the draft, so the verdict says so before saving.
 */
const props = defineProps<{
    slotKey: HeroSlotKey;
    value: HeroValue | null;
    asset: BrandAsset | null;
    readOnly: boolean;
    error: string | null;
    forced?: Contrast | null;
    /** DQ-637: the photo the app or website ships with, shown greyed while the slot is empty. */
    bundled?: { url: string; width: number; height: number } | null;
}>();
const emit = defineEmits<{ focus: [x: number, y: number]; choose: []; remove: [] }>();

const contrast = ref<Contrast | null>(props.forced ?? null);
const measuring = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

function measure(): void {
    const value = props.value;
    if (value === null || props.forced) return;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    measuring.value = true;
    failed.value = false;
    // Only the latest measurement speaks: an earlier one, aborted for a newer focal point, settles after it has started (E2E A3, WebKit).
    requestJson<Contrast>('get', routeOr('admin.brand.assets.contrast', `/admin/brand/assets/${value.asset_id}/contrast`, { asset: value.asset_id }), { focal_x: value.focal_x, focal_y: value.focal_y }, mine.signal)
        .then((result) => {
            if (controller === mine) contrast.value = result;
        })
        .catch((error: unknown) => {
            if (controller === mine && !isCancelled(error)) failed.value = true;
        })
        .finally(() => {
            if (controller === mine) measuring.value = false;
        });
}

watch(
    () => (props.value === null ? null : `${props.value.asset_id}:${props.value.focal_x}:${props.value.focal_y}`),
    (key) => {
        if (timer !== null) clearTimeout(timer);
        if (key === null) {
            contrast.value = null;
            return;
        }
        timer = setTimeout(measure, 250);
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
});

function round(value: number): number {
    return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function click(event: MouseEvent): void {
    if (props.readOnly) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    emit('focus', round((event.clientX - box.left) / box.width), round((event.clientY - box.top) / box.height));
}

function key(event: KeyboardEvent): void {
    if (props.readOnly || props.value === null) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    emit('focus', round(props.value.focal_x + move[0]), round(props.value.focal_y + move[1]));
}

const position = computed(() => (props.value === null ? undefined : { left: `${props.value.focal_x * 100}%`, top: `${props.value.focal_y * 100}%` }));
const objectPosition = computed(() => (props.value === null ? undefined : { objectPosition: `${props.value.focal_x * 100}% ${props.value.focal_y * 100}%` }));
const percent = (value: number): string => `${Math.round(value * 100)}`;
// DQ-637: the crop each slot gets (app welcome and splash fill a phone, the website hero is wide).
const cropClass = computed(() => (props.slotKey === 'landing' ? 'aspect-16/9 w-240' : 'aspect-9/16 w-120'));
const locale = getActiveLanguage();
</script>

<template>
    <article class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16" :data-testid="`ADM-28.hero.${slotKey}`">
        <header class="flex flex-wrap items-start justify-between gap-8">
            <div class="flex min-w-0 flex-col gap-2">
                <h3 class="text-headline text-ink">{{ trans(`brand.heroes.${slotKey}`) }}</h3>
                <p class="text-admin-base text-ink-2">{{ trans(`brand.heroes.${slotKey}_hint`) }}</p>
            </div>
            <div v-if="!readOnly" class="flex gap-8">
                <Button v-if="value" size="sm" variant="ghost" @click="emit('remove')">{{ trans('brand.remove') }}</Button>
                <Button size="sm" variant="secondary" :icon="PhImage" :data-testid="`ADM-28.hero.${slotKey}.choose`" @click="emit('choose')">{{ value ? trans('brand.replace') : trans('brand.choose') }}</Button>
            </div>
        </header>

        <div v-if="value && asset?.url" class="flex flex-wrap items-start gap-16">
            <div class="min-w-240 flex-1 basis-320">
                <div
                    :class="[focusRing, 'relative overflow-hidden rounded-xs bg-raised', readOnly ? '' : 'cursor-crosshair']"
                    role="slider"
                    :tabindex="readOnly ? -1 : 0"
                    :aria-label="trans('brand.focal.label', { slot: trans(`brand.heroes.${slotKey}`) })"
                    :aria-valuetext="trans('brand.focal.value', { x: percent(value.focal_x), y: percent(value.focal_y) })"
                    :aria-readonly="readOnly"
                    :data-testid="`ADM-28.hero.${slotKey}.focal`"
                    @click="click"
                    @keydown="key"
                >
                    <img :src="asset.url" alt="" class="block h-auto w-full select-none" :width="asset.width" :height="asset.height" draggable="false" />
                    <!-- DQ-637: white with a dark outline, so the point shows on bright photos too; the fill is the scrim token. -->
                    <span class="pointer-events-none absolute flex size-32 -translate-x-16 -translate-y-16 items-center justify-center rounded-full border-2 border-white bg-scrim text-white outline-1 outline-black" :style="position" aria-hidden="true">
                        <PhCrosshair :size="20" />
                    </span>
                </div>
                <p class="mt-8 text-admin-base text-ink-3">{{ readOnly ? trans('brand.focal.read_only') : trans('brand.focal.hint') }}</p>
            </div>
            <figure class="flex shrink-0 flex-col gap-4">
                <span :class="[cropClass, 'block overflow-hidden rounded-xs bg-black']" :data-testid="`ADM-28.hero.${slotKey}.crop`">
                    <img :src="asset.url" alt="" :width="asset.width" :height="asset.height" class="block size-full object-cover" :style="objectPosition" />
                </span>
                <figcaption class="text-admin-base text-ink-3">{{ trans('brand.focal.crop') }}</figcaption>
            </figure>
        </div>
        <div v-else-if="bundled" class="flex flex-wrap items-start gap-16" :data-testid="`ADM-28.hero.${slotKey}.bundled`">
            <div class="relative min-w-240 flex-1 basis-320 overflow-hidden rounded-xs bg-raised">
                <img :src="bundled.url" alt="" :width="bundled.width" :height="bundled.height" class="block h-auto max-h-320 w-full object-cover opacity-60 grayscale" />
                <span class="absolute left-8 top-8 rounded-xs bg-surface px-8 py-2 text-admin-base-strong text-ink">{{ trans('brand.heroes.bundled_badge') }}</span>
            </div>
            <p class="max-w-240 text-admin-base text-ink-2">{{ trans(`brand.heroes.${slotKey}_bundled`) }}</p>
        </div>
        <div v-else class="flex min-h-120 items-center justify-center rounded-xs border border-dashed border-line px-16 py-24 text-center text-admin-base text-ink-2">
            {{ trans(`brand.heroes.${slotKey}_bundled`) }}
        </div>

        <div v-if="value" class="flex items-start gap-8" role="status" :data-testid="`ADM-28.hero.${slotKey}.contrast`">
            <template v-if="measuring && contrast === null">
                <Skeleton shape="text" class="w-240" />
            </template>
            <template v-else-if="failed">
                <PhWarningCircle :size="20" class="shrink-0 text-warning" aria-hidden="true" />
                <p class="text-admin-base text-ink-2">{{ trans('brand.contrast.failed') }}</p>
            </template>
            <template v-else-if="contrast">
                <component :is="contrast.passes ? PhCheckCircle : PhWarningCircle" :size="20" class="shrink-0" :class="contrast.passes ? 'text-success' : 'text-danger'" aria-hidden="true" />
                <div class="flex flex-col gap-2">
                    <p class="text-admin-base-strong text-ink">{{ contrast.passes ? trans('brand.contrast.passes') : trans('brand.contrast.fails') }}</p>
                    <p class="text-admin-base tabular-nums text-ink-2">
                        {{ trans('brand.contrast.ratios', { logo: ratioText(contrast.logo_ratio, locale), text: ratioText(contrast.text_ratio, locale), minimum: ratioText(contrast.minimum, locale) }) }}
                    </p>
                </div>
            </template>
        </div>
        <p v-if="error" class="text-admin-base text-danger" role="alert">{{ error }}</p>
    </article>
</template>
