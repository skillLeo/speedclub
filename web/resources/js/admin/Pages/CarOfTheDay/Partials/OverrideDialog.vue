<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhCar } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import VehicleThumb from '../../../Components/patterns/VehicleThumb.vue';
import { Button, Dialog, Field } from '../../../Components/ui';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../../composables/recentPassword';
import VehiclePicker from '../../Content/Partials/VehiclePicker.vue';
import type { VehicleSummary } from '../../Content/Partials/home';
import { overrideUrl } from '../shared';

/**
 * ADM-64 "Anderes Auto festlegen": the car (the ADM-29 picker: published, non-private builds), ⚿.
 * OverrideCarOfTheDay decides what counts (public, not ghost, a guest may see it in a list, never a sample in production); its refusals
 * come back as field errors under the car (`vehicle_id`) or the day (`day`).
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ day: string; dayLabel: string; initial?: VehicleSummary | null }>();

const page = usePage();
const chosen = ref<VehicleSummary | null>(null);
const errors = ref<Record<string, string>>({});
const processing = ref(false);
const pickerOpen = ref(false);

watch(
    open,
    (value) => {
        if (!value) return;
        chosen.value = props.initial ?? null;
        errors.value = {};
    },
    { immediate: true },
);

const ready = computed(() => chosen.value !== null);

function choose(vehicle: VehicleSummary): void {
    chosen.value = vehicle;
    errors.value = { ...errors.value, vehicle_id: '' };
}

function submit(): void {
    if (!ready.value || chosen.value === null) {
        errors.value = { vehicle_id: trans('gift.cotd.override.none') };
        return;
    }
    const data = { vehicle_id: chosen.value.id };
    const go = (): void => {
        router.post(overrideUrl(props.day), data, {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (processing.value = true),
            onFinish: () => (processing.value = false),
            onSuccess: (next) => {
                if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) {
                    // Client round 7: the server found the confirmation stale (ADR-215). Repeat this request after the password, not the shell's
                    // bare copy of it, so its own callbacks run (close, saved state, field errors) instead of leaving the form as if unsaved.
                    confirmPasswordFirst(go);
                    return;
                }
                open.value = false;
            },
            onError: (bag) => (errors.value = bag),
        });
    };
    if (passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) go();
    else confirmPasswordFirst(go);
}
const carError = computed(() => errors.value.vehicle_id || errors.value.day || null);
</script>

<template>
    <Dialog v-model:open="open" :title="trans('gift.cotd.override.title', { day: dayLabel })" :description="trans('gift.cotd.override.body')" size="md" test-id="ADM-64.override-dialog">
        <form class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <Field :label="trans('gift.cotd.override.car')" :error="carError" required>
                <div class="flex min-h-40 items-center gap-12" data-testid="ADM-64.override.car">
                    <template v-if="chosen">
                        <VehicleThumb :src="chosen.thumb" />
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate text-admin-base text-ink">{{ chosen.title }}</span>
                            <span v-if="chosen.owner" class="text-caption text-ink-3">{{ `@${chosen.owner}` }}</span>
                        </span>
                    </template>
                    <span v-else class="flex flex-1 items-center gap-8 text-admin-base text-ink-3"><PhCar :size="16" aria-hidden="true" />{{ trans('gift.cotd.override.none') }}</span>
                    <Button size="sm" variant="secondary" data-testid="ADM-64.override.choose" @click="pickerOpen = true">{{ trans(chosen ? 'gift.cotd.override.change' : 'gift.cotd.override.choose') }}</Button>
                </div>
            </Field>
            <div class="flex flex-wrap justify-end gap-8">
                <Button variant="ghost" :disabled="processing" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" variant="primary" :loading="processing" :disabled="!ready" data-testid="ADM-64.override.confirm">{{ trans('gift.cotd.override.confirm') }}</Button>
            </div>
        </form>
    </Dialog>
    <VehiclePicker v-model:open="pickerOpen" :title="trans('gift.cotd.override.picker_title')" test-id="ADM-64.picker" @choose="choose" />
</template>
