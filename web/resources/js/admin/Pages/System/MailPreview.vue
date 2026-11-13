<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhEnvelopeSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { EmptyQueue, Skeleton } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-61 Mail-Vorschau (09 §8.1, non-production only, Owner only): the last 50 outgoing mails of a host without SMTP, so e-mail code
 * demos work. The list carries metadata only, never a code (SEC-M46-04); choosing a mail loads it (partial reload `selected`), which the
 * server audits. The HTML renders in a sandboxed frame without scripts.
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
    html: string;
    text: string;
}
const props = defineProps<{ mails: MailRow[]; selected: Selected | null; mailer: string | null }>();

const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : props.mails.length === 0 ? 'empty' : 'ready'));
const loading = ref<number | null>(null);
const view = ref<'html' | 'text'>('html');
const current = computed(() => props.selected);

function open(index: number): void {
    router.get(routeOr('admin.system.mail-preview', '/admin/system/mail-preview'), { mail: index }, {
        only: ['selected'],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => (loading.value = index),
        onFinish: () => (loading.value = null),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
</script>

<template>
    <Head :title="trans('system.mail_preview.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-61" :data-qa-state="state">
        <PageHeader :title="trans('system.mail_preview.title')" :crumbs="[{ label: trans('shell.groups.system') }]" :description="trans('system.mail_preview.intro', { mailer: mailer ?? '–' })" />

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('system.mail_preview.error')" :body="trans('ui.state.error_body')" test-id="ADM-61.error" @retry="router.reload()" />
        <EmptyQueue v-else-if="state === 'empty'" :title="trans('system.mail_preview.empty')" :body="trans('system.mail_preview.empty_body')" data-testid="ADM-61.empty" />
        <div v-else class="grid gap-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ul class="flex flex-col rounded-sm border border-line-subtle" :aria-busy="state === 'loading' || undefined" data-testid="ADM-61.list">
                <template v-if="state === 'loading'">
                    <li v-for="n in 8" :key="n" class="flex flex-col gap-4 border-b border-line-subtle px-16 py-12 last:border-b-0">
                        <Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" />
                    </li>
                </template>
                <li v-for="mail in mails" v-else :key="mail.index" class="border-b border-line-subtle last:border-b-0">
                    <button
                        type="button"
                        class="flex w-full flex-col items-start gap-2 px-16 py-12 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                        :class="current?.index === mail.index ? 'bg-surface-2' : 'hover:bg-surface-2'"
                        :aria-current="current?.index === mail.index || undefined"
                        :aria-busy="loading === mail.index || undefined"
                        :data-testid="`ADM-61.mail.${mail.index}`"
                        @click="open(mail.index)"
                    >
                        <span class="text-admin-base-strong text-ink">{{ mail.subject }}</span>
                        <span class="text-admin-base text-ink-3">{{ mail.to.join(', ') }} · <span class="tabular-nums">{{ formatDateTime(mail.at) }}</span></span>
                    </button>
                </li>
            </ul>
            <section class="flex min-h-320 flex-col gap-12 rounded-sm border border-line-subtle p-16" data-testid="ADM-61.detail" :aria-label="trans('system.mail_preview.detail')">
                <p v-if="current === null" class="flex items-center gap-8 text-admin-base text-ink-3">
                    <PhEnvelopeSimple :size="16" aria-hidden="true" />{{ trans('system.mail_preview.choose') }}
                </p>
                <template v-else>
                    <div class="flex flex-wrap items-center justify-between gap-8">
                        <h2 class="text-admin-base-strong text-ink">{{ current.subject }}</h2>
                        <div class="flex gap-4" role="group" :aria-label="trans('system.mail_preview.format')">
                            <button type="button" class="rounded-sm px-8 py-4 text-admin-base" :class="view === 'html' ? 'bg-surface-2 text-ink' : 'text-ink-3'" :aria-pressed="view === 'html'" data-testid="ADM-61.view.html" @click="view = 'html'">{{ trans('system.mail_preview.html') }}</button>
                            <button type="button" class="rounded-sm px-8 py-4 text-admin-base" :class="view === 'text' ? 'bg-surface-2 text-ink' : 'text-ink-3'" :aria-pressed="view === 'text'" data-testid="ADM-61.view.text" @click="view = 'text'">{{ trans('system.mail_preview.text') }}</button>
                        </div>
                    </div>
                    <iframe v-if="view === 'html'" :srcdoc="current.html" sandbox="" referrerpolicy="no-referrer" :title="current.subject" class="min-h-480 w-full flex-1 rounded-sm border border-line-subtle bg-surface" data-testid="ADM-61.html" />
                    <pre v-else class="overflow-auto whitespace-pre-wrap text-admin-base text-ink-2" data-testid="ADM-61.text">{{ current.text }}</pre>
                </template>
            </section>
        </div>
    </div>
</template>
