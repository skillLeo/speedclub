<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhImage } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, RadioGroup, Skeleton } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import { accentPalette } from '../../../shared/tokens.generated';
import DraftBar from '../Content/Partials/DraftBar.vue';
import { useConfigDraft, type EditorProps } from '../Content/Partials/configDraft';
import AssetPicker from './Partials/AssetPicker.vue';
import HeroSlot from './Partials/HeroSlot.vue';
import { HERO_SLOTS, LOGO_SLOTS, kindOf, type AssetKind, type BrandAsset, type Branding, type HeroSlotKey, type LogoSlot } from './Partials/brand';

/**
 * ADM-28 Marke & Theme (06 §3, 03 §2/§3, FS-1, BL-4): the logo set, the hero photos with focal point and live contrast verdict, the OG
 * default, the accent set (only the pre-validated sets of tokens.json, no free colour) and the default theme, as the branding draft:
 * save → preview (ADM-34) → publish with a reason ⚿ → roll back in ADM-35. The client's logo is never redrawn or recoloured (03 §2).
 */
const props = defineProps<{
    editor: EditorProps<Branding>;
    assets: BrandAsset[];
    accentSets: string[];
    defaultAccent: string;
    themes: string[];
    minimums: Record<AssetKind, { width: number; height: number }>;
    maxUploadKb: number;
}>();

const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const empty = computed(() => pageState.value === 'empty');

const draft = useConfigDraft(() => props.editor, {
    save: routeOr('admin.brand.draft.save', '/admin/brand/draft'),
    discard: routeOr('admin.brand.draft.discard', '/admin/brand/draft'),
    publish: routeOr('admin.brand.publish', '/admin/brand/publish'),
});
const form = draft.form;
const assetList = computed(() => (empty.value ? [] : props.assets));
const byId = computed(() => new Map(assetList.value.map((asset) => [asset.id, asset])));
const asset = (id: string | null | undefined): BrandAsset | null => (id ? (byId.value.get(id) ?? null) : null);
const logoOf = (slot: LogoSlot) => (empty.value ? null : asset(form.value.logos[slot]));
const heroOf = (slot: HeroSlotKey) => (empty.value ? null : form.value.heroes[slot]);

// The picker: which slot it fills.
type PickSlot = LogoSlot | HeroSlotKey | 'og';
const pickerSlot = ref<PickSlot>('welcome');
const pickerOpen = ref(qaDialog() === 'picker');
const pickerKind = computed(() => kindOf(pickerSlot.value));
const slotLabel = (slot: PickSlot): string => (slot === 'og' ? trans('brand.og.title') : (HERO_SLOTS as readonly string[]).includes(slot) ? trans(`brand.heroes.${slot}`) : trans(`brand.logos.${slot}`));
const selectedInPicker = computed(() => {
    const slot = pickerSlot.value;
    if (slot === 'og') return form.value.og_default;
    if ((HERO_SLOTS as readonly string[]).includes(slot)) return form.value.heroes[slot as HeroSlotKey]?.asset_id ?? null;
    return form.value.logos[slot as LogoSlot];
});
function openPicker(slot: PickSlot): void {
    pickerSlot.value = slot;
    pickerOpen.value = true;
}
function choose(id: string): void {
    const slot = pickerSlot.value;
    if (slot === 'og') form.value.og_default = id;
    else if ((HERO_SLOTS as readonly string[]).includes(slot)) {
        const previous = form.value.heroes[slot as HeroSlotKey];
        form.value.heroes[slot as HeroSlotKey] = { asset_id: id, focal_x: previous?.focal_x ?? 0.5, focal_y: previous?.focal_y ?? 0.5 };
    } else form.value.logos[slot as LogoSlot] = id;
}
function setFocus(slot: HeroSlotKey, x: number, y: number): void {
    const hero = form.value.heroes[slot];
    if (hero) form.value.heroes[slot] = { ...hero, focal_x: x, focal_y: y };
}

