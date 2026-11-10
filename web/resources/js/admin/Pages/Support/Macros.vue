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

/**
 * ADM-27 reply macros DE/EN (06 §3 Support, m3.4-contract §1; read with support.view, edit with support.macros): per key and language a
 * title and a text with the variables {name} and {reference}, which the ADM-26 picker fills; the reply stays editable.
 */
interface Macro {
    id: string;
    key: string;
    locale: 'de' | 'en';
    title: string;
    body: string;
    sort: number;
    updated_at: string | null;
}
const props = defineProps<{ macros: Macro[]; variables: string[] }>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const list = computed(() => (pageState.value === 'empty' ? [] : props.macros));
const editable = computed(() => can('support.macros'));

const action = useAdminAction();
interface Form {
    key: string;
    locale: 'de' | 'en';
    title: string;
    body: string;
    sort: string;
}
const blank = (): Form => ({ key: '', locale: 'de', title: '', body: '', sort: '10' });
const form = reactive<Form>(blank());
const editing = ref<Macro | null>(null);
const drawerOpen = ref(qaDialog() === 'edit' || qaDialog() === 'new');
const errors = ref<Partial<Record<string, string>>>({});
if (qaDialog() === 'edit' && props.macros[0]) open(props.macros[0]);

function open(macro: Macro | null): void {
    editing.value = macro;
    Object.assign(form, macro === null ? blank() : { key: macro.key, locale: macro.locale, title: macro.title, body: macro.body, sort: String(macro.sort) });
    errors.value = {};
    action.reset();
    drawerOpen.value = true;
}
watch(drawerOpen, (value) => {
    if (!value) editing.value = null;
});

const localeOptions = computed(() => (['de', 'en'] as const).map((value) => ({ value, label: trans(`support.macros.locales.${value}`) })));
const localeModel = computed({ get: () => form.locale, set: (v: string | undefined) => (form.locale = v === 'en' ? 'en' : 'de') });

function save(): void {
    const next: Partial<Record<string, string>> = {};
    if (!/^[a-z0-9_]{1,60}$/.test(form.key)) next.key = trans('support.macros.fields.key_hint');
    if (form.title.trim().length < 3) next.title = trans('decisions.errors.ground');
    if (form.body.trim().length < 10) next.body = trans('decisions.errors.facts');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const data = { ...form, sort: Number(form.sort) || 0 };
    const url = editing.value ? routeOr('admin.support.macros.update', `/admin/support/macros/${editing.value.id}`, { macro: editing.value.id }) : routeOr('admin.support.macros.store', '/admin/support/macros');
    action.run(editing.value ? 'patch' : 'post', url, data, { onSuccess: () => (drawerOpen.value = false) });
}

