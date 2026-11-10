<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhInfo, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Field, Input, Skeleton, Switch, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { routeOr } from '../../lib/routes';
import DraftBar from '../Content/Partials/DraftBar.vue';
import { qaDialog } from '../../composables/qaDialog';
import { useConfigDraft, type EditorProps } from '../Content/Partials/configDraft';
import type { Localized } from '../Content/Partials/home';

/**
 * ADM-37 Remote-Konfiguration (06 §3, m3.5 §2): the oldest version the app still runs (below it SYS-02 asks for an update) and the
 * newest one per platform, the force-update text DE/EN, and maintenance mode with its DE/EN text (SYS-01). Every write ⚿; switching
 * maintenance on needs a second person (four-eyes), switching it off is immediate. The team keeps working during maintenance through
 * its preview token; members have no bypass.
 */
interface RemoteConfig {
    min_version: { ios: string; android: string };
    latest_version: { ios: string; android: string };
    force_update_message: Localized | null;
    maintenance: { enabled: boolean; message: Localized | null };
}

const props = defineProps<{ editor: EditorProps<RemoteConfig>; latestRelease: string | null; maintenanceAtom: boolean }>();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const draft = useConfigDraft(
    () => props.editor,
    {
        save: routeOr('admin.config.remote.draft.save', '/admin/config/remote/draft'),
        discard: routeOr('admin.config.remote.draft.discard', '/admin/config/remote/draft'),
        publish: routeOr('admin.config.remote.publish', '/admin/config/remote/publish'),
    },
    { sensitiveDraft: true },
);
const form = draft.form;
const PLATFORMS = ['ios', 'android'] as const;

function localized(path: 'force' | 'maintenance', locale: 'de' | 'en') {
    return computed({
        get: () => (path === 'force' ? form.value.force_update_message : form.value.maintenance.message)?.[locale] ?? '',
        set: (text: string) => {
            const current = (path === 'force' ? form.value.force_update_message : form.value.maintenance.message) ?? { de: '', en: null };
            const next: Localized = { ...current, [locale]: locale === 'en' && text.trim() === '' ? null : text };
            const value = next.de.trim() === '' && (next.en ?? '').trim() === '' ? null : next;
            if (path === 'force') form.value.force_update_message = value;
            else form.value.maintenance.message = value;
        },
    });
}
const forceDe = localized('force', 'de');
const forceEn = localized('force', 'en');
const maintenanceDe = localized('maintenance', 'de');
const maintenanceEn = localized('maintenance', 'en');
const turningOn = computed(() => props.editor.needsApproval !== null || (form.value.maintenance.enabled && !props.editor.payload.maintenance.enabled));
// DQ-628: the publish dialog names the maintenance change; ?dialog=maintenance switches it on in the form (unsaved) for the capture.
const publishChanges = computed(() =>
    form.value.maintenance.enabled === props.editor.payload.maintenance.enabled && props.editor.needsApproval === null
        ? []
        : [trans('config.remote.change_maintenance', { from: trans(props.editor.payload.maintenance.enabled ? 'config.remote.on' : 'config.remote.off'), to: trans(form.value.maintenance.enabled ? 'config.remote.on' : 'config.remote.off') })],
);
if (qaDialog() === 'maintenance' && !draft.readOnly.value && props.maintenanceAtom) form.value.maintenance.enabled = true;
const liveMaintenance = computed(() => props.editor.payload.maintenance.enabled && props.editor.draft === null);
</script>