const accents = computed(() =>
    props.accentSets
        .filter((key) => key in accentPalette)
        .map((key) => ({ key, set: accentPalette[key as keyof typeof accentPalette] })),
);
const themeOptions = computed(() => props.themes.map((theme) => ({ value: theme, label: trans(`brand.themes.${theme}`), hint: trans(`brand.themes.${theme}_hint`) })));
const themeModel = computed({ get: () => form.value.default_theme, set: (value: string | undefined) => (form.value.default_theme = value ?? 'carbon') });
const grounds: Record<LogoSlot, string> = { wordmark_white: 'bg-black', wordmark_black: 'bg-white', square: 'bg-raised', app_mark: 'bg-raised' };
// The client's own wordmarks shipped in web/public/brand (M1.4): what the app shows until a logo is published.
const BUNDLED: Partial<Record<LogoSlot, string>> = { wordmark_white: '/brand/logo-wide-white-640.webp', wordmark_black: '/brand/logo-wide-black-640.webp' };
// DQ-637: the photos the app and website ship with (web copies in web/public/brand/photos); the splash has none (logo on black).
const BUNDLED_HEROES: Partial<Record<HeroSlotKey, { url: string; width: number; height: number }>> = {
    welcome: { url: '/brand/photos/welcome-hero-640.webp', width: 640, height: 998 },
    landing: { url: '/brand/photos/landing-hero-1080.webp', width: 1080, height: 1617 },
};

// QA overlay ?dialog=hero-fails (DQ-612): the other uploaded hero (the bright photo of the demo seed) in "Willkommen (App)", unsaved,
// so the refusal verdict is on a picture.
if (qaDialog() === 'hero-fails') {
    const current = form.value.heroes.welcome?.asset_id ?? null;
    const other = props.assets.find((a) => a.kind === 'hero' && a.id !== current);
    if (other) form.value.heroes.welcome = { asset_id: other.id, focal_x: 0.5, focal_y: 0.55 };
}

const ogAsset = computed(() => (empty.value ? null : asset(form.value.og_default)));
</script>

