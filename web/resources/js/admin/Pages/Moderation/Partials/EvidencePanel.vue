<script setup lang="ts">
import { PhArrowsOutLineVertical, PhEye, PhImage, PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, ref } from 'vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Badge, Button, Skeleton } from '../../../Components/ui';
import { formatDateTime } from '../../../lib/format';
import { JsonError, requestJson } from '../../../lib/http';
import { routeOr } from '../../../lib/routes';
import type { TargetType } from '../shared';

/**
 * The evidence of a case (m3.4-contract §1): loaded only on request (or at once on ADM-22, where opening a case is the request), each
 * opening audited by the server (`moderation.evidence_viewed`), never part of the page props. For a message: the reported message with the
 * stored context, and on request up to ±10 live messages (`moderation.live_context_viewed`). Staff without moderation.messages get a
 * locked state for message cases and nothing is fetched.
 */
interface EvidenceMessage {
    id: string;
    from: 'reported' | 'reporter' | 'other';
    type: string;
    body: string | null;
    vehicle: string | null;
    created_at: string | null;
    reported: boolean;
}
interface EvidenceReport {
    report_id: string;
    reporter: string | null;
    source: string;
    created_at: string;
    target: Record<string, unknown> | null;
    messages: EvidenceMessage[];
}
interface Evidence {
    target_type: TargetType;
    participants: { reported: string | null; reporter: string | null } | null;
    reports: EvidenceReport[];
    live_available: boolean;
}

const props = withDefaults(defineProps<{ caseId: string; targetType: TargetType; allowed: boolean; autoload?: boolean; testId: string; forceState?: 'loading' | 'error' }>(), { autoload: false, forceState: undefined });

const evidence = ref<Evidence | null>(null);
const loading = ref(false);
const failed = ref(false);
const live = ref<EvidenceMessage[] | null>(null);
const liveLoading = ref(false);
const liveFailed = ref(false);
const shownState = computed(() => props.forceState ?? (loading.value ? 'loading' : failed.value ? 'error' : evidence.value ? 'ready' : 'idle'));

async function reveal(): Promise<void> {
    if (!props.allowed) return;
    loading.value = true;
    failed.value = false;
    try {
        evidence.value = await requestJson<Evidence>('post', routeOr('admin.moderation.cases.evidence', `/admin/moderation/cases/${props.caseId}/evidence`, { case: props.caseId }));
    } catch (error) {
        failed.value = error instanceof JsonError || error instanceof Error;
    } finally {
        loading.value = false;
    }
}
async function loadLive(): Promise<void> {
    liveLoading.value = true;
    liveFailed.value = false;
    try {
        const answer = await requestJson<{ messages: EvidenceMessage[] }>('post', routeOr('admin.moderation.cases.live', `/admin/moderation/cases/${props.caseId}/live-context`, { case: props.caseId }));
        live.value = answer.messages;
    } catch {
        liveFailed.value = true;
    } finally {
        liveLoading.value = false;
    }
}
onMounted(() => {
    if (props.autoload && props.allowed && props.forceState === undefined) void reveal();
});

const SNAPSHOT_FIELDS = ['username', 'display_name', 'bio', 'title', 'nickname', 'description', 'alt', 'note', 'brand_text', 'part_name', 'notes'];
function snapshotRows(target: Record<string, unknown> | null): { key: string; value: string }[] {
    if (target === null) return [];
    return SNAPSHOT_FIELDS.filter((key) => typeof target[key] === 'string' && (target[key]).trim() !== '').map((key) => ({ key, value: target[key] as string }));
}
function sender(message: EvidenceMessage): string {
    const p = evidence.value?.participants;
    if (message.from === 'reported' && p?.reported) return trans('moderation.case.evidence.from.reported', { username: p.reported });
    if (message.from === 'reporter' && p?.reporter) return trans('moderation.case.evidence.from.reporter', { username: p.reporter });
    return trans('moderation.case.evidence.from.other');
}
</script>

