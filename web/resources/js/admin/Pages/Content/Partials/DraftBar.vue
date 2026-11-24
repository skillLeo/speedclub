<script setup lang="ts" generic="P extends object">
import { PhArrowCounterClockwise, PhEye, PhFloppyDisk, PhUserSwitch, PhRocketLaunch, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import ApprovalNotice from '../../../Components/patterns/ApprovalNotice.vue';
import { Badge, Button, ConfirmDialog, StatusPill } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { useFourEyes } from '../../../composables/fourEyes';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDateTime } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import type { ConfigDraft, EditorProps } from './configDraft';

/**
 * The status and actions of a config editor (06 §1.5): what is live, whether there is a draft and whose, unsaved changes; Verwerfen,
 * Vorschau (ADM-34), Entwurf speichern, Veröffentlichen ⚿ (four-eyes when the change needs a second person). Also the
 * leave-with-unsaved-changes confirmation. `?dialog=publish|discard|leave` opens a dialog for the visual matrix.
 * M5.1: every server answer of a publish shows in its dialog (also a payload error the publish re-validation found, with the hint to
 * check the marked field); someone else's draft can be taken over ("Entwurf übernehmen", publish atom) instead of only
 * discarded; a waiting approval names who can approve it (ApprovalNotice).
 */
const props = withDefaults(
    defineProps<{
        editor: EditorProps<P>;
        draft: ConfigDraft<P>;
        testId: string;
        previewable?: boolean;
        /** DQ-628: what publishing changes, one line each ("Wartungsmodus: Aus → An"), shown in the publish dialog. */
        changes?: string[];
    }>(),
    { previewable: true, changes: () => [] },
);

const failed = qaDialogFailed();
const publishOpen = ref(qaDialog() === 'publish');
const discardOpen = ref(qaDialog() === 'discard');
const takeOverOpen = ref(qaDialog() === 'take-over');
const guardForced = ref(qaDialog() === 'leave');

const hasDraft = computed(() => props.editor.draft !== null);
const mayDiscard = computed(() => hasDraft.value && props.editor.approval === null && (props.editor.draft?.mine === true ? props.editor.can.edit : props.editor.can.publish));
const mayPublish = computed(() => props.editor.can.publish && props.editor.draft?.mine === true && props.editor.approval === null);
const fourEyesSwitch = useFourEyes();
const fourEyes = computed(() => fourEyesSwitch.value && props.editor.needsApproval !== null);
const mayTakeOver = computed(() => props.editor.draft?.mine === false && props.editor.can.publish && props.editor.can.edit && props.editor.approval === null);
const previewHref = routeOr('admin.content.preview', '/admin/content/preview');

const serverError = computed(() => {
    if (failed) return trans('ui.state.server_error');
    const message = props.draft.firstError.value;
    if (message === null) return null;
    return props.draft.payloadError.value && props.draft.refused.value === null ? trans('config.draft.payload_error', { message }) : message;
});

function publish(): void {
    props.draft.publish(() => (publishOpen.value = false));
}
function takeOver(): void {
    props.draft.takeOver(() => (takeOverOpen.value = false));
}
function discard(): void {
    props.draft.discard(() => (discardOpen.value = false));
}
const guard = computed({
    get: () => props.draft.guardOpen.value || guardForced.value,
    set: (value: boolean) => {
        props.draft.setGuard(value);
        guardForced.value = value;
    },
});
</script>