<template>
    <Head :title="trans('brand.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-28" :data-qa-state="pageState">
        <PageHeader :title="trans('brand.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('brand.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('brand.error')" :body="trans('ui.state.error_body')" test-id="ADM-28.error" @retry="router.reload()" />

        <!-- DQ-622: each section's own frame: the draft bar, four logo cards, the three hero slots, the OG card, accent sets, theme. -->
        <template v-else-if="pageState === 'loading'">
            <Skeleton class="h-56 w-full rounded-sm" />
            <div class="flex flex-col gap-12" aria-hidden="true">
                <span class="flex h-24 items-center"><Skeleton shape="text" class="w-120" /></span>
                <span class="flex h-20 items-center"><Skeleton shape="text" class="w-480" /></span>
                <div class="grid grid-cols-1 gap-16 desktop:grid-cols-2">
                    <Skeleton v-for="n in 4" :key="n" class="h-240 rounded-sm" />
                </div>
            </div>
            <div class="flex flex-col gap-12" aria-hidden="true">
                <span class="flex h-24 items-center"><Skeleton shape="text" class="w-120" /></span>
                <span class="flex h-20 items-center"><Skeleton shape="text" class="w-480" /></span>
                <Skeleton v-for="n in 3" :key="`h-${n}`" class="h-210 w-full rounded-sm" />
            </div>
            <Skeleton class="h-320 w-full rounded-sm" aria-hidden="true" />
            <div class="flex flex-col gap-12" aria-hidden="true">
                <span class="flex h-24 items-center"><Skeleton shape="text" class="w-120" /></span>
                <div class="grid grid-cols-2 gap-12 desktop:grid-cols-4"><Skeleton v-for="n in 4" :key="`a-${n}`" class="h-80 rounded-sm" /></div>
            </div>
            <Skeleton class="h-200 w-full rounded-sm" aria-hidden="true" />
        </template>
        <template v-else>
            <DraftBar :editor="editor" :draft="draft" test-id="ADM-28" />

            <section class="flex flex-col gap-12" aria-labelledby="adm28-logos" data-testid="ADM-28.logos">
                <div class="flex flex-col gap-4">
                    <h2 id="adm28-logos" class="text-title-s text-ink">{{ trans('brand.logos.title') }}</h2>
                    <p class="max-w-720 text-supporting text-ink-2">{{ trans('brand.logos.intro') }}</p>
                </div>
                <ul class="grid grid-cols-1 gap-16 desktop:grid-cols-2">
                    <li v-for="slot in LOGO_SLOTS" :key="slot" class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16" :data-testid="`ADM-28.logo.${slot}`">
                        <div class="flex flex-wrap items-start justify-between gap-8">
                            <div class="flex min-w-0 flex-col gap-2">
                                <h3 class="text-title-s text-ink">{{ trans(`brand.logos.${slot}`) }}</h3>
                                <p class="text-supporting text-ink-2">{{ trans(`brand.logos.${slot}_hint`) }}</p>
                            </div>
                            <div v-if="!draft.readOnly.value" class="flex gap-8">
                                <Button v-if="form.logos[slot]" size="sm" variant="ghost" @click="form.logos[slot] = null">{{ trans('brand.remove') }}</Button>
                                <Button size="sm" variant="secondary" :icon="PhImage" :data-testid="`ADM-28.logo.${slot}.choose`" @click="openPicker(slot)">{{ form.logos[slot] ? trans('brand.replace') : trans('brand.choose') }}</Button>
                            </div>
                        </div>
                        <div class="flex h-120 items-center justify-center overflow-hidden rounded-xs px-24" :class="grounds[slot]">
                            <img v-if="logoOf(slot)?.url" :src="logoOf(slot)?.url ?? ''" :alt="trans(`brand.logos.${slot}`)" :width="logoOf(slot)?.width" :height="logoOf(slot)?.height" class="block h-auto max-h-80 w-auto max-w-full object-contain" />
                            <img v-else-if="BUNDLED[slot]" :src="BUNDLED[slot]" :alt="trans('brand.logos.bundled')" width="640" height="192" class="block h-auto max-h-80 w-auto max-w-full object-contain" />
                            <span v-else class="text-supporting text-ink-2">{{ trans('brand.logos.none') }}</span>
                        </div>
                        <p class="text-helper tabular-nums text-ink-3">
                            <template v-if="logoOf(slot)">{{ trans('brand.size', { width: formatNumber(logoOf(slot)?.width), height: formatNumber(logoOf(slot)?.height) }) }}</template>
                            <template v-else-if="BUNDLED[slot]">{{ trans('brand.logos.bundled') }} · {{ trans('brand.minimum', { width: formatNumber(minimums[kindOf(slot)].width), height: formatNumber(minimums[kindOf(slot)].height) }) }}</template>
                            <template v-else>{{ trans('brand.minimum', { width: formatNumber(minimums[kindOf(slot)].width), height: formatNumber(minimums[kindOf(slot)].height) }) }}</template>
                        </p>
                        <p v-if="draft.errorAt(`logos.${slot}`)" class="text-helper text-danger" role="alert">{{ draft.errorAt(`logos.${slot}`) }}</p>
                    </li>
                </ul>
            </section>

            <section class="flex flex-col gap-12" aria-labelledby="adm28-heroes" data-testid="ADM-28.heroes">
                <div class="flex flex-col gap-4">
                    <h2 id="adm28-heroes" class="text-title-s text-ink">{{ trans('brand.heroes.title') }}</h2>
                    <p class="max-w-720 text-supporting text-ink-2">{{ trans('brand.heroes.intro') }}</p>
                </div>
                <HeroSlot
                    v-for="slot in HERO_SLOTS"
                    :key="slot"
                    :slot-key="slot"
                    :value="heroOf(slot)"
                    :asset="asset(heroOf(slot)?.asset_id)"
                    :read-only="draft.readOnly.value"
                    :error="draft.errorAt(`heroes.${slot}`)"
                    :bundled="BUNDLED_HEROES[slot] ?? null"
                    @focus="(x, y) => setFocus(slot, x, y)"
                    @choose="openPicker(slot)"
                    @remove="form.heroes[slot] = null"
                />
            </section>

            <section class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm28-og" data-testid="ADM-28.og">
                <div class="flex flex-wrap items-start justify-between gap-8">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 id="adm28-og" class="text-title-s text-ink">{{ trans('brand.og.title') }}</h2>
                        <p class="max-w-720 text-supporting text-ink-2">{{ trans('brand.og.intro') }}</p>
                    </div>
                    <div v-if="!draft.readOnly.value" class="flex gap-8">
                        <Button v-if="form.og_default" size="sm" variant="ghost" @click="form.og_default = null">{{ trans('brand.remove') }}</Button>
                        <Button size="sm" variant="secondary" :icon="PhImage" data-testid="ADM-28.og.choose" @click="openPicker('og')">{{ form.og_default ? trans('brand.replace') : trans('brand.choose') }}</Button>
                    </div>
                </div>
                <div class="aspect-1200/630 w-full max-w-480 overflow-hidden rounded-xs bg-raised">
                    <img v-if="ogAsset?.url" :src="ogAsset.url" :alt="trans('brand.og.title')" :width="ogAsset.width" :height="ogAsset.height" class="block size-full object-cover" />
                    <span v-else class="flex size-full items-center justify-center px-16 text-center text-supporting text-ink-2">{{ trans('brand.og.bundled') }}</span>
                </div>
                <p v-if="draft.errorAt('og_default')" class="text-helper text-danger" role="alert">{{ draft.errorAt('og_default') }}</p>
            </section>

            <section class="flex flex-col gap-12" aria-labelledby="adm28-accent" data-testid="ADM-28.accent">
                <div class="flex flex-col gap-4">
                    <h2 id="adm28-accent" class="text-title-s text-ink">{{ trans('brand.accent.title') }}</h2>
                    <p class="max-w-720 text-supporting text-ink-2">{{ trans('brand.accent.intro') }}</p>
                </div>
                <div role="radiogroup" aria-labelledby="adm28-accent" class="grid grid-cols-2 gap-12 desktop:grid-cols-4">
                    <label
                        v-for="{ key, set } in accents"
                        :key="key"
                        :class="['flex cursor-pointer flex-col gap-12 rounded-sm border bg-surface p-12 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus', form.accent_set === key ? 'border-inverse' : 'border-line hover:border-line-strong', draft.readOnly.value ? 'cursor-not-allowed' : '']"
                        :data-testid="`ADM-28.accent.${key}`"
                    >
                        <input v-model="form.accent_set" type="radio" name="accent" :value="key" class="sr-only" :disabled="draft.readOnly.value" />
                        <svg viewBox="0 0 96 32" class="block h-32 w-full rounded-xs" preserveAspectRatio="none" aria-hidden="true" data-testid="ADM-28.accent.sample">
                            <!-- A sample of the set itself (accentPalette of tokens.json): fill on dark, text colour on dark, text colour on light. -->
                            <rect x="0" y="0" width="32" height="32" :fill="set.dark.fill" />
                            <rect x="32" y="0" width="32" height="32" :fill="set.dark.fg" />
                            <rect x="64" y="0" width="32" height="32" :fill="set.light.fg" />
                        </svg>
                        <span class="flex items-center justify-between gap-8">
                            <span class="text-label-s text-ink">{{ trans(`brand.accent.sets.${key}`) }}</span>
                            <span v-if="key === defaultAccent" class="text-helper text-ink-3">{{ trans('brand.accent.default') }}</span>
                        </span>
                    </label>
                </div>
                <p class="text-helper text-ink-3">{{ trans('brand.accent.rule') }}</p>
            </section>

            <section class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16" data-testid="ADM-28.theme">
                <RadioGroup v-model="themeModel" :options="themeOptions" :legend="trans('brand.themes.title')" :disabled="draft.readOnly.value" />
                <p class="text-helper text-ink-3">{{ trans('brand.themes.intro') }}</p>
            </section>
        </template>

        <AssetPicker
            v-model:open="pickerOpen"
            :kind="pickerKind"
            :slot-label="slotLabel(pickerSlot)"
            :assets="assetList"
            :selected="selectedInPicker"
            :minimum="minimums[pickerKind]"
            :max-upload-kb="maxUploadKb"
            :failed="failedDialog"
            @choose="choose"
        />
    </div>
</template>
