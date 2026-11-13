<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { ref, watch } from 'vue';
import { Field, SegmentedControl, Skeleton, Textarea } from '../../../Components/ui';
import { requestJson } from '../../../lib/http';
import { routeOr } from '../../../lib/routes';

/**
 * Markdown with the preview members see: the server renders it with SafeMarkdown (the renderer of SET-17/18, the help screens and the
 * Blade pages; HTML in the source is escaped, unsafe links dropped), so what is previewed is what goes live.
 */
const model = defineModel<string>({ required: true });
const props = withDefaults(defineProps<{ label: string; hint?: string; error?: string | null; rows?: number; maxlength?: number; disabled?: boolean; testId: string; initialView?: 'write' | 'preview' }>(), {
    hint: undefined,
    error: null,
    rows: 18,
    maxlength: 200000,
    disabled: false,
    initialView: 'write',
});

const view = ref<string>(props.initialView);
const html = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);
let rendered: string | null = null;
// The long-form type of the legal and help screens (03 §4), on the rendered elements.
const prose =
    'sc-prose max-w-720 text-admin-base text-ink-2 [&_a]:text-ink [&_a]:underline [&_h1]:mb-12 [&_h1]:text-title-2 [&_h1]:text-ink [&_h2]:mb-8 [&_h2]:mt-24 [&_h2]:text-headline [&_h2]:text-ink ' +
    '[&_h3]:mb-4 [&_h3]:mt-16 [&_h3]:text-headline [&_h3]:text-ink [&_li]:mb-4 [&_ol]:mb-12 [&_ol]:list-decimal [&_ol]:pl-20 [&_p]:mb-12 [&_strong]:text-ink [&_ul]:mb-12 [&_ul]:list-disc [&_ul]:pl-20';

function render(): void {
    if (rendered === model.value && html.value !== null) return;
    const source = model.value;
    loading.value = true;
    failed.value = false;
    requestJson<{ html: string }>('post', routeOr('admin.content.legal.preview', '/admin/content/legal/preview'), { body_md: source })
        .then((answer) => {
            html.value = answer.html;
            rendered = source;
        })
        .catch(() => (failed.value = true))
        .finally(() => (loading.value = false));
}
watch(view, (value) => value === 'preview' && render(), { immediate: true });
</script>

<template>
    <div class="flex flex-col gap-8" :data-testid="testId">
        <div class="flex items-center justify-between gap-12">
            <span class="text-admin-base-strong text-ink">{{ label }}</span>
            <SegmentedControl v-model="view" :label="trans('content.markdown.view')" :options="[{ value: 'write', label: trans('content.markdown.write') }, { value: 'preview', label: trans('content.markdown.preview') }]" />
        </div>
        <Field v-show="view === 'write'" :label="label" :hint="hint" :error="error" hide-label>
            <Textarea v-model="model" :rows="rows" :maxlength="maxlength" :disabled="disabled" spellcheck="true" :data-testid="`${testId}.text`" />
        </Field>
        <div v-if="view === 'preview'" class="min-h-240 rounded-sm border border-line bg-surface px-24 py-16" :data-testid="`${testId}.preview`" aria-live="polite">
            <div v-if="loading" class="flex flex-col gap-8" aria-hidden="true"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-480" /></div>
            <p v-else-if="failed" class="text-admin-base text-danger" role="alert">{{ trans('content.markdown.failed') }}</p>
            <!-- SafeMarkdown output: source HTML escaped, unsafe links removed on the server. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else :class="prose" v-html="html" />
        </div>
    </div>
</template>
