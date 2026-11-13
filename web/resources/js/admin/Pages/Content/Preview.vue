<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowClockwise, PhArrowSquareOut, PhDeviceMobile, PhKey, PhMonitor } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, SegmentedControl, Skeleton } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatTime } from '../../lib/format';

/**
 * ADM-34 Entwurfsvorschau (06 §3, m3.5 §2): the member app (Start and a vehicle) and the public vehicle page as they look with this
 * staff member's drafts, through a signed preview token (15 minutes, bound to this staff member, read-only; issued on every visit),
 * in a mobile frame (390) and a desktop frame (1280), in Carbon, Schwarz or Hell. Nothing here publishes anything.
 */
interface Preview {
    token: string;
    expires_at: string;
    keys: string[];
}

const props = defineProps<{
    preview: Preview;
    drafts: { key: string; version: number; mine: boolean }[];
    vehicle: { slug: string; title: string } | null;
}>();

const state = usePageState();
const drafts = computed(() => (state.value === 'empty' ? [] : props.drafts));
const mine = computed(() => drafts.value.filter((draft) => draft.mine));
const others = computed(() => drafts.value.filter((draft) => !draft.mine));

const THEMES = ['carbon', 'black', 'light'] as const;
const initialTheme = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('theme');
const target = ref('app_home');
// ?theme= opens the page on a theme (bookmarks, the Schwarz and Hell captures).
const theme = ref<string>(THEMES.includes(initialTheme as (typeof THEMES)[number]) ? (initialTheme as string) : 'carbon');
const reload = ref(0);
const targets = computed(() => [
    { value: 'app_home', label: trans('content.preview.targets.app_home') },
    ...(props.vehicle ? [{ value: 'app_vehicle', label: trans('content.preview.targets.app_vehicle') }, { value: 'public_vehicle', label: trans('content.preview.targets.public_vehicle') }] : []),
]);
const themes = computed(() => THEMES.map((value) => ({ value, label: trans(`content.preview.themes.${value}`) })));

const src = computed(() => {
    // DQ-613: a preview-scoped theme the app honours only together with a valid preview token (never the QA override, which
    // production builds drop), so Carbon, Schwarz and Hell differ for the client too.
    const query = new URLSearchParams({ preview: props.preview.token, previewTheme: theme.value });
    const slug = props.vehicle?.slug ?? '';
    const path = target.value === 'app_vehicle' ? `/app/v/${slug}` : target.value === 'public_vehicle' ? `/v/${slug}` : '/app/';
    return `${path}?${query.toString()}`;
});
const keyLabel = (key: string) => trans(`content.versions.keys.${key}`);
function renew(): void {
    router.reload({ only: ['preview', 'drafts'] });
    reload.value += 1;
}

// DQ-613: a frame counts as shown once the app inside has rendered (it is same-origin): an element with a test id in its document.
// Until then the frame keeps its skeleton look, and the figure says so (data-frame-ready), so captures wait for real content.
const ready = ref<Record<'mobile' | 'desktop', boolean>>({ mobile: false, desktop: false });
const timers: ReturnType<typeof setInterval>[] = [];
function watchFrame(frame: 'mobile' | 'desktop', event: Event): void {
    ready.value[frame] = false;
    const element = event.target as HTMLIFrameElement;
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        let done = false;
        try {
            done = (element.contentDocument?.querySelector('[data-testid]') ?? null) !== null;
        } catch {
            done = true; // not same-origin: nothing to wait for
        }
        if (done || tries > 60) {
            ready.value[frame] = true;
            clearInterval(timer);
        }
    }, 250);
    timers.push(timer);
}
onBeforeUnmount(() => timers.forEach((timer) => clearInterval(timer)));
</script>

