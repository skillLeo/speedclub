<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import DialogError from '../../Components/patterns/DialogError.vue';
import { Head } from '@inertiajs/vue3';
import { PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Drawer, EmptyQueue, Field, IconButton, Input, Select, Skeleton, Textarea } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { SorTemplate } from './shared';

/**
 * ADM-24 statement-of-reasons templates DE/EN (06 §3, m3.4-contract §1; read with moderation.view, edit with moderation.templates): per key
 * and language the measure, facts with placeholders, ground and where it is written. The redress text is fixed by law and only shown.
 */
const props = defineProps<{ templates: SorTemplate[]; placeholders: string[] }>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const list = computed(() => (pageState.value === 'empty' ? [] : props.templates));
const editable = computed(() => can('moderation.templates'));

const action = useAdminAction();
interface Form {
    key: string;
    locale: 'de' | 'en';
    action: 'remove_content' | 'restrict' | 'suspend' | 'no_action';
    label: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string;
    sort: string;
}
const blank = (): Form => ({ key: '', locale: 'de', action: 'remove_content', label: '', facts: '', ground: '', ground_document: 'community', ground_section: '', sort: '10' });
const form = reactive<Form>(blank());
const editing = ref<SorTemplate | null>(null);
const drawerOpen = ref(qaDialog() === 'edit' || qaDialog() === 'new');
const errors = ref<Partial<Record<string, string>>>({});
if (qaDialog() === 'edit' && props.templates[0]) open(props.templates[0]);

function open(template: SorTemplate | null): void {
    editing.value = template;
    Object.assign(
        form,
        template === null
            ? blank()
            : { key: template.key, locale: template.locale, action: template.action as Form['action'], label: template.label, facts: template.facts, ground: template.ground, ground_document: template.ground_document, ground_section: template.ground_section ?? '', sort: String(template.sort) },
    );
    errors.value = {};
    action.reset();
    drawerOpen.value = true;
}
watch(drawerOpen, (value) => {
    if (!value) editing.value = null;
});

const localeOptions = computed(() => (['de', 'en'] as const).map((value) => ({ value, label: trans(`moderation.templates.locales.${value}`) })));
const actionOptions = computed(() => (['remove_content', 'restrict', 'suspend', 'no_action'] as const).map((value) => ({ value, label: trans(`moderation.composer.actions.${value}`) })));
const documentOptions = computed(() => (['community', 'terms', 'law'] as const).map((value) => ({ value, label: trans(`decisions.documents.${value}`) })));
const localeModel = computed({ get: () => form.locale, set: (v: string | undefined) => (form.locale = v === 'en' ? 'en' : 'de') });
const actionModel = computed({ get: () => form.action, set: (v: string | undefined) => (form.action = (v ?? 'remove_content') as Form['action']) });
const documentModel = computed({ get: () => form.ground_document, set: (v: string | undefined) => (form.ground_document = (v ?? 'community') as Form['ground_document']) });

function save(): void {
    const next: Partial<Record<string, string>> = {};
    if (!/^[a-z0-9_]{1,60}$/.test(form.key)) next.key = trans('moderation.templates.fields.key_hint');
    if (form.label.trim().length < 3) next.label = trans('decisions.errors.ground');
    if (form.facts.trim().length < 10) next.facts = trans('decisions.errors.facts');
    if (form.ground.trim().length < 3) next.ground = trans('decisions.errors.ground');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const data = { ...form, sort: Number(form.sort) || 0, ground_section: form.ground_section.trim() === '' ? null : form.ground_section.trim() };
    const url = editing.value
        ? routeOr('admin.moderation.templates.update', `/admin/moderation/templates/${editing.value.id}`, { template: editing.value.id })
        : routeOr('admin.moderation.templates.store', '/admin/moderation/templates');
    action.run(editing.value ? 'patch' : 'post', url, data, { onSuccess: () => (drawerOpen.value = false) });
}

