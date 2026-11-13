<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { ref } from 'vue';
import { focusRing } from './styles';

defineOptions({ name: 'UiDialog' });

/**
 * Modal dialog: title, optional description, body (default slot), actions (`footer` slot, right-aligned).
 * `dismissible=false` keeps it open on Escape/outside click (for steps that must be answered, e.g. the idle warning).
 */
const open = defineModel<boolean>('open', { default: false });
withDefaults(defineProps<{ title: string; description?: string; size?: 'sm' | 'md' | 'lg'; dismissible?: boolean; testId?: string; role?: 'dialog' | 'alertdialog' }>(), {
    description: undefined,
    size: 'md',
    dismissible: true,
    testId: undefined,
    role: 'dialog',
});

const widths = { sm: 'max-w-400', md: 'max-w-560', lg: 'max-w-720' } as const;

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
}
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal>
            <DialogOverlay class="sc-fade fixed inset-0 z-40 bg-scrim" />
            <div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-16">
                <DialogContent
                    ref="content"
                    :role="role"
                    :data-testid="testId"
                    :class="[widths[size], 'sc-pop pointer-events-auto flex max-h-full w-full flex-col rounded-sm border border-line bg-surface text-ink shadow-sheet focus-visible:outline-none']"
                    @open-auto-focus="initialFocus"
                    @escape-key-down="(e: KeyboardEvent) => { if (!dismissible) e.preventDefault(); }"
                    @pointer-down-outside="(e: Event) => { if (!dismissible) e.preventDefault(); }"
                    @interact-outside="(e: Event) => { if (!dismissible) e.preventDefault(); }"
                >
                    <header class="flex items-start gap-16 px-24 pt-24">
                        <div class="flex min-w-0 flex-1 flex-col gap-4">
                            <DialogTitle class="text-headline text-ink">{{ title }}</DialogTitle>
                            <DialogDescription v-if="description" class="text-admin-base text-ink-2">{{ description }}</DialogDescription>
                        </div>
                        <DialogClose
                            v-if="dismissible"
                            :class="[focusRing, '-mr-8 -mt-4 inline-flex size-32 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink']"
                            :aria-label="trans('ui.dialog.close')"
                        >
                            <PhX :size="16" aria-hidden="true" />
                        </DialogClose>
                    </header>
                    <div class="min-h-0 flex-1 overflow-y-auto px-24 py-16 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus" tabindex="0" data-dialog-body>
                        <slot />
                    </div>
                    <footer v-if="$slots.footer" class="flex flex-wrap items-center justify-end gap-8 border-t border-line-subtle px-24 py-16">
                        <slot name="footer" />
                    </footer>
                </DialogContent>
            </div>
        </DialogPortal>
    </DialogRoot>
</template>
