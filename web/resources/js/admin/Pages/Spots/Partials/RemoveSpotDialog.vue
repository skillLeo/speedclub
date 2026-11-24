<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Button, Dialog } from '../../../Components/ui';
import { formatNumber } from '../../../lib/format';

/**
 * "Spot entfernen" for one spot or a selection (ADM-62): a plain confirmation (ADR-540: no internal reason field). The spotter is not
 * told (no member notice, so no DSA statement of reasons). The parent posts on `confirm` and closes the dialog or sets `error`.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ count?: number; max?: number; processing?: boolean; error?: string | null; testId: string }>(), { count: 1, max: 50, processing: false, error: null });
const emit = defineEmits<{ confirm: [] }>();

const many = computed(() => props.count > 1);
</script>

<template>
    <Dialog
        v-model:open="open"
        :title="many ? trans('spots.remove.title_many', { count: formatNumber(count) }) : trans('spots.remove.title')"
        :description="many ? trans('spots.remove.body_many', { max: formatNumber(max) }) : trans('spots.remove.body')"
        size="sm"
        role="alertdialog"
        :test-id="testId"
        :dismissible="!processing"
    >
        <p v-if="error" class="text-admin-base text-danger" role="alert" :data-testid="`${testId}.error`">{{ error }}</p>
        <template #footer>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button variant="danger" :loading="processing" :data-testid="`${testId}.confirm`" @click="emit('confirm')">
                {{ many ? trans('spots.actions.remove_selected') : trans('spots.actions.remove') }}
            </Button>
        </template>
    </Dialog>
</template>
