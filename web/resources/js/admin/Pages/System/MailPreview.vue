<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhEnvelopeSimple } from '@phosphor-icons/vue';
import { createReusableTemplate, useMediaQuery } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { EmptyQueue, SegmentedControl, Skeleton } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatDateTime } from '../../lib/format';
import { motionOff } from '../../lib/qa';
import { routeOr } from '../../lib/routes';

/**
 * ADM-61 Mail-Vorschau (09 §8.1, non-production only, Owner only): the last 50 outgoing mails of a host without SMTP, so e-mail code
 * demos work. The list carries metadata only, never a code (SEC-M46-04); choosing a mail loads it (partial reload `selected`), which the
 * server audits. The HTML renders in a sandboxed frame without scripts, loaded from a signed URL with a CSP of its own (DQ-1226: an srcdoc
 * frame inherits this page's CSP and lost the mail's inline styles). From 1280 the detail sits beside the list and stays in view while
 * the list scrolls (DQ-1225); the open row carries the SplitQueue selection: the hover tone, a 2 px ink rule and `aria-current`.
 * Below 1280 the two stack (DQ-1233): an opened mail heads the list, so a link with `?mail=` shows it in the first screen under the
 * page header, and a click on a row further down scrolls it into view. The detail is one template rendered before or after the list,
 * so the reading and focus order follows what is on screen.
 */
interface MailRow {
    index: number;
    at: string;
    to: string[];
    subject: string;
}
interface Selected {
    index: number;
    subject: string;
    /** Signed, relative URL of the mail's HTML (MailPreviewFrameController). */
    frame: string;
    text: string;
}
const props = defineProps<{ mails: MailRow[]; selected: Selected | null; mailer: string | null }>();

const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : props.mails.length === 0 ? 'empty' : 'ready'));
const loading = ref<number | null>(null);
const view = ref<string>('html');
const current = computed(() => props.selected);
const views = computed(() => [
    { value: 'html', label: trans('system.mail_preview.html') },
    { value: 'text', label: trans('system.mail_preview.text') },
]);
/** The frame's document has loaded (the visual cell waits for it, DQ-1226); reset for every mail and every switch back to HTML. */
const frameLoaded = ref(false);
watch([() => current.value?.frame, view], () => (frameLoaded.value = false));

const desktop = useMediaQuery('(min-width: 1280px)');
const [DefineDetail, ReuseDetail] = createReusableTemplate();
/** Below 1280 an opened mail comes before the 50 rows instead of after them. */
const detailFirst = computed(() => !desktop.value && current.value !== null);
const detail = ref<HTMLElement | null>(null);
/**
 * Below 1280 a click on a row brings the opened mail into view: it heads the list, under the sticky top bar (its scroll margin);
 * instantly with reduced motion. From 1280 the detail is sticky beside the list and already on screen.
 */
function revealDetail(): void {
    if (desktop.value || props.selected === null) return;
    void nextTick(() => detail.value?.scrollIntoView({ block: 'start', behavior: motionOff() ? 'instant' : 'smooth' }));
}

function open(index: number): void {
    router.get(routeOr('admin.system.mail-preview', '/admin/system/mail-preview'), { mail: index }, {
        only: ['selected'],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => (loading.value = index),
        onSuccess: revealDetail,
        onFinish: () => (loading.value = null),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
</script>

<template>
    <DefineDetail>
        <!-- From 1280 sticky under the 56 top bar (+ the page gap) while the 50 rows scroll, so the opened mail is always on screen. -->
        <section
            ref="detail"
            class="flex min-h-320 min-w-0 grow scroll-mt-80 flex-col gap-12 rounded-sm border border-line-subtle p-16 desktop:sticky desktop:top-80"
            data-testid="ADM-61.detail"
            :aria-label="trans('system.mail_preview.detail')"
        >
            <p v-if="current === null" class="flex items-center gap-8 text-admin-base text-ink-3">
                <PhEnvelopeSimple :size="16" aria-hidden="true" />{{ trans('system.mail_preview.choose') }}
            </p>
            <template v-else>
                <div class="flex flex-wrap items-center justify-between gap-8">
                    <h2 class="text-admin-base-strong text-ink">{{ current.subject }}</h2>
                    <SegmentedControl v-model="view" :options="views" :label="trans('system.mail_preview.format')" data-testid="ADM-61.view" />
                </div>
                <iframe
                    v-if="view === 'html'"
                    :key="current.frame"
                    :src="current.frame"
                    sandbox=""
                    referrerpolicy="no-referrer"
                    :title="current.subject"
                    class="min-h-480 w-full flex-1 rounded-sm border border-line-subtle bg-surface"
                    :data-loaded="frameLoaded || undefined"
                    data-testid="ADM-61.html"
                    @load="frameLoaded = true"
                />
                <pre v-else class="overflow-auto whitespace-pre-wrap text-admin-base text-ink-2" data-testid="ADM-61.text">{{ current.text }}</pre>
            </template>
        </section>
    </DefineDetail>
    <Head :title="trans('system.mail_preview.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-61" :data-qa-state="state">
        <PageHeader :title="trans('system.mail_preview.title')" :crumbs="[{ label: trans('shell.groups.system') }]" :description="trans('system.mail_preview.intro', { mailer: mailer ?? '–' })" />

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('system.mail_preview.error')" :body="trans('ui.state.error_body')" test-id="ADM-61.error" @retry="router.reload()" />
        <EmptyQueue v-else-if="state === 'empty'" :title="trans('system.mail_preview.empty')" :body="trans('system.mail_preview.empty_body')" data-testid="ADM-61.empty" />
        <!-- The SplitQueue geometry (ADM-55, ADM-53): the list 400 (480 from 1440) beside the detail from 1280; below, an opened mail
             heads the list (DQ-1233), else the detail follows it. -->
        <div v-else class="flex flex-col gap-16 desktop:flex-row desktop:items-start">
            <ReuseDetail v-if="detailFirst" />
            <ul class="flex min-w-0 flex-col rounded-sm border border-line-subtle desktop:w-400 desktop:shrink-0 wide:w-480" :aria-busy="state === 'loading' || undefined" data-testid="ADM-61.list">
                <template v-if="state === 'loading'">
                    <li v-for="n in 8" :key="n" class="flex flex-col gap-4 border-b border-line-subtle px-16 py-12 last:border-b-0">
                        <Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" />
                    </li>
                </template>
                <li v-for="mail in mails" v-else :key="mail.index" class="border-b border-line-subtle last:border-b-0">
                    <button
                        type="button"
                        class="relative flex w-full flex-col items-start gap-2 px-16 py-12 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                        :class="current?.index === mail.index ? 'bg-hover' : ''"
                        :aria-current="current?.index === mail.index ? 'true' : undefined"
                        :aria-busy="loading === mail.index || undefined"
                        :data-current="current?.index === mail.index || undefined"
                        :data-testid="`ADM-61.mail.${mail.index}`"
                        @click="open(mail.index)"
                    >
                        <span v-if="current?.index === mail.index" class="absolute inset-y-0 left-0 w-2 bg-ink" aria-hidden="true" data-current-rule />
                        <span class="text-admin-base-strong text-ink">{{ mail.subject }}</span>
                        <span class="text-admin-base text-ink-3">{{ mail.to.join(', ') }} · <span class="tabular-nums">{{ formatDateTime(mail.at) }}</span></span>
                    </button>
                </li>
            </ul>
            <ReuseDetail v-if="!detailFirst" />
        </div>
    </div>
</template>