<template>
    <section class="flex flex-col gap-16" :data-testid="testId" :data-evidence-state="shownState">
        <div class="flex flex-wrap items-start justify-between gap-12">
            <div class="flex max-w-720 flex-col gap-4">
                <h2 class="text-headline text-ink">{{ trans('moderation.case.evidence.title') }}</h2>
                <p class="text-supporting text-ink-2">{{ trans('moderation.case.evidence.intro') }}</p>
            </div>
            <Badge v-if="shownState === 'ready'" tone="neutral" :data-testid="`${testId}.logged`"><PhEye :size="16" aria-hidden="true" />{{ trans('moderation.case.evidence.logged') }}</Badge>
            <Button v-else-if="allowed && shownState === 'idle'" size="sm" variant="secondary" :icon="PhEye" :data-testid="`${testId}.reveal`" @click="reveal()">{{ trans('moderation.case.evidence.reveal') }}</Button>
        </div>

        <div v-if="!allowed" class="flex items-start gap-8 rounded-sm border border-dashed border-line px-16 py-16" :data-testid="`${testId}.forbidden`">
            <PhLockSimple :size="20" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />
            <p class="text-supporting text-ink-2">{{ trans('moderation.case.evidence.forbidden') }}</p>
        </div>
        <div v-else-if="shownState === 'loading'" class="flex flex-col gap-12" aria-busy="true" :data-testid="`${testId}.loading`">
            <div v-for="n in 3" :key="n" class="flex flex-col gap-8 border-t border-line-subtle pt-12 first:border-t-0 first:pt-0">
                <Skeleton shape="text" class="w-160" />
                <Skeleton shape="text" class="w-full" />
            </div>
        </div>
        <StateBlock v-else-if="shownState === 'error'" kind="error" :title="trans('moderation.case.evidence.error')" :body="trans('ui.state.error_body')" :test-id="`${testId}.error`" @retry="reveal()" />

        <template v-else-if="evidence">
            <article v-for="report in evidence.reports" :key="report.report_id" class="flex flex-col gap-12 border-t border-line-subtle pt-16 first:border-t-0 first:pt-0" :data-testid="`${testId}.report`">
                <p class="text-caption text-ink-3 tabular-nums">
                    {{ [trans('moderation.case.evidence.snapshot'), formatDateTime(report.created_at), report.reporter ? `@${report.reporter}` : null].filter(Boolean).join(' · ') }}
                </p>
                <ol v-if="report.messages.length > 0" class="flex flex-col gap-8" :aria-label="trans('moderation.case.evidence.title')">
                    <li
                        v-for="message in report.messages"
                        :key="message.id"
                        class="flex flex-col gap-4 rounded-sm border px-12 py-8"
                        :class="message.reported ? 'border-line-strong bg-raised' : 'border-line-subtle'"
                        :data-testid="message.reported ? `${testId}.reported-message` : `${testId}.context-message`"
                    >
                        <p class="flex flex-wrap items-center gap-8 text-caption text-ink-3 tabular-nums">
                            <span class="sc-key text-ink-2">{{ sender(message) }}</span>
                            <time v-if="message.created_at" :datetime="message.created_at">{{ formatDateTime(message.created_at) }}</time>
                            <Badge v-if="message.reported" tone="warning">{{ trans('moderation.case.evidence.reported_badge') }}</Badge>
                        </p>
                        <p v-if="message.body" class="whitespace-pre-line text-supporting text-ink">{{ message.body }}</p>
                        <p v-else-if="message.type === 'photo'" class="flex items-center gap-4 text-supporting text-ink-2"><PhImage :size="16" aria-hidden="true" />{{ trans('moderation.case.evidence.photo') }}</p>
                        <p v-else-if="message.vehicle" class="text-supporting text-ink-2">{{ trans('moderation.case.evidence.vehicle', { title: message.vehicle }) }}</p>
                        <p v-else class="text-supporting text-ink-3">{{ trans('moderation.case.evidence.removed') }}</p>
                    </li>
                </ol>
                <dl v-else-if="snapshotRows(report.target).length > 0" class="flex flex-col gap-8">
                    <div v-for="row in snapshotRows(report.target)" :key="row.key" class="flex flex-col gap-2 desktop:flex-row desktop:gap-16">
                        <dt class="shrink-0 text-supporting text-ink-3 desktop:w-160">{{ trans(`moderation.case.evidence.fields.${row.key}`) }}</dt>
                        <dd class="min-w-0 whitespace-pre-line text-supporting text-ink">{{ row.value }}</dd>
                    </div>
                </dl>
                <p v-else class="text-supporting text-ink-3">{{ trans('moderation.case.evidence.no_snapshot') }}</p>
            </article>

            <div v-if="evidence.target_type === 'message'" class="flex flex-col gap-12 border-t border-line-subtle pt-16">
                <template v-if="live === null">
                    <div class="flex flex-wrap items-center gap-12">
                        <Button size="sm" variant="secondary" :icon="PhArrowsOutLineVertical" :disabled="!evidence.live_available" :loading="liveLoading" :data-testid="`${testId}.live`" @click="loadLive()">
                            {{ trans('moderation.case.evidence.more') }}
                        </Button>
                        <p class="text-caption text-ink-3">{{ evidence.live_available ? trans('moderation.case.evidence.more_hint') : trans('moderation.case.evidence.more_none') }}</p>
                    </div>
                    <p v-if="liveFailed" class="text-helper text-danger" role="alert">{{ trans('moderation.case.evidence.error') }}</p>
                </template>
                <template v-else>
                    <h3 class="text-label-s text-ink">{{ trans('moderation.case.evidence.live_title') }}</h3>
                    <ol class="flex flex-col gap-8" :data-testid="`${testId}.live-list`">
                        <li v-for="message in live" :key="message.id" class="flex flex-col gap-4 rounded-sm border px-12 py-8" :class="message.reported ? 'border-line-strong bg-raised' : 'border-line-subtle'">
                            <p class="flex flex-wrap items-center gap-8 text-caption text-ink-3 tabular-nums">
                                <span class="sc-key text-ink-2">{{ sender(message) }}</span>
                                <time v-if="message.created_at" :datetime="message.created_at">{{ formatDateTime(message.created_at) }}</time>
                                <Badge v-if="message.reported" tone="warning">{{ trans('moderation.case.evidence.reported_badge') }}</Badge>
                            </p>
                            <p v-if="message.body" class="whitespace-pre-line text-supporting text-ink">{{ message.body }}</p>
                            <p v-else class="text-supporting text-ink-3">{{ message.type === 'photo' ? trans('moderation.case.evidence.photo') : message.vehicle ? trans('moderation.case.evidence.vehicle', { title: message.vehicle }) : trans('moderation.case.evidence.removed') }}</p>
                        </li>
                    </ol>
                </template>
            </div>
        </template>
    </section>
</template>
