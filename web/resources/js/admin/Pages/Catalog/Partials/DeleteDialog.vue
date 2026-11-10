<script setup lang="ts">
import { PhArrowsMerge, PhPower } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import DialogError from '../../../Components/patterns/DialogError.vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Button, Dialog, Field, Input, Skeleton, Textarea } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { formatNumber } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import { fetchImpact, REFERENCE_KINDS, useCatalogWrite, type CatalogLevel, type Impact } from '../shared';

/**
 * ADM-14 / ADM-16 "Löschen" (m3.3 §1; catalog.manage, ⚿, reason, typed confirmation): only an entry nothing points at goes, with what
 * is below it. The dialog asks the server first: a referenced entry shows what still points at it (vehicles, modifications, aliases,
 * Kollektionen) and offers to deactivate or merge instead; the server refuses the same way if that changed in between.
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ level: CatalogLevel; entry: { id: number; name: string } | null; fromRecord?: boolean; testId: string }>();
const emit = defineEmits<{ deactivate: []; merge: [] }>();

const impact = ref<Impact | null>(null);
const loadState = ref<'loading' | 'ready' | 'error'>('loading');
const typed = ref('');
const reason = ref('');
const reasonError = ref<string | null>(null);
const write = useCatalogWrite();
const failed = qaDialogFailed();
const word = computed(() => trans('ui.confirm.typed_word'));

async function load(): Promise<void> {
    if (props.entry === null) return;
    loadState.value = 'loading';
    try {
        impact.value = await fetchImpact(props.level, props.entry.id);
        loadState.value = 'ready';
    } catch {
        loadState.value = 'error';
    }
}

watch(
    open,
    (value) => {
        if (!value) return;
        typed.value = '';
        reason.value = '';
        reasonError.value = null;
        write.reset();
        void load();
    },
    { immediate: true },
);

const references = computed(() => REFERENCE_KINDS.map((kind) => ({ kind, count: impact.value?.references[kind] ?? 0 })).filter((r) => r.count > 0));
const children = computed(() => {
    const c = impact.value?.children;
    if (!c) return null;
    if (props.level === 'make' && (c.models > 0 || c.generations > 0)) return trans('catalog.delete.children_make', { models: formatNumber(c.models), generations: formatNumber(c.generations) });
    if (props.level === 'model' && c.generations > 0) return trans('catalog.delete.children_model', { generations: formatNumber(c.generations) });
    return null;
});
const refused = computed(() => impact.value !== null && impact.value.deletable === false);
const ready = computed(() => loadState.value === 'ready' && impact.value?.deletable === true);

function submit(): void {
    if (props.entry === null || !ready.value || typed.value.trim() !== word.value) return;
    const length = reason.value.trim().length;
    if (length < 10 || length > 1000) {
        reasonError.value = trans('ui.confirm.reason_length');
        return;
    }
    reasonError.value = null;
    const url = routeOr('admin.catalog.entries.destroy', `/admin/catalog/entries/${props.level}/${props.entry.id}`, { level: props.level, id: props.entry.id });
    write.run('delete', url, { reason: reason.value.trim(), from: props.fromRecord ? 'record' : 'list' }, { sensitive: true, onSuccess: () => (open.value = false) });
}

const serverError = computed(() => (failed ? trans('ui.state.server_error') : write.error.value));
const formId = `${props.testId}-form`;
</script>

<template>
    <Dialog v-model:open="open" :title="trans(refused ? 'catalog.delete.refused_title' : 'catalog.delete.title', { name: entry?.name ?? '' })" size="sm" role="alertdialog" :dismissible="!write.processing.value" :test-id="testId">
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <div v-if="loadState === 'loading'" class="flex flex-col gap-8" aria-busy="true"><Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-240" /><Skeleton class="h-40 w-full" /></div>
            <StateBlock v-else-if="loadState === 'error'" kind="error" :title="trans('catalog.delete.load_error')" :body="trans('catalog.error_body')" @retry="load" />
            <template v-else-if="impact && !impact.deletable">
                <p class="text-supporting text-ink-2" :data-testid="`${testId}.referenced`">{{ trans('catalog.delete.referenced') }}</p>
                <ul class="flex flex-col rounded-sm border border-line-subtle">
                    <li v-for="r in references" :key="r.kind" class="flex h-40 items-center justify-between gap-12 border-t border-line-subtle px-12 first:border-t-0">
                        <span class="text-supporting text-ink-2">{{ trans(`catalog.references.labels.${r.kind}`) }}</span>
                        <span class="text-label-s text-ink tabular-nums">{{ formatNumber(r.count) }}</span>
                    </li>
                </ul>
                <p class="text-supporting text-ink-2">{{ trans(level === 'brand' ? 'catalog.delete.instead_brand' : 'catalog.delete.instead') }}</p>
                <!-- DQ-592: the two ways out sit with their explanation; the footer only closes. -->
                <div class="flex flex-wrap items-center gap-8">
                    <Button v-if="level !== 'brand'" size="sm" variant="secondary" :icon="PhPower" :data-testid="`${testId}.deactivate`" @click="emit('deactivate')">{{ trans('catalog.actions.deactivate') }}</Button>
                    <Button size="sm" variant="secondary" :icon="PhArrowsMerge" :data-testid="`${testId}.merge`" @click="emit('merge')">{{ trans('catalog.actions.merge') }}</Button>
                </div>
            </template>
            <template v-else-if="impact">
                <p class="text-supporting text-ink-2" :data-testid="`${testId}.unreferenced`">{{ trans('catalog.delete.body') }}</p>
                <p v-if="children" class="rounded-sm border border-line px-12 py-8 text-supporting text-ink-2">{{ children }}</p>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="reasonError ?? write.errors.value.reason ?? null" required>
                    <Textarea v-model="reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
                </Field>
                <Field :label="trans('ui.confirm.typed_label', { word })">
                    <Input v-model="typed" autocomplete="off" spellcheck="false" :data-testid="`${testId}.typed`" />
                </Field>
            </template>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="write.processing.value" data-dialog-cancel @click="open = false">{{ trans(refused ? 'ui.actions.close' : 'ui.actions.cancel') }}</Button>
            <Button v-if="!refused" type="submit" :form="formId" variant="danger" :disabled="!ready || typed.trim() !== word" :loading="write.processing.value" :data-testid="`${testId}.confirm`">
                {{ trans('catalog.actions.delete') }}
            </Button>
        </template>
    </Dialog>
</template>
