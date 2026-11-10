<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { PhFilePlus, PhFloppyDisk, PhRocketLaunch, PhScales, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyQueue, Field, Input, Skeleton, StatusPill, Textarea } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import MarkdownEditor from './Partials/MarkdownEditor.vue';
import { useLeaveGuard } from './Partials/configDraft';

/**
 * ADM-31 Rechtstexte (06 §3, 08_LEGAL_COMPLIANCE): every document per language with its published versions; one draft per document and
 * language in Markdown with the members' preview; "erfordert erneute Zustimmung" for AGB and Datenschutz with the summary the app's
 * re-consent sheet shows. Content editors draft; publishing needs legal.publish ⚿, and a re-consent publish a second person (four-eyes).
 * While that approval waits, the draft is locked (MF-3: the approver approves exactly this text).
 */
interface DocumentRow {
    key: string;
    locale: 'de' | 'en';
    version: string | null;
    published_at: string | null;
    draft: string | null;
}
interface Version {
    id: number;
    version: string;
    published_at: string | null;
    published_by: string | null;
    reason: string | null;
    requires_reconsent: boolean;
    summary: string | null;
    current: boolean;
    scheduled: boolean;
}
interface Draft {
    id: number;
    version: string;
    body_md: string;
    requires_reconsent: boolean;
    summary: string | null;
    revision: string;
    author: string | null;
    updated_at: string | null;
    approval: { id: string; expires_at: string } | null;
}

const props = defineProps<{
    documents: DocumentRow[];
    selected: { key: string; locale: 'de' | 'en'; reconsentable: boolean };
    versions: Version[];
    draft: Draft | null;
    current: { version: string; body_md: string } | null;
    can: { edit: boolean; publish: boolean };
}>();

const page = usePage();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
// The editor's own server error (a refusal, or ?dialog=write&qaState=error), next to the buttons that caused it.
const saveError = computed(() => (failedDialog && qaDialog() === 'write' ? trans('ui.state.server_error') : publishOpen.value || discardOpen.value ? null : (errors.value.refused ?? null)));
const versions = computed(() => (pageState.value === 'empty' ? [] : props.versions));
const draft = computed(() => (pageState.value === 'empty' ? null : props.draft));

// The editor: the draft, or a new one started from the current text.
const editing = ref(qaDialog() === 'publish' || qaDialog() === 'discard' || qaDialog() === 'write' || props.draft !== null);
const form = reactive({ version: '', body_md: '', requires_reconsent: false, summary: '' });
const baseline = ref('');
function load(): void {
    const source = props.draft;
    Object.assign(form, {
        version: source?.version ?? nextVersion(props.current?.version ?? null),
        body_md: source?.body_md ?? props.current?.body_md ?? '',
        requires_reconsent: source?.requires_reconsent ?? false,
        summary: source?.summary ?? '',
    });
    baseline.value = source === null ? '' : JSON.stringify(form);
    editing.value = source !== null || editing.value;
}
watch(() => [props.draft, props.selected.key, props.selected.locale], load, { immediate: true });
function nextVersion(current: string | null): string {
    if (current === null) return '1';
    const match = /^(\d+)(?:\.(\d+))?$/.exec(current);
    if (!match) return `${current}-neu`;
    return match[2] === undefined ? String(Number(match[1]) + 1) : `${match[1]}.${Number(match[2]) + 1}`;
}
const dirty = computed(() => editing.value && JSON.stringify(form) !== baseline.value);
const locked = computed(() => !props.can.edit || draft.value?.approval != null);
const { guardOpen, leave } = useLeaveGuard(dirty);