const deleting = ref<Macro | null>(null);
const deleteOpen = ref(false);
function openDelete(macro: Macro): void {
    deleting.value = macro;
    action.reset();
    deleteOpen.value = true;
}
function destroy(): void {
    if (!deleting.value) return;
    action.run('delete', routeOr('admin.support.macros.destroy', `/admin/support/macros/${deleting.value.id}`, { macro: deleting.value.id }), {}, { onSuccess: () => (deleteOpen.value = false) });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Head :title="trans('support.macros.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-27" :data-qa-state="pageState">
        <PageHeader :title="trans('support.macros.title')" :crumbs="[{ label: trans('shell.groups.support') }]" :description="trans('support.macros.intro')">
            <template v-if="editable" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-27.new" @click="open(null)">{{ trans('support.macros.new') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('support.macros.error')" :body="trans('ui.state.error_body')" test-id="ADM-27.error" />
        <EmptyQueue v-else-if="pageState !== 'loading' && list.length === 0" variant="first" :title="trans('support.macros.empty_title')" :body="trans('support.macros.empty_body')" data-testid="ADM-27.empty" />
        <ScrollRegion v-else :label="trans('support.macros.caption')">
            <table class="w-full min-w-960 table-fixed text-supporting">
                <caption class="sr-only">{{ trans('support.macros.caption') }}</caption>
                <!-- DQ-555: fixed widths but for the text, the same while loading and with rows, so "Text" does not move. -->
                <colgroup><col class="w-240" /><col class="w-96" /><col /><col class="w-120" /><col v-if="editable" class="w-96" /></colgroup>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                        <th scope="col" class="px-12">{{ trans('support.macros.columns.title') }}</th>
                        <th scope="col" class="px-12">{{ trans('support.macros.columns.locale') }}</th>
                        <th scope="col" class="px-12">{{ trans('support.macros.columns.body') }}</th>
                        <th scope="col" class="px-12">{{ trans('support.macros.columns.updated') }}</th>
                        <th v-if="editable" scope="col" class="w-80 px-12"><span class="sr-only">{{ trans('support.macros.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                        <template v-if="pageState === 'loading'">
                            <tr v-for="n in 6" :key="`skeleton-${n}`" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                <td class="px-12"><Skeleton shape="text" class="w-160" /></td>
                                <td class="px-12"><Skeleton class="h-20 w-24" /></td>
                                <td class="px-12"><Skeleton shape="text" class="w-3/4" /></td>
                                <td class="px-12"><Skeleton shape="text" class="w-80" /></td>
                                <td v-if="editable" class="px-12"><span class="flex items-center gap-4"><Skeleton class="size-32" /><Skeleton class="size-32" /></span></td>
                            </tr>
                        </template>
                        <template v-else>
                    <tr v-for="m in list" :key="m.id" class="h-40 border-b border-line-subtle" data-testid="ADM-27.macro">
                        <td class="px-12"><span class="line-clamp-2 text-ink" :title="`${m.title} · ${m.key}`">{{ m.title }}</span></td>
                        <td class="px-12"><Badge tone="neutral">{{ m.locale.toUpperCase() }}</Badge></td>
                        <td class="px-12"><span class="block truncate text-ink-2" :title="m.body">{{ m.body.replace(/\s+/g, ' ') }}</span></td>
                        <td class="whitespace-nowrap px-12 text-ink-3 tabular-nums" :title="formatDateTime(m.updated_at)">{{ formatDate(m.updated_at) }}</td>
                        <td v-if="editable" class="px-12">
                            <span class="flex items-center gap-4">
                                <IconButton :icon="PhPencilSimple" :label="trans('support.macros.edit')" size="sm" data-testid="ADM-27.edit" @click="open(m)" />
                                <IconButton :icon="PhTrash" :label="trans('support.macros.delete')" size="sm" variant="ghost" class="hover:text-danger" data-testid="ADM-27.delete" @click="openDelete(m)" />
                            </span>
                        </td>
                    </tr>
                        </template>
                    </tbody>
            </table>
        </ScrollRegion>

        <Drawer v-model:open="drawerOpen" :title="editing ? trans('support.macros.drawer_edit') : trans('support.macros.drawer_new')" size="lg" :dismissible="!action.processing.value" test-id="ADM-27.drawer">
            <form id="adm27-form" class="flex flex-col gap-16" novalidate @submit.prevent="save">
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0"><Field :label="trans('support.macros.fields.key')" :hint="trans('support.macros.fields.key_hint')" :error="errors.key" required><Input v-model="form.key" maxlength="60" data-testid="ADM-27.form.key" /></Field></div>
                    <div class="w-160"><Field :label="trans('support.macros.fields.locale')" required><Select v-model="localeModel" :options="localeOptions" /></Field></div>
                </div>
                <Field :label="trans('support.macros.fields.title')" :error="errors.title" required><Input v-model="form.title" maxlength="120" data-testid="ADM-27.form.title" /></Field>
                <Field :label="trans('support.macros.fields.body')" :hint="trans('support.macros.fields.body_hint')" :error="errors.body" required><Textarea v-model="form.body" :rows="8" :maxlength="5000" data-testid="ADM-27.form.body" /></Field>
                <div class="w-120"><Field :label="trans('support.macros.fields.sort')" optional><Input v-model="form.sort" inputmode="numeric" maxlength="3" /></Field></div>
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm27-form" variant="primary" :loading="action.processing.value" data-testid="ADM-27.form.save">{{ trans('support.macros.save') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('support.macros.delete_title', { title: deleting?.title ?? '' })"
            :body="trans('support.macros.delete_body')"
            :confirm-label="trans('support.macros.delete')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-27.delete-confirm"
            @confirm="destroy"
        />
    </div>
</template>