<template>
    <Head :title="trans('config.remote.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-37" :data-qa-state="pageState">
        <PageHeader :title="trans('config.remote.title')" :crumbs="[{ label: trans('shell.groups.configuration') }]" :description="trans('config.remote.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('config.remote.error')" :body="trans('ui.state.error_body')" test-id="ADM-37.error" @retry="router.reload()" />
        <template v-else-if="pageState === 'loading'">
            <Skeleton class="h-64 w-full rounded-sm" />
            <!-- DQ-622: the three sections at their own heights (versions, force-update text, maintenance). -->
            <div v-for="height in ['h-237', 'h-219', 'h-313']" :key="height" :class="[height, 'flex flex-col gap-12 rounded-sm border border-line p-16']" aria-hidden="true">
                <Skeleton shape="text" class="w-200" />
                <Skeleton shape="text" class="w-480" />
                <div class="flex gap-12"><Skeleton class="h-40 w-160 rounded-sm" /><Skeleton class="h-40 w-160 rounded-sm" /></div>
            </div>
        </template>
        <template v-else>
            <DraftBar :editor="editor" :draft="draft" test-id="ADM-37" :previewable="false" :changes="publishChanges" />
            <div v-if="liveMaintenance" class="flex items-start gap-12 rounded-sm border border-warning px-16 py-12" role="status" data-testid="ADM-37.live-maintenance">
                <PhWarning :size="20" class="mt-2 shrink-0 text-warning" aria-hidden="true" />
                <p class="text-supporting text-ink">{{ trans('config.remote.maintenance_live') }}</p>
            </div>

            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm37-versions" data-testid="ADM-37.versions">
                <div class="flex flex-col gap-4">
                    <h2 id="adm37-versions" class="text-title-s text-ink">{{ trans('config.remote.versions_title') }}</h2>
                    <p class="max-w-720 text-supporting text-ink-2">{{ trans('config.remote.versions_intro') }}</p>
                </div>
                <div class="grid grid-cols-1 gap-16 tablet:grid-cols-2">
                    <fieldset v-for="platform in PLATFORMS" :key="platform" class="flex flex-col gap-12">
                        <legend class="mb-4 text-label-s text-ink">{{ trans(`config.remote.platforms.${platform}`) }}</legend>
                        <div class="flex flex-wrap gap-12">
                            <div class="w-160">
                                <Field :label="trans('config.remote.min_version')" :error="draft.errorAt(`min_version.${platform}`)" required>
                                    <Input v-model="form.min_version[platform]" maxlength="14" tnum :disabled="draft.readOnly.value" :data-testid="`ADM-37.min.${platform}`" />
                                </Field>
                            </div>
                            <div class="w-160">
                                <Field :label="trans('config.remote.latest_version')" :error="draft.errorAt(`latest_version.${platform}`)" required>
                                    <Input v-model="form.latest_version[platform]" maxlength="14" tnum :disabled="draft.readOnly.value" :data-testid="`ADM-37.latest.${platform}`" />
                                </Field>
                            </div>
                        </div>
                    </fieldset>
                </div>
                <p class="flex items-start gap-8 text-helper text-ink-3"><PhInfo :size="16" class="mt-2 shrink-0" aria-hidden="true" />{{ latestRelease ? trans('config.remote.latest_release', { version: latestRelease }) : trans('config.remote.no_release') }}</p>
            </section>

            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm37-force" data-testid="ADM-37.force">
                <div class="flex flex-col gap-4">
                    <h2 id="adm37-force" class="text-title-s text-ink">{{ trans('config.remote.force_title') }}</h2>
                    <p class="max-w-720 text-supporting text-ink-2">{{ trans('config.remote.force_intro') }}</p>
                </div>
                <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                    <Field :label="trans('config.remote.message_de')" :error="draft.errorAt('force_update_message.de')" optional><Textarea v-model="forceDe" :rows="3" :maxlength="300" show-count :disabled="draft.readOnly.value" /></Field>
                    <Field :label="trans('config.remote.message_en')" optional><Textarea v-model="forceEn" :rows="3" :maxlength="300" show-count :disabled="draft.readOnly.value" /></Field>
                </div>
            </section>

            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm37-maintenance" data-testid="ADM-37.maintenance">
                <div class="flex flex-wrap items-start justify-between gap-12">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 id="adm37-maintenance" class="text-title-s text-ink">{{ trans('config.remote.maintenance_title') }}</h2>
                        <p class="max-w-720 text-supporting text-ink-2">{{ trans('config.remote.maintenance_intro') }}</p>
                    </div>
                    <Switch v-model="form.maintenance.enabled" :label="trans(form.maintenance.enabled ? 'config.remote.maintenance_switch_on' : 'config.remote.maintenance_switch_off')" :disabled="draft.readOnly.value || (!maintenanceAtom && !form.maintenance.enabled)" data-testid="ADM-37.maintenance.switch" />
                </div>
                <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                    <Field :label="trans('config.remote.message_de')" :hint="trans('config.remote.maintenance_message_hint')" :error="draft.errorAt('maintenance.message.de')" :required="form.maintenance.enabled" :optional="!form.maintenance.enabled"><Textarea v-model="maintenanceDe" :rows="3" :maxlength="300" show-count :disabled="draft.readOnly.value" data-testid="ADM-37.maintenance.de" /></Field>
                    <Field :label="trans('config.remote.message_en')" optional><Textarea v-model="maintenanceEn" :rows="3" :maxlength="300" show-count :disabled="draft.readOnly.value" /></Field>
                </div>
                <p class="text-helper text-ink-3">{{ trans('config.remote.bypass') }}</p>
                <ApprovalNotice v-if="turningOn" test-id="ADM-37.four-eyes" />
            </section>
        </template>
    </div>
</template>
