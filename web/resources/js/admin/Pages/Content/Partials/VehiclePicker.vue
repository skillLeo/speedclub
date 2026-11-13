<script setup lang="ts">
import { PhCar, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { onBeforeUnmount, ref, watch } from 'vue';
import VehicleThumb from '../../../Components/patterns/VehicleThumb.vue';
import { Dialog, EmptyQueue, Field, Input, Skeleton } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { isCancelled, requestJson } from '../../../lib/http';
import { routeOr } from '../../../lib/routes';
import type { VehicleSummary } from './home';

/** ADM-29: find a published, non-private build by make, model, slug, public id or the owner's @username. */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ title: string; exclude?: string[]; failed?: boolean; testId?: string }>(), { exclude: () => [], failed: false, testId: 'ADM-29.picker' });
const emit = defineEmits<{ choose: [vehicle: VehicleSummary] }>();

const term = ref('');
const results = ref<VehicleSummary[]>([]);
const loading = ref(false);
const failed = ref(props.failed);
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

function search(): void {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    loading.value = true;
    failed.value = false;
    // Only the latest search speaks: one aborted for the next keystroke settles after that one has started.
    requestJson<{ data: VehicleSummary[] }>('get', routeOr('admin.content.home.vehicles', '/admin/content/home/vehicles'), { q: term.value }, mine.signal)
        .then((answer) => {
            if (controller === mine) results.value = answer.data;
        })
        .catch((error: unknown) => {
            if (controller === mine && !isCancelled(error)) failed.value = true;
        })
        .finally(() => {
            if (controller === mine) loading.value = false;
        });
}

watch(open, (value) => {
    if (value && !props.failed) {
        term.value = '';
        search();
    }
}, { immediate: true });
watch(term, () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(search, 250);
});
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
});

function pick(vehicle: VehicleSummary): void {
    emit('choose', vehicle);
    open.value = false;
}
</script>

<template>
    <Dialog v-model:open="open" :title="title" :description="trans('content.picker.description')" size="md" :test-id="testId">
        <div class="flex flex-col gap-12">
            <Field :label="trans('content.picker.search')" hide-label>
                <Input v-model="term" size="md" maxlength="80" :placeholder="trans('content.picker.placeholder')" :data-testid="`${testId}.search`">
                    <template #leading><PhMagnifyingGlass :size="16" aria-hidden="true" /></template>
                </Input>
            </Field>
            <p v-if="failed" class="text-admin-base text-danger" role="alert">{{ trans('content.picker.failed') }}</p>
            <ul v-else-if="loading && results.length === 0" class="flex flex-col" aria-hidden="true">
                <li v-for="n in 5" :key="n" class="flex h-40 items-center gap-12 border-b border-line-subtle"><Skeleton class="h-24 w-32 rounded-xs" /><Skeleton shape="text" class="w-240" /></li>
            </ul>
            <EmptyQueue v-else-if="results.length === 0" variant="quiet" compact :icon="PhCar" :title="trans('content.picker.none')" :body="trans('content.picker.none_body')" />
            <ul v-else class="flex max-h-320 flex-col overflow-y-auto" :aria-label="trans('content.picker.results')" :aria-busy="loading">
                <li v-for="vehicle in results" :key="vehicle.id">
                    <button
                        type="button"
                        :class="[focusRing, 'flex min-h-40 w-full items-center gap-12 border-b border-line-subtle px-4 py-4 text-left hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3']"
                        :disabled="exclude.includes(vehicle.id)"
                        :data-testid="`${testId}.result`"
                        @click="pick(vehicle)"
                    >
                        <VehicleThumb :src="vehicle.thumb" />
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-admin-base text-ink">{{ vehicle.title }}</span>
                            <span class="text-admin-base text-ink-3">{{ vehicle.owner ? `@${vehicle.owner}` : trans('content.home.no_owner') }}<template v-if="exclude.includes(vehicle.id)"> · {{ trans('content.picker.taken') }}</template></span>
                        </span>
                    </button>
                </li>
            </ul>
        </div>
    </Dialog>
</template>
