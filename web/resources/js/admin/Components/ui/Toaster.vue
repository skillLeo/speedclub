<script setup lang="ts">
import { PhCheckCircle, PhInfo, PhWarning, PhWarningCircle, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { dismissToast, toasts, type ToastTone } from './toast';
import { focusRing } from './styles';

defineOptions({ name: 'UiToaster' });

const icons = { success: PhCheckCircle, error: PhWarningCircle, info: PhInfo, warning: PhWarning } as const;
const tones: Record<ToastTone, string> = { success: 'text-success', error: 'text-danger', info: 'text-info', warning: 'text-warning' };
</script>

<template>
    <section :aria-label="trans('ui.toast.region')" class="pointer-events-none fixed bottom-24 right-24 z-50 flex w-full max-w-400 flex-col gap-8 pl-48">
        <div
            v-for="item in toasts"
            :key="item.id"
            :role="item.tone === 'error' ? 'alert' : 'status'"
            class="sc-pop pointer-events-auto flex items-start gap-12 rounded-sm border border-line bg-overlay px-16 py-12 text-ink shadow-e2"
            :data-testid="`toast.${item.tone}`"
        >
            <component :is="icons[item.tone]" :size="20" :class="tones[item.tone]" aria-hidden="true" />
            <div class="flex min-w-0 flex-1 flex-col gap-2">
                <p class="text-label-s text-ink">{{ item.title }}</p>
                <p v-if="item.description" class="text-supporting text-ink-2">{{ item.description }}</p>
            </div>
            <button type="button" :class="[focusRing, 'inline-flex size-24 items-center justify-center rounded-xs text-ink-3 hover:text-ink']" :aria-label="trans('ui.toast.dismiss')" @click="dismissToast(item.id)">
                <PhX :size="16" aria-hidden="true" />
            </button>
        </div>
    </section>
</template>
