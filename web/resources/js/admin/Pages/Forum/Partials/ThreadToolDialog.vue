<script setup lang="ts">
import { PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { Button, Combobox, Dialog, Field, Input } from '../../../Components/ui';
import { categoryOptions, threadIdFrom, type CategoryOption, type ToolMode } from '../shared';

/**
 * The staff tools of a thread that need a dialog (m5.8-contract §6): Verschieben (a category),
 * Zusammenführen (the target thread: one of the published threads on the list, or a pasted link or id) and the staff correction of the
 * Lösung (set a reply, or clear it). Pin and lock run without a dialog. Emits the payload; the pane posts it.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        mode: ToolMode;
        threadTitle: string;
        categoryId: number | null;
        categories: CategoryOption[];
        /** Merge targets offered from the list on screen (published threads, never the source). */
        suggestions?: { id: string; title: string }[];
        /** Solution: the reply to mark (null = clear the solution) and its excerpt. */
        solution?: { postId: string | null; author: string | null; excerpt: string } | null;
        processing?: boolean;
        error?: string | null;
        testId: string;
    }>(),
    { suggestions: () => [], solution: null, processing: false, error: null },
);
const emit = defineEmits<{ submit: [payload: Record<string, string | number | null>] }>();

const category = ref<string | undefined>(undefined);
const target = ref<string | undefined>(undefined);
const pasted = ref('');
const errors = ref<Partial<Record<string, string>>>({});

watch(
    open,
    (value) => {
        if (!value) return;
        category.value = undefined;
        target.value = undefined;
        pasted.value = '';
        errors.value = {};
    },
    { immediate: true },
);

const options = computed(() => categoryOptions(props.categories, props.categoryId));
const targets = computed(() => props.suggestions.map((s) => ({ value: s.id, label: s.title })));
const title = computed(() => {
    if (props.mode === 'solution') return trans(props.solution?.postId ? 'forum.tools.solution_title' : 'forum.tools.solution_clear_title');
    return trans(`forum.tools.${props.mode}_title`, { title: props.threadTitle });
});
const description = computed(() => {
    if (props.mode === 'solution') return trans(props.solution?.postId ? 'forum.tools.solution_body' : 'forum.tools.solution_clear_body');
    return trans(`forum.tools.${props.mode}_body`);
});
const confirmLabel = computed(() => trans(props.mode === 'solution' ? (props.solution?.postId ? 'forum.tools.solution_submit' : 'forum.tools.solution_clear_submit') : `forum.tools.${props.mode}_submit`));

function submit(): void {
    const next: Partial<Record<string, string>> = {};
    let payload: Record<string, string | number | null> = {};
    if (props.mode === 'move') {
        if (category.value === undefined) next.category = trans('forum.tools.category_required');
        else payload = { category_id: Number(category.value) };
    } else if (props.mode === 'merge') {
        const id = pasted.value.trim() !== '' ? threadIdFrom(pasted.value) : (target.value ?? null);
        if (pasted.value.trim() !== '' && id === null) next.target = trans('forum.tools.target_invalid');
        else if (id === null) next.target = trans('forum.tools.target_required');
        else payload = { into_thread_id: id };
    } else {
        payload = { post_id: props.solution?.postId ?? null };
    }
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    emit('submit', payload);
}
</script>

<template>
    <Dialog v-model:open="open" :title="title" :description="description" size="md" :dismissible="!processing" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <Field v-if="mode === 'move'" :label="trans('forum.tools.category')" :error="errors.category" required>
                <Combobox v-model="category" :options="options" :placeholder="trans('forum.tools.category_placeholder')" :data-testid="`${testId}.category`" />
            </Field>
            <template v-else-if="mode === 'merge'">
                <Field v-if="targets.length > 0" :label="trans('forum.tools.target')" :hint="trans('forum.tools.target_hint')" :error="pasted.trim() === '' ? errors.target : undefined">
                    <Combobox v-model="target" :options="targets" :placeholder="trans('forum.tools.target_placeholder')" :data-testid="`${testId}.target`" />
                </Field>
                <Field :label="trans('forum.tools.target_paste')" :hint="trans('forum.tools.target_paste_hint')" :error="pasted.trim() !== '' || targets.length === 0 ? errors.target : undefined" :optional="targets.length > 0" :required="targets.length === 0">
                    <Input v-model="pasted" maxlength="300" autocomplete="off" spellcheck="false" :data-testid="`${testId}.paste`" />
                </Field>
            </template>
            <blockquote v-else-if="solution?.postId" class="flex flex-col gap-4 border-l-2 border-line-strong pl-12" :data-testid="`${testId}.post`">
                <span class="sc-key text-caption text-ink-3">{{ solution.author ? `@${solution.author}` : trans('forum.pane.deleted_author') }}</span>
                <span class="line-clamp-3 text-admin-base text-ink">{{ solution.excerpt }}</span>
            </blockquote>
        </form>
        <template #footer>
            <p v-if="error" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" role="alert">
                <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ error }}
            </p>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" variant="primary" :loading="processing" :data-testid="`${testId}.confirm`">{{ confirmLabel }}</Button>
        </template>
    </Dialog>
</template>
