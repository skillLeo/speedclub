<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import DialogError from '../../../Components/patterns/DialogError.vue';
import { Button, Combobox, Dialog, Field, Skeleton, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { formatNumber } from '../../../lib/format';
import { useCatalogWrite } from '../shared';
import { productWriteUrl, type ProductDetail } from './products';

/**
 * ADM-57 "Zusammenführen" (09 §8.9; catalog.manage, ⚿, reason): a duplicate part hands its mods to the survivor (active, same category;
 * the same brand first), its name becomes one of the survivor's spellings and it is archived. The candidates load when the dialog opens.
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ product: ProductDetail; candidates?: { value: string; label: string; mods: number }[]; testId: string }>();

const target = ref<string | undefined>(undefined);
const reason = ref('');
const reasonError = ref<string | null>(null);
const loading = ref(false);
const loadFailed = ref(false);
const write = useCatalogWrite();
const failed = qaDialogFailed();

function load(): void {
    loadFailed.value = false;
    router.reload({
        only: ['mergeCandidates'],
        onStart: () => (loading.value = true),
        onFinish: () => (loading.value = false),
        onError: () => (loadFailed.value = true),
        onNetworkError: () => {
            loadFailed.value = true;
            return false;
        },
    });
}

watch(
    open,
    (value) => {
        if (!value) return;
        target.value = undefined;
        reason.value = '';
        reasonError.value = null;
        write.reset();
        if (props.candidates === undefined) load();
    },
    { immediate: true },
);

const options = computed<SelectOption[]>(() => (props.candidates ?? []).map((c) => ({ value: c.value, label: transChoice('catalog.products.merge.option', c.mods, { name: c.label, count: formatNumber(c.mods) }) })));
const chosen = computed(() => props.candidates?.find((c) => c.value === target.value) ?? null);

function submit(): void {
    if (chosen.value === null) return;
    const length = reason.value.trim().length;
    if (length < 10 || length > 1000) {
        reasonError.value = trans('ui.confirm.reason_length');
        return;
    }
    reasonError.value = null;
    write.run('post', productWriteUrl(props.product.id, 'merge'), { into: chosen.value.value, reason: reason.value.trim() }, { sensitive: true, onSuccess: () => (open.value = false) });
}

const serverError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.into ?? write.error.value)));
const formId = `${props.testId}-form`;
</script>

<template>
    <Dialog v-model:open="open" :title="trans('catalog.products.merge.title', { name: product.name })" :description="trans('catalog.products.merge.body')" size="md" :dismissible="!write.processing.value" :test-id="testId">
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <div v-if="loading && candidates === undefined" class="flex flex-col gap-8" aria-busy="true" :data-testid="`${testId}.loading`">
                <Skeleton shape="text" class="w-120" />
                <Skeleton class="h-40 w-full" />
            </div>
            <p v-else-if="loadFailed" class="text-admin-base text-danger" role="alert" :data-testid="`${testId}.load-error`">
                {{ trans('catalog.products.merge.load_error') }}
                <Button size="sm" variant="ghost" @click="load">{{ trans('ui.state.retry') }}</Button>
            </p>
            <p v-else-if="(candidates ?? []).length === 0" class="text-admin-base text-ink-2" :data-testid="`${testId}.no-candidates`">{{ trans('catalog.products.merge.none') }}</p>
            <template v-else>
                <Field :label="trans('catalog.products.merge.survivor')" :hint="trans('catalog.products.merge.survivor_hint')" required>
                    <Combobox v-model="target" :options="options" :placeholder="trans('catalog.products.merge.placeholder')" :data-testid="`${testId}.survivor`" />
                </Field>
                <p v-if="chosen" class="rounded-sm border border-line px-12 py-8 text-admin-base text-ink-2" :data-testid="`${testId}.outcome`">
                    {{ transChoice('catalog.products.merge.outcome', product.mods, { count: formatNumber(product.mods), survivor: chosen.label, name: product.name }) }}
                </p>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="reasonError ?? write.errors.value.reason ?? null" required>
                    <Textarea v-model="reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
                </Field>
            </template>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="write.processing.value" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="danger" :disabled="chosen === null" :loading="write.processing.value" :data-testid="`${testId}.confirm`">{{ trans('catalog.products.merge.confirm') }}</Button>
        </template>
    </Dialog>
</template>