<template>
    <section class="flex flex-col gap-12" :aria-label="trans('config.draft.region')" :data-testid="`${testId}.draft-bar`">
        <div class="flex flex-wrap items-center gap-x-16 gap-y-12 rounded-sm border border-line bg-surface px-16 py-12">
            <div class="flex min-w-0 flex-1 flex-col gap-4">
                <div class="flex flex-wrap items-center gap-8">
                    <StatusPill v-if="editor.draft" tone="warning" :label="trans('config.draft.draft', { version: String(editor.draft.version) })" />
                    <StatusPill v-else tone="success" :label="editor.live ? trans('config.draft.live', { version: String(editor.live.version) }) : trans('config.draft.defaults')" />
                    <Badge v-if="draft.dirty.value" tone="info" :data-testid="`${testId}.dirty`">{{ trans('config.draft.unsaved') }}</Badge>
                </div>
                <p class="text-admin-base text-ink-2">
                    <template v-if="editor.draft && !editor.draft.mine">{{ trans(mayTakeOver ? 'config.draft.foreign_take_over' : 'config.draft.foreign', { name: editor.draft.author ?? trans('config.draft.someone'), date: formatDateTime(editor.draft.updated_at) }) }}</template>
                    <template v-else-if="editor.draft">{{ trans('config.draft.saved_at', { date: formatDateTime(editor.draft.updated_at) }) }}<template v-if="editor.live"> · {{ trans('config.draft.live_since', { version: String(editor.live.version), date: formatDateTime(editor.live.published_at) }) }}</template></template>
                    <template v-else-if="editor.live">{{ trans('config.draft.live_by', { date: formatDateTime(editor.live.published_at), name: editor.live.published_by ?? trans('config.draft.someone') }) }}</template>
                    <template v-else>{{ trans('config.draft.defaults_body') }}</template>
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-8">
                <Button v-if="draft.dirty.value" size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :data-testid="`${testId}.revert`" @click="draft.revert()">{{ trans('config.draft.revert') }}</Button>
                <Button v-if="mayTakeOver" size="sm" variant="secondary" :icon="PhUserSwitch" :data-testid="`${testId}.take-over`" @click="takeOverOpen = true">{{ trans('config.draft.take_over') }}</Button>
                <Button v-if="mayDiscard && !draft.dirty.value" size="sm" variant="destructive" :icon="PhTrash" :data-testid="`${testId}.discard`" @click="discardOpen = true">{{ trans('config.draft.discard') }}</Button>
                <Button v-if="previewable && editor.draft?.mine && !draft.dirty.value" size="sm" variant="secondary" :icon="PhEye" :href="previewHref" :data-testid="`${testId}.preview`">{{ trans('config.draft.preview') }}</Button>
                <Button
                    v-if="!draft.readOnly.value"
                    size="sm"
                    :variant="draft.dirty.value ? 'primary' : 'secondary'"
                    :icon="PhFloppyDisk"
                    :disabled="!draft.dirty.value"
                    :loading="draft.processing.value === 'save'"
                    :data-testid="`${testId}.save`"
                    @click="draft.save()"
                >
                    {{ trans('config.draft.save') }}
                </Button>
                <Button
                    v-if="mayPublish && !draft.dirty.value"
                    size="sm"
                    variant="primary"
                    :icon="PhRocketLaunch"
                    :data-testid="`${testId}.publish`"
                    @click="publishOpen = true"
                >
                    {{ fourEyes ? trans('config.draft.request') : trans('config.draft.publish') }}
                </Button>
            </div>
        </div>
        <p v-if="serverError && (!draft.dirty.value || draft.refused.value !== null) && !publishOpen && !discardOpen && !takeOverOpen" class="text-admin-base text-danger" role="alert" :data-testid="`${testId}.refused`">{{ serverError }}</p>
        <ApprovalNotice v-if="fourEyesSwitch && editor.approval" :approval="{ ...editor.approval, title: editor.approval.title ?? '', existing: true }" :test-id="`${testId}.approval`" />

        <ConfirmDialog
            v-model:open="publishOpen"
            :title="fourEyes ? trans('config.draft.request_title') : trans('config.draft.publish_title')"
            :body="fourEyes ? trans('config.draft.request_body') : trans('config.draft.publish_body')"
            :confirm-label="fourEyes ? trans('config.draft.request') : trans('config.draft.publish')"
            tone="neutral"
            :four-eyes="fourEyes"
            :processing="draft.processing.value === 'publish'"
            :error="serverError"
            :test-id="`${testId}.publish-dialog`"
            @confirm="publish"
        >
            <ul v-if="changes.length > 0" class="flex flex-col gap-4 text-admin-base text-ink" :data-testid="`${testId}.publish-changes`">
                <li v-for="line in changes" :key="line">{{ line }}</li>
            </ul>
        </ConfirmDialog>
        <ConfirmDialog
            v-model:open="discardOpen"
            :title="trans('config.draft.discard_title')"
            :body="editor.draft?.mine === false ? trans('config.draft.discard_foreign_body', { name: editor.draft?.author ?? trans('config.draft.someone') }) : trans('config.draft.discard_body')"
            :confirm-label="trans('config.draft.discard')"
            :processing="draft.processing.value === 'discard'"
            :error="failed ? trans('ui.state.server_error') : draft.refused.value"
            :test-id="`${testId}.discard-dialog`"
            @confirm="discard"
        />
        <ConfirmDialog
            v-model:open="takeOverOpen"
            :title="trans('config.draft.take_over_title')"
            :body="trans('config.draft.take_over_body', { name: editor.draft?.author ?? trans('config.draft.someone') })"
            :confirm-label="trans('config.draft.take_over')"
            tone="neutral"
            :processing="draft.processing.value === 'takeOver'"
            :error="failed ? trans('ui.state.server_error') : draft.firstError.value"
            :test-id="`${testId}.take-over-dialog`"
            @confirm="takeOver"
        />
        <ConfirmDialog
            v-model:open="guard"
            :title="trans('config.draft.leave_title')"
            :body="trans('config.draft.leave_body')"
            :confirm-label="trans('config.draft.leave')"
            :test-id="`${testId}.leave-dialog`"
            @confirm="draft.leave()"
        />
    </section>
</template>