<template>
    <Head :title="trans('content.preview.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-34" :data-qa-state="state">
        <PageHeader :title="trans('content.preview.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.preview.intro')">
            <template v-if="state !== 'loading' && state !== 'error'" #actions>
                <Button size="sm" variant="secondary" :icon="PhArrowClockwise" data-testid="ADM-34.renew" @click="renew">{{ trans('content.preview.renew') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('content.preview.error')" :body="trans('ui.state.error_body')" test-id="ADM-34.error" @retry="router.reload()" />
        <template v-else>
            <section class="flex flex-wrap items-start gap-16 rounded-sm border border-line bg-surface px-16 py-12" data-testid="ADM-34.token">
                <PhKey :size="20" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />
                <div class="flex min-w-0 flex-1 flex-col gap-4">
                    <template v-if="state === 'loading'"><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-240" /></template>
                    <template v-else>
                        <p class="text-admin-base-strong text-ink">{{ mine.length > 0 ? trans('content.preview.with_drafts') : trans('content.preview.no_drafts') }}</p>
                        <p class="text-admin-base text-ink-2">
                            <template v-if="mine.length > 0">{{ mine.map((draft) => `${keyLabel(draft.key)} v${draft.version}`).join(' · ') }} · </template>{{ trans('content.preview.valid_until', { time: formatTime(preview.expires_at) }) }}
                        </p>
                        <p v-if="others.length > 0" class="text-admin-base text-ink-3">{{ trans('content.preview.others', { list: others.map((draft) => keyLabel(draft.key)).join(', ') }) }}</p>
                    </template>
                </div>
                <div class="flex flex-wrap gap-4">
                    <Badge v-for="key in preview.keys" :key="key" tone="info">{{ keyLabel(key) }}</Badge>
                </div>
            </section>

            <div class="flex flex-wrap items-center gap-16">
                <SegmentedControl v-model="target" :options="targets" :label="trans('content.preview.target')" data-testid="ADM-34.target" />
                <SegmentedControl v-model="theme" :options="themes" :label="trans('content.preview.theme')" data-testid="ADM-34.theme" />
                <Button size="sm" variant="ghost" :icon="PhArrowSquareOut" :href="src" external data-testid="ADM-34.open">{{ trans('content.preview.open') }}</Button>
            </div>
            <p v-if="!vehicle" class="text-admin-base text-ink-3">{{ trans('content.preview.no_vehicle') }}</p>

            <div class="flex flex-wrap items-start gap-24" data-testid="ADM-34.frames">
                <figure class="flex min-w-0 max-w-full flex-col gap-8" data-testid="ADM-34.frame.mobile" :data-frame-ready="ready.mobile || undefined">
                    <figcaption class="flex items-center gap-8 text-admin-base-strong text-ink-2"><PhDeviceMobile :size="16" aria-hidden="true" />{{ trans('content.preview.mobile') }}</figcaption>
                    <!-- DQ-640: the phone at 1:1, so copy and contrast can be judged. ADR-212: narrower than the column, the frame scrolls
                         sideways in its own box (focusable for the arrow keys), never the page. -->
                    <div
                        class="h-844 w-390 max-w-full overflow-x-auto overflow-y-hidden rounded-sm border border-line bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        tabindex="0"
                        role="region"
                        :aria-label="trans('content.preview.mobile')"
                    >
                        <Skeleton v-if="state === 'loading'" class="size-full" />
                        <iframe
                            v-else
                            :key="`m-${reload}-${src}`"
                            :src="src"
                            :title="trans('content.preview.frame_title', { frame: trans('content.preview.mobile'), target: targets.find((t) => t.value === target)?.label ?? '' })"
                            class="block h-844 w-390 border-0"
                            referrerpolicy="same-origin"
                            @load="watchFrame('mobile', $event)"
                        />
                    </div>
                </figure>
                <figure class="flex min-w-0 max-w-full flex-col gap-8" data-testid="ADM-34.frame.desktop" :data-frame-ready="ready.desktop || undefined">
                    <figcaption class="flex items-center gap-8 text-admin-base-strong text-ink-2"><PhMonitor :size="16" aria-hidden="true" />{{ trans('content.preview.desktop') }}</figcaption>
                    <!-- DQ-640: 1280 × 800 at three quarters; narrower than the column, it scrolls in its own box (ADR-212). -->
                    <div
                        class="h-600 w-960 max-w-full overflow-x-auto overflow-y-hidden rounded-sm border border-line bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        tabindex="0"
                        role="region"
                        :aria-label="trans('content.preview.desktop')"
                    >
                        <Skeleton v-if="state === 'loading'" class="size-full" />
                        <iframe
                            v-else
                            :key="`d-${reload}-${src}`"
                            :src="src"
                            :title="trans('content.preview.frame_title', { frame: trans('content.preview.desktop'), target: targets.find((t) => t.value === target)?.label ?? '' })"
                            class="block h-800 w-1280 origin-top-left scale-75 border-0"
                            referrerpolicy="same-origin"
                            @load="watchFrame('desktop', $event)"
                        />
                    </div>
                </figure>
            </div>
            <p class="text-admin-base text-ink-3">{{ trans('content.preview.read_only') }}</p>
        </template>
    </div>
</template>
