<script setup lang="ts">
import { PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { Button, ConfirmDialog } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { formatDate } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import { useCatalogWrite } from '../shared';

/**
 * M5.9 (m5.9-contract §8, lead D-5): the generations of a model that have a cached AI spec suggestion ("KI-Herstellerangaben vorhanden
 * (seit …)"). With catalog.manage each row offers "KI-Herstellerangaben löschen": a confirm dialog (⚿ like every
 * catalogue delete) → DELETE …/entries/generation/{id}/ai-specs. Nothing renders while no generation has one. Test ids: `<testId>`,
 * `.row`, `.delete`, `.dialog`.
 */
export interface AiSpecsGeneration {
    id: number;
    name: string;
    ai_specs: { exists: boolean; created_at: string | null };
}

const props = defineProps<{ generations: AiSpecsGeneration[]; canManage: boolean; testId: string; openFirst?: boolean }>();

const rows = computed(() => props.generations.filter((g) => g.ai_specs.exists));
const target = ref<AiSpecsGeneration | null>(props.openFirst === true ? (rows.value[0] ?? null) : null);
const open = computed({
    get: () => target.value !== null,
    set: (value: boolean) => {
        if (!value) target.value = null;
    },
});
const write = useCatalogWrite();
const failed = qaDialogFailed();

function ask(row: AiSpecsGeneration): void {
    write.reset();
    target.value = row;
}

function confirm(): void {
    const row = target.value;
    if (row === null) return;
    const url = routeOr('admin.catalog.entries.ai-specs.destroy', `/admin/catalog/entries/generation/${row.id}/ai-specs`, { generation: row.id });
    write.run('delete', url, {}, { sensitive: true, onSuccess: () => (target.value = null) });
}
</script>

<template>
    <section v-if="rows.length > 0" class="flex flex-col gap-12" :aria-labelledby="`${testId}-title`" :data-testid="testId">
        <div class="flex flex-col gap-4">
            <h2 :id="`${testId}-title`" class="text-headline text-ink">{{ trans('catalog.ai_specs.title') }}</h2>
            <p class="max-w-720 text-admin-base text-ink-2">{{ trans('catalog.ai_specs.intro') }}</p>
        </div>
        <ul class="flex flex-col rounded-sm border border-line-subtle" :aria-label="trans('catalog.ai_specs.caption')">
            <li
                v-for="row in rows"
                :key="row.id"
                class="flex min-h-40 flex-wrap items-center justify-between gap-x-12 gap-y-4 border-t border-line-subtle px-12 py-4 first:border-t-0"
                :data-testid="`${testId}.row`"
            >
                <span class="flex min-w-0 flex-wrap items-baseline gap-x-8">
                    <span :id="`${testId}-name-${row.id}`" class="text-admin-base-strong text-ink">{{ row.name }}</span>
                    <span class="text-admin-base text-ink-2 tabular-nums">{{ trans('catalog.ai_specs.present', { date: formatDate(row.ai_specs.created_at) }) }}</span>
                </span>
                <Button
                    v-if="canManage"
                    size="sm"
                    variant="destructive-ghost"
                    :icon="PhTrash"
                    :aria-label="trans('catalog.ai_specs.delete_for', { name: row.name })"
                    :data-testid="`${testId}.delete`"
                    @click="ask(row)"
                >
                    {{ trans('catalog.ai_specs.delete_short') }}
                </Button>
            </li>
        </ul>
        <ConfirmDialog
            v-if="canManage"
            v-model:open="open"
            :title="trans('catalog.ai_specs.dialog_title', { name: target?.name ?? '' })"
            :body="trans('catalog.ai_specs.dialog_body')"
            :confirm-label="trans('catalog.ai_specs.delete')"
            tone="danger"
            :processing="write.processing.value"
            :error="failed ? trans('ui.state.server_error') : write.error.value"
            :test-id="`${testId}.dialog`"
            @confirm="confirm"
        />
    </section>
</template>
