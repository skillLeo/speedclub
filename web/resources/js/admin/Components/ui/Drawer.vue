<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { ref } from 'vue';
import { focusRing } from './styles';
import { qaEnabled } from '../../lib/qa';

defineOptions({ name: 'UiDrawer' });

/**
 * Side panel from the right for edit forms and record details (06 §5). Header (title, description, `header-actions` slot),
 * scrolling body (default slot), sticky `footer` slot for the form actions. Full width below 560.
 */
const open = defineModel<boolean>('open', { default: false });
withDefaults(defineProps<{ title: string; description?: string; size?: 'md' | 'lg'; testId?: string; dismissible?: boolean }>(), {
    description: undefined,
    size: 'md',
    testId: undefined,
    dismissible: true,
});
const emit = defineEmits<{ 'before-close': [event: Event] }>();
const widths = { md: 'max-w-480', lg: 'max-w-720' } as const;

/**
 * DQ-519: the overlay does not open on its close button. Focus goes to an element marked data-autofocus, else the first field of the
 * body (forms), else the Cancel button (a confirmation without fields), else the panel itself (a read-only drawer).
 */
const content = ref<{ $el: HTMLElement } | null>(null);
function initialFocus(event: Event): void {
    const panel = content.value?.$el;
    if (!(panel instanceof HTMLElement)) return;
    const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(
            '[data-dialog-body] :is(input:not([type="hidden"]):not([readonly]):not(:disabled), textarea:not(:disabled), [role="combobox"], [role="radio"], [role="checkbox"])',
        ) ??
        panel.querySelector<HTMLElement>('[data-dialog-cancel]');
    event.preventDefault();
    (target ?? panel).focus({ preventScroll: true });
    // QA (non-production, DQ-623): ?qaScroll=end shows the end of a long drawer (its reason field and notes) for a second capture.
    if (qaEnabled() && new URLSearchParams(window.location.search).get('qaScroll') === 'end') {
        requestAnimationFrame(() => {
            const body = panel.querySelector<HTMLElement>('[data-dialog-body]');
            if (body) body.scrollTop = body.scrollHeight;
        });
    }
}
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal>
            <DialogOverlay class="sc-fade fixed inset-0 z-40 bg-scrim" />
            <DialogContent
                ref="content"
                :data-testid="testId"
                :class="[widths[size], 'sc-slide-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface text-ink shadow-sheet focus-visible:outline-none']"
                @open-auto-focus="initialFocus"
                @escape-key-down="(e: KeyboardEvent) => { if (!dismissible) e.preventDefault(); emit('before-close', e); }"
                @pointer-down-outside="(e: Event) => { if (!dismissible) e.preventDefault(); emit('before-close', e); }"
            >
                <header class="flex items-start gap-16 border-b border-line-subtle px-24 py-16">
                    <div class="flex min-w-0 flex-1 flex-col gap-4">
                        <DialogTitle class="text-headline text-ink">{{ title }}</DialogTitle>
                        <DialogDescription v-if="description" class="text-admin-base text-ink-2">{{ description }}</DialogDescription>
                    </div>
                    <slot name="header-actions" />
                    <DialogClose :class="[focusRing, '-mr-8 inline-flex size-32 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink']" :aria-label="trans('ui.dialog.close')">
                        <PhX :size="16" aria-hidden="true" />
                    </DialogClose>
                </header>
                <div class="min-h-0 flex-1 overflow-y-auto px-24 py-24 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus" tabindex="0" data-dialog-body>
                    <slot />
                </div>
                <footer v-if="$slots.footer" class="flex flex-wrap items-center justify-end gap-8 border-t border-line-subtle px-24 py-16">
                    <slot name="footer" />
                </footer>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