const deleting = ref<SorTemplate | null>(null);
const deleteOpen = ref(false);
function openDelete(template: SorTemplate): void {
    deleting.value = template;
    action.reset();
    deleteOpen.value = true;
}
function destroy(): void {
    if (!deleting.value) return;
    action.run('delete', routeOr('admin.moderation.templates.destroy', `/admin/moderation/templates/${deleting.value.id}`, { template: deleting.value.id }), {}, { onSuccess: () => (deleteOpen.value = false) });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Head :title="trans('moderation.templates.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-24" :data-qa-state="pageState">
        <PageHeader :title="trans('moderation.templates.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('moderation.templates.intro')">
            <template v-if="editable" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-24.new" @click="open(null)">{{ trans('moderation.templates.new') }}</Button>
            </template>
        </PageHeader>

        <p class="max-w-720 text-supporting text-ink-2" data-testid="ADM-24.redress">{{ trans('moderation.templates.redress') }}</p>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('moderation.templates.error')" :body="trans('ui.state.error_body')" test-id="ADM-24.error" />
        <EmptyQueue v-else-if="pageState !== 'loading' && list.length === 0" variant="first" :title="trans('moderation.templates.empty_title')" :body="trans('moderation.templates.empty_body')" data-testid="ADM-24.empty" />
        <ScrollRegion v-else :label="trans('moderation.templates.caption')">
            <table class="w-full text-supporting">
                <caption class="sr-only">{{ trans('moderation.templates.caption') }}</caption>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                        <th scope="col" class="px-12">{{ trans('moderation.templates.columns.label') }}</th>
                        <th scope="col" class="px-12">{{ trans('moderation.templates.columns.locale') }}</th>
                        <th scope="col" class="px-12">{{ trans('moderation.templates.columns.action') }}</th>
                        <th scope="col" class="px-12">{{ trans('moderation.templates.columns.ground') }}</th>
                        <th scope="col" class="px-12">{{ trans('moderation.templates.columns.updated') }}</th>
                        <th v-if="editable" scope="col" class="w-80 px-12"><span class="sr-only">{{ trans('moderation.templates.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                        <template v-if="pageState === 'loading'">
                            <tr v-for="n in 6" :key="`skeleton-${n}`" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                <td v-for="c in editable ? 6 : 5" :key="c" class="px-12"><Skeleton shape="text" :class="c === 1 ? 'w-160' : 'w-80'" /></td>
                            </tr>
                        </template>
                        <template v-else>
                    <tr v-for="t in list" :key="t.id" class="h-40 border-b border-line-subtle" data-testid="ADM-24.template">
                        <td class="px-12">
                            <span class="whitespace-nowrap text-ink" :title="`${t.key}: ${t.facts}`">{{ t.label }}</span>
                        </td>
                        <td class="px-12"><Badge tone="neutral">{{ t.locale.toUpperCase() }}</Badge></td>
                        <td class="whitespace-nowrap px-12 text-ink-2">{{ trans(`moderation.composer.actions.${t.action}`) }}</td>
                        <td class="px-12 text-ink-2">{{ [trans(`decisions.documents.${t.ground_document}`), t.ground_section ? `§ ${t.ground_section}` : null].filter(Boolean).join(' ') }}</td>
                        <td class="whitespace-nowrap px-12 text-ink-3 tabular-nums" :title="formatDateTime(t.updated_at)">{{ formatDate(t.updated_at) }}</td>
                        <td v-if="editable" class="px-12">
                            <span class="flex items-center gap-4">
                                <IconButton :icon="PhPencilSimple" :label="trans('moderation.templates.edit')" size="sm" data-testid="ADM-24.edit" @click="open(t)" />
                                <IconButton :icon="PhTrash" :label="trans('moderation.templates.delete')" size="sm" variant="ghost" class="hover:text-danger" data-testid="ADM-24.delete" @click="openDelete(t)" />
                            </span>
                        </td>
                    </tr>
                        </template>
                    </tbody>
            </table>
        </ScrollRegion>

        <Drawer v-model:open="drawerOpen" :title="editing ? trans('moderation.templates.drawer_edit') : trans('moderation.templates.drawer_new')" size="lg" :dismissible="!action.processing.value" test-id="ADM-24.drawer">
            <form id="adm24-form" class="flex flex-col gap-16" novalidate @submit.prevent="save">
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('moderation.templates.fields.key')" :hint="trans('moderation.templates.fields.key_hint')" :error="errors.key" required><Input v-model="form.key" maxlength="60" data-testid="ADM-24.form.key" /></Field>
                    </div>
                    <div class="w-160"><Field :label="trans('moderation.templates.fields.locale')" required><Select v-model="localeModel" :options="localeOptions" data-testid="ADM-24.form.locale" /></Field></div>
                </div>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0"><Field :label="trans('moderation.templates.fields.label')" :error="errors.label" required><Input v-model="form.label" maxlength="120" data-testid="ADM-24.form.label" /></Field></div>
                    <div class="w-200"><Field :label="trans('moderation.templates.fields.action')" required><Select v-model="actionModel" :options="actionOptions" data-testid="ADM-24.form.action" /></Field></div>
                </div>
                <Field :label="trans('moderation.templates.fields.facts')" :hint="trans('moderation.templates.fields.facts_hint')" :error="errors.facts" required>
                    <Textarea v-model="form.facts" :rows="4" :maxlength="5000" data-testid="ADM-24.form.facts" />
                </Field>
                <Field :label="trans('moderation.templates.fields.ground')" :error="errors.ground" required><Textarea v-model="form.ground" :rows="2" :maxlength="2000" data-testid="ADM-24.form.ground" /></Field>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-160 grow basis-0"><Field :label="trans('moderation.templates.fields.document')" required><Select v-model="documentModel" :options="documentOptions" /></Field></div>
                    <div class="w-160"><Field :label="trans('moderation.templates.fields.section')" optional><Input v-model="form.ground_section" maxlength="100" /></Field></div>
                    <div class="w-160"><Field :label="trans('moderation.templates.fields.sort')" optional><Input v-model="form.sort" inputmode="numeric" maxlength="3" /></Field></div>
                </div>
                <p class="text-helper text-ink-3">{{ trans('moderation.templates.redress') }}</p>
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm24-form" variant="primary" :loading="action.processing.value" data-testid="ADM-24.form.save">{{ trans('moderation.templates.save') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('moderation.templates.delete_title', { label: deleting?.label ?? '' })"
            :body="trans('moderation.templates.delete_body')"
            :confirm-label="trans('moderation.templates.delete')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-24.delete-confirm"
            @confirm="destroy"
        />
    </div>
</template>
