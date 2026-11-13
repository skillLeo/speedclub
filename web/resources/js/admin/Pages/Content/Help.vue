<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhEye, PhEyeSlash, PhLifebuoy, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DialogError from '../../Components/patterns/DialogError.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Drawer, EmptyQueue, Field, IconButton, Input, SegmentedControl, Select, Skeleton, StatusPill } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { usePermissions } from '../../lib/permissions';
import { formatDate, formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import MarkdownEditor from './Partials/MarkdownEditor.vue';

/**
 * ADM-32 Hilfe (06 §3; Hilfe in der App und WEB-10): the help articles per language with category, order and state. Content editors
 * write and publish; an article that is live changes for members as soon as it is saved, so editing one needs content.publish too.
 * Deleting asks for a reason ⚿.
 */
interface Article {
    id: number;
    key: string;
    locale: 'de' | 'en';
    category: string | null;
    title: string;
    body_md: string;
    sort: number;
    published: boolean;
    updated_at: string | null;
}

const props = defineProps<{ articles: Article[]; categories: string[] }>();
const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const mayEdit = computed(() => can('content.edit'));
const mayPublish = computed(() => can('content.publish'));

const locale = ref('all');
const list = computed(() => (pageState.value === 'empty' ? [] : props.articles.filter((article) => locale.value === 'all' || article.locale === locale.value)));
const localeOptions = computed(() => [{ value: 'all', label: trans('content.help.all') }, { value: 'de', label: trans('content.locales.de') }, { value: 'en', label: trans('content.locales.en') }]);

const action = useAdminAction();
const editing = ref<Article | null>(null);
const drawerOpen = ref(false);
const form = reactive({ key: '', locale: 'de', category: '', title: '', body_md: '', sort: '0' });
const errors = ref<Record<string, string>>({});
function open(article: Article | null): void {
    editing.value = article;
    Object.assign(form, article === null ? { key: '', locale: 'de', category: '', title: '', body_md: '', sort: '0' } : { ...article, category: article.category ?? '', sort: String(article.sort) });
    errors.value = {};
    action.reset();
    drawerOpen.value = true;
}
if (qaDialog() === 'edit' && props.articles[0]) open(props.articles[0]);
if (qaDialog() === 'new') open(null);
watch(drawerOpen, (value) => !value && (editing.value = null));
const editLocked = computed(() => editing.value?.published === true && !mayPublish.value);

function save(): void {
    const next: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(form.key)) next.key = trans('content.help.key_hint');
    if (form.title.trim() === '') next.title = trans('content.help.title_required');
    if (form.body_md.trim() === '') next.body_md = trans('content.help.body_required');
    if (form.category !== '' && !/^[a-z][a-z0-9_]{0,31}$/.test(form.category)) next.category = trans('content.help.category_hint');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const data = { ...form, category: form.category === '' ? null : form.category, sort: Number(form.sort) || 0 };
    const url = editing.value ? routeOr('admin.content.help.update', `/admin/content/help/${editing.value.id}`, { article: editing.value.id }) : routeOr('admin.content.help.store', '/admin/content/help');
    action.run(editing.value ? 'patch' : 'post', url, data, { onSuccess: () => (drawerOpen.value = false) });
}
function setPublished(article: Article, published: boolean): void {
    action.run('post', routeOr('admin.content.help.published', `/admin/content/help/${article.id}/published`, { article: article.id }), { published });
}