const errors = ref<Record<string, string>>({});
const processing = ref<'save' | 'publish' | 'discard' | null>(null);
function visit(kind: 'save' | 'publish' | 'discard', method: 'post' | 'delete', url: string, data: Record<string, unknown>, sensitive: boolean, done?: () => void): void {
    const go = (): void =>
        router.visit(url, {
            method,
            data: data as never,
            preserveScroll: true,
            preserveState: true,
            onStart: () => (processing.value = kind),
            onFinish: () => (processing.value = null),
            onError: (bag) => (errors.value = bag),
            onSuccess: (next) => {
                if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                errors.value = {};
                done?.();
            },
        });
    if (sensitive && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
    else go();
}
function save(): void {
    visit('save', 'post', routeOr('admin.content.legal.draft.save', `/admin/content/legal/${props.selected.key}/${props.selected.locale}/draft`, { document: props.selected.key, locale: props.selected.locale }), {
        version: form.version,
        body_md: form.body_md,
        requires_reconsent: props.selected.reconsentable && form.requires_reconsent,
        summary: form.summary.trim() === '' ? null : form.summary,
        // SF-1: the draft this editor loaded; a draft that moved since answers 409 instead of being overwritten.
        revision: draft.value?.revision ?? '',
    }, false);
}
const publishOpen = ref(qaDialog() === 'publish');
const discardOpen = ref(qaDialog() === 'discard');
const fourEyes = computed(() => props.selected.reconsentable && (draft.value?.requires_reconsent ?? form.requires_reconsent));
function publish(reason: string | null): void {
    if (!draft.value) return;
    visit('publish', 'post', routeOr('admin.content.legal.publish', `/admin/content/legal/drafts/${draft.value.id}/publish`, { draft: draft.value.id }), { reason, revision: draft.value.revision }, true, () => (publishOpen.value = false));
}
function discard(): void {
    if (!draft.value) {
        editing.value = false;
        discardOpen.value = false;
        return;
    }
    visit('discard', 'delete', routeOr('admin.content.legal.draft.discard', `/admin/content/legal/drafts/${draft.value.id}`, { draft: draft.value.id }), {}, false, () => {
        discardOpen.value = false;
        editing.value = false;
    });
}
const dialogError = computed(() => (failedDialog ? trans('ui.state.server_error') : (errors.value.refused ?? errors.value.reason ?? null)));

const docHref = (row: { key: string; locale: string }) => `${routeOr('admin.content.legal', '/admin/content/legal')}?document=${row.key}&locale=${row.locale}`;
const isSelected = (row: DocumentRow) => row.key === props.selected.key && row.locale === props.selected.locale;
const docLabel = (row: { key: string; locale: string }) => `${trans(`content.legal.documents.${row.key}`)} · ${trans(`content.locales.${row.locale}`)}`;
</script>

<template>
    <Head :title="trans('content.legal.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-31" :data-qa-state="pageState">
        <PageHeader :title="trans('content.legal.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.legal.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.legal.error')" :body="trans('ui.state.error_body')" test-id="ADM-31.error" @retry="router.reload()" />
        <div v-else class="flex flex-col items-start gap-24 desktop:flex-row">
            <nav class="w-full shrink-0 desktop:w-240" :aria-label="trans('content.legal.documents_label')" data-testid="ADM-31.documents">
                <ul class="flex flex-col rounded-sm border border-line">
                    <template v-if="pageState === 'loading'">
                        <li v-for="n in 10" :key="n" class="flex h-48 items-center border-b border-line-subtle px-12 last:border-b-0" aria-hidden="true"><Skeleton shape="text" class="w-160" /></li>
                    </template>
                    <template v-else>
                    <li v-for="row in documents" :key="`${row.key}-${row.locale}`" class="border-b border-line-subtle last:border-b-0">
                        <Link
                            :href="docHref(row)"
                            :class="[focusRing, 'flex min-h-48 flex-col justify-center gap-2 px-12 py-4', isSelected(row) ? 'bg-selected' : 'hover:bg-hover']"
                            :aria-current="isSelected(row) ? 'page' : undefined"
                            data-testid="ADM-31.document"
                        >
                            <span class="text-supporting text-ink">{{ docLabel(row) }}</span>
                            <span class="text-helper text-ink-3">
                                {{ row.version ? trans('content.legal.version_short', { version: row.version }) : trans('content.legal.unpublished') }}<template v-if="row.draft"> · {{ trans('content.legal.has_draft') }}</template>
                            </span>
                        </Link>
                    </li>
                    </template>
                </ul>
            </nav>

            <div class="flex min-w-0 flex-1 flex-col gap-24">
                <template v-if="pageState === 'loading'">
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="h-320 w-full rounded-sm" />
                </template>
                <template v-else>
                    <div class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-title-s text-ink">{{ docLabel(selected) }}</h2>
                            <p class="text-supporting text-ink-2">
                                {{ current && pageState !== 'empty' ? trans('content.legal.current', { version: current.version }) : trans('content.legal.none_published') }}
                            </p>
                        </div>
                        <Button v-if="can.edit && !editing" size="sm" variant="primary" :icon="PhFilePlus" data-testid="ADM-31.start" @click="editing = true">{{ trans('content.legal.start_draft') }}</Button>
                    </div>

                    <ApprovalNotice v-if="draft?.approval" :approval="{ id: draft.approval.id, title: 'approvals.legal_publish_reconsent.title', expires_at: draft.approval.expires_at, existing: true }" test-id="ADM-31.approval" />

                    <section v-if="editing" class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" :aria-label="trans('content.legal.draft_title')" data-testid="ADM-31.editor">
                        <div class="flex flex-wrap items-center gap-8">
                            <StatusPill tone="warning" :label="draft ? trans('content.legal.draft_version', { version: draft.version }) : trans('content.legal.new_draft')" />
                            <Badge v-if="dirty" tone="info">{{ trans('config.draft.unsaved') }}</Badge>
                            <span v-if="draft" class="text-helper text-ink-3">{{ trans('content.legal.draft_by', { name: draft.author ?? trans('config.draft.someone'), date: formatDateTime(draft.updated_at) }) }}</span>
                        </div>
                        <StateBlock v-if="saveError" kind="error" :title="saveError" :retryable="false" test-id="ADM-31.refused" />
                        <div class="w-200">
                            <Field :label="trans('content.legal.version')" :hint="trans('content.legal.version_hint')" :error="errors.version" required>
                                <Input v-model="form.version" maxlength="32" :disabled="locked" tnum data-testid="ADM-31.version" />
                            </Field>
                        </div>
                        <template v-if="selected.reconsentable">
                            <Checkbox v-model="form.requires_reconsent" :label="trans('content.legal.reconsent')" :disabled="locked" data-testid="ADM-31.reconsent" />
                            <p class="-mt-8 pl-24 text-helper text-ink-3">{{ trans('content.legal.reconsent_hint') }}</p>
                            <Field v-if="form.requires_reconsent" :label="trans('content.legal.summary')" :hint="trans('content.legal.summary_hint')" :error="errors.summary" required>
                                <Textarea v-model="form.summary" :rows="3" :maxlength="1000" show-count :disabled="locked" data-testid="ADM-31.summary" />
                            </Field>
                        </template>
                        <MarkdownEditor v-model="form.body_md" :label="trans('content.legal.text')" :hint="trans('content.legal.text_hint')" :error="errors.body_md" :disabled="locked" test-id="ADM-31.markdown" />
                        <div class="flex flex-wrap items-center justify-end gap-8 border-t border-line-subtle pt-16">
                            <Button v-if="can.edit && !locked" size="sm" variant="destructive" :icon="PhTrash" data-testid="ADM-31.discard" @click="draft ? (discardOpen = true) : discard()">{{ draft ? trans('config.draft.discard') : trans('ui.actions.cancel') }}</Button>
                            <Button v-if="can.edit && !locked" size="sm" :variant="dirty || !draft ? 'primary' : 'secondary'" :icon="PhFloppyDisk" :disabled="!dirty && draft !== null" :loading="processing === 'save'" data-testid="ADM-31.save" @click="save">{{ trans('config.draft.save') }}</Button>
                            <Button v-if="can.publish && draft && !dirty && !draft.approval" size="sm" variant="primary" :icon="PhRocketLaunch" data-testid="ADM-31.publish" @click="publishOpen = true">{{ fourEyes ? trans('config.draft.request') : trans('config.draft.publish') }}</Button>
                        </div>
                        <p v-if="!can.publish && draft" class="text-helper text-ink-3">{{ trans('content.legal.editor_only') }}</p>
                    </section>

                    <section class="flex flex-col gap-12" :aria-label="trans('content.legal.versions')" data-testid="ADM-31.versions">
                        <h3 class="text-title-s text-ink">{{ trans('content.legal.versions') }}</h3>
                        <EmptyQueue v-if="versions.length === 0" variant="first" :icon="PhScales" :title="trans('content.legal.versions_empty')" :body="trans('content.legal.versions_empty_body')" />
                        <ScrollRegion v-else :label="trans('content.legal.versions')">
                            <table class="w-full text-supporting">
                                <caption class="sr-only">{{ trans('content.legal.versions') }}</caption>
                                <thead>
                                    <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                                        <th scope="col" class="px-12">{{ trans('content.legal.columns.version') }}</th>
                                        <th scope="col" class="px-12">{{ trans('content.legal.columns.published') }}</th>
                                        <th scope="col" class="px-12">{{ trans('content.legal.columns.by') }}</th>
                                        <th scope="col" class="px-12">{{ trans('content.legal.columns.reason') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="row in versions" :key="row.id" class="border-b border-line-subtle last:border-b-0">
                                        <td class="h-40 whitespace-nowrap px-12 tabular-nums text-ink">
                                            {{ row.version }}
                                            <StatusPill v-if="row.current" tone="success" class="ml-8" :label="trans('content.legal.live')" />
                                            <Badge v-if="row.requires_reconsent" tone="info" class="ml-8">{{ trans('content.legal.reconsent_badge') }}</Badge>
                                        </td>
                                        <td class="whitespace-nowrap px-12 tabular-nums text-ink-2">{{ formatDateTime(row.published_at) }}</td>
                                        <td class="px-12 text-ink-2">{{ row.published_by ?? trans('content.legal.seeded') }}</td>
                                        <td class="px-12 py-8 text-ink-2">{{ row.reason ?? '–' }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </ScrollRegion>
                    </section>
                </template>
            </div>
        </div>

        <ConfirmDialog
            v-model:open="publishOpen"
            :title="fourEyes ? trans('content.legal.request_title') : trans('content.legal.publish_title')"
            :body="fourEyes ? trans('content.legal.request_body') : trans('content.legal.publish_body', { document: docLabel(selected) })"
            :confirm-label="fourEyes ? trans('config.draft.request') : trans('config.draft.publish')"
            tone="neutral"
            reason
            :four-eyes="fourEyes"
            :processing="processing === 'publish'"
            :error="dialogError"
            test-id="ADM-31.publish-dialog"
            @confirm="publish"
        />
        <ConfirmDialog
            v-model:open="discardOpen"
            :title="trans('content.legal.discard_title')"
            :body="trans('content.legal.discard_body')"
            :confirm-label="trans('config.draft.discard')"
            :processing="processing === 'discard'"
            :error="dialogError"
            test-id="ADM-31.discard-dialog"
            @confirm="discard"
        />
        <ConfirmDialog v-model:open="guardOpen" :title="trans('config.draft.leave_title')" :body="trans('config.draft.leave_body')" :confirm-label="trans('config.draft.leave')" test-id="ADM-31.leave-dialog" @confirm="leave" />
    </div>
</template>