const deleting = ref<Article | null>(null);
const deleteOpen = ref(qaDialog() === 'delete');
if (qaDialog() === 'delete') deleting.value = props.articles[0] ?? null;
function askDelete(article: Article): void {
    deleting.value = article;
    action.reset();
    deleteOpen.value = true;
}
function destroy(reason: string | null): void {
    if (!deleting.value) return;
    action.run('delete', routeOr('admin.content.help.destroy', `/admin/content/help/${deleting.value.id}`, { article: deleting.value.id }), { reason }, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
const localeModel = computed({ get: () => form.locale, set: (value: string | undefined) => (form.locale = value === 'en' ? 'en' : 'de') });
const formLocales = computed(() => (['de', 'en'] as const).map((value) => ({ value, label: trans(`content.locales.${value}`) })));
// DQ-630: "–" for an article without a category, one line per cell.
const categoryLabel = (category: string | null): string => category ?? '–';
</script>

<template>
    <Head :title="trans('content.help.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-32" :data-qa-state="pageState">
        <PageHeader :title="trans('content.help.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.help.intro')">
            <template v-if="mayEdit" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-32.new" @click="open(null)">{{ trans('content.help.new') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.help.error')" :body="trans('ui.state.error_body')" test-id="ADM-32.error" @retry="router.reload()" />
        <template v-else>
            <SegmentedControl v-model="locale" :options="localeOptions" :label="trans('content.help.filter')" class="self-start" />
            <EmptyQueue v-if="pageState !== 'loading' && list.length === 0" variant="first" :icon="PhLifebuoy" :title="trans('content.help.empty_title')" :body="trans('content.help.empty_body')" data-testid="ADM-32.empty" />
            <ScrollRegion v-else :label="trans('content.help.caption')">
                <table class="w-full text-admin-base" data-testid="ADM-32.table">
                    <caption class="sr-only">{{ trans('content.help.caption') }}</caption>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-admin-base-strong text-ink-2">
                            <th scope="col" class="px-12">{{ trans('content.help.columns.title') }}</th>
                            <th scope="col" class="px-12">{{ trans('content.help.columns.locale') }}</th>
                            <th scope="col" class="px-12">{{ trans('content.help.columns.category') }}</th>
                            <th scope="col" class="px-12 text-right">{{ trans('content.help.columns.sort') }}</th>
                            <th scope="col" class="px-12">{{ trans('content.help.columns.state') }}</th>
                            <th scope="col" class="px-12">{{ trans('content.help.columns.updated') }}</th>
                            <th v-if="mayEdit" scope="col" class="w-120 px-12"><span class="sr-only">{{ trans('content.help.columns.actions') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-if="pageState === 'loading'">
                            <tr v-for="n in 8" :key="n" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                <td v-for="c in mayEdit ? 7 : 6" :key="c" class="px-12"><Skeleton shape="text" :class="c === 1 ? 'w-240' : 'w-64'" /></td>
                            </tr>
                        </template>
                        <tr v-for="article in pageState === 'loading' ? [] : list" :key="article.id" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-32.row">
                            <td class="px-12 py-4">
                                <span class="block text-ink">{{ article.title }}</span>
                                <span class="sc-key block text-admin-base text-ink-3">{{ article.key }}</span>
                            </td>
                            <td class="px-12"><Badge tone="neutral">{{ article.locale.toUpperCase() }}</Badge></td>
                            <td class="whitespace-nowrap px-12" :class="article.category ? 'text-ink-2' : 'text-ink-3'">{{ categoryLabel(article.category) }}</td>
                            <td class="px-12 text-right tabular-nums text-ink-2">{{ article.sort }}</td>
                            <td class="whitespace-nowrap px-12"><StatusPill :tone="article.published ? 'success' : 'neutral'" :label="article.published ? trans('content.help.published') : trans('content.help.unpublished')" /></td>
                            <td class="whitespace-nowrap px-12 tabular-nums text-ink-3" :title="formatDateTime(article.updated_at)">{{ formatDate(article.updated_at) }}</td>
                            <td v-if="mayEdit" class="px-12">
                                <span class="flex items-center gap-4">
                                    <IconButton :icon="PhPencilSimple" size="sm" :label="trans('content.help.edit', { title: article.title })" :disabled="article.published && !mayPublish" data-testid="ADM-32.edit" @click="open(article)" />
                                    <IconButton v-if="mayPublish" :icon="article.published ? PhEyeSlash : PhEye" size="sm" :label="article.published ? trans('content.help.unpublish', { title: article.title }) : trans('content.help.publish', { title: article.title })" data-testid="ADM-32.toggle" @click="setPublished(article, !article.published)" />
                                    <IconButton v-if="mayPublish" :icon="PhTrash" size="sm" variant="ghost" class="hover:text-danger" :label="trans('content.help.delete', { title: article.title })" data-testid="ADM-32.delete" @click="askDelete(article)" />
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </template>

        <Drawer v-model:open="drawerOpen" :title="editing ? trans('content.help.edit_title') : trans('content.help.new')" :description="editing?.published ? trans('content.help.live_note') : undefined" size="lg" :dismissible="!action.processing.value" test-id="ADM-32.drawer">
            <form id="adm32-form" class="flex flex-col gap-16" novalidate @submit.prevent="save">
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0"><Field :label="trans('content.help.fields.key')" :hint="trans('content.help.key_hint')" :error="errors.key" required><Input v-model="form.key" maxlength="64" :disabled="editLocked" data-testid="ADM-32.form.key" /></Field></div>
                    <div class="w-160"><Field :label="trans('content.help.fields.locale')" required><Select v-model="localeModel" :options="formLocales" :disabled="editLocked" /></Field></div>
                </div>
                <Field :label="trans('content.help.fields.title')" :error="errors.title" required><Input v-model="form.title" maxlength="160" :disabled="editLocked" data-testid="ADM-32.form.title" /></Field>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0"><Field :label="trans('content.help.fields.category')" :hint="trans('content.help.category_hint')" :error="errors.category" optional><Input v-model="form.category" maxlength="32" list="adm32-categories" :disabled="editLocked" /></Field></div>
                    <div class="w-160"><Field :label="trans('content.help.fields.sort')" optional><Input v-model="form.sort" inputmode="numeric" maxlength="5" tnum :disabled="editLocked" /></Field></div>
                </div>
                <datalist id="adm32-categories"><option v-for="category in categories" :key="category" :value="category" /></datalist>
                <MarkdownEditor v-model="form.body_md" :label="trans('content.help.fields.body')" :error="errors.body_md" :rows="14" :maxlength="20000" :disabled="editLocked" test-id="ADM-32.markdown" />
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm32-form" variant="primary" :loading="action.processing.value" :disabled="editLocked" data-testid="ADM-32.form.save">{{ trans('content.help.save') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('content.help.delete_title', { title: deleting?.title ?? '' })"
            :body="trans('content.help.delete_body')"
            :confirm-label="trans('content.help.delete_confirm')"
            reason
            :processing="action.processing.value"
            :error="serverError"
            test-id="ADM-32.delete-dialog"
            @confirm="destroy"
        />
    </div>
</template>
