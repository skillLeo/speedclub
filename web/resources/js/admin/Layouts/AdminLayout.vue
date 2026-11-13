<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, TooltipProvider } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import CommandPalette from '../Components/patterns/CommandPalette.vue';
import FlashCenter from '../Components/shell/FlashCenter.vue';
import IdleWarning from '../Components/shell/IdleWarning.vue';
import PasswordConfirmDialog from '../Components/shell/PasswordConfirmDialog.vue';
import ShortcutSheet from '../Components/shell/ShortcutSheet.vue';
import Sidebar from '../Components/shell/Sidebar.vue';
import TopBar from '../Components/shell/TopBar.vue';
import TwoFactorReminder from '../Components/shell/TwoFactorReminder.vue';
import Toaster from '../Components/ui/Toaster.vue';
import { qaDialog } from '../composables/qaDialog';
import { trackWrites } from '../composables/recentPassword';
import { useShortcuts } from '../composables/shortcuts';
import { initDensity } from '../lib/density';
import { sidebarCollapsed } from '../lib/sidebar';

/**
 * Shell of every signed-in admin page (03 §14, 09 §10.1, contract §2.1). Persistent across visits. Sidebar 240 or the 64 rail (sticky,
 * collapsible) from 1024 px, an overlay drawer below; the document scrolls vertically (full-page captures), wide tables scroll inside their own frame (ADR-212).
 */
const drawer = ref(false);
// `?dialog=palette` (outside production) opens ⌘K on load for the visual matrix.
const palette = ref(qaDialog() === 'palette');
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = isMac ? '⌘K' : 'Ctrl K';
const { sheet: shortcutSheet, available: goTargets } = useShortcuts();
const page = usePage();

function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        palette.value = !palette.value;
    }
}

let offWrites: (() => void) | undefined;
onMounted(() => {
    window.addEventListener('keydown', onKeydown);
    offWrites = trackWrites();
    // The first page may have been the sign-in: the density belongs to the staff member now signed in.
    initDensity(page.props.staff?.id);
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    offWrites?.();
});
</script>

<template>
    <TooltipProvider :delay-duration="400">
        <div class="flex min-h-dvh min-w-0 bg-canvas text-ink">
            <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-16 focus:top-16 focus:z-50 focus:inline-flex focus:h-40 focus:items-center focus:rounded-sm focus:bg-inverse focus:px-16 focus:text-admin-base-strong focus:text-ink-inverse focus:outline-2 focus:outline-offset-2 focus:outline-focus">
                {{ trans('shell.skip') }}
            </a>
            <aside class="hidden shrink-0 border-r border-line-subtle bg-surface shell:block" :class="sidebarCollapsed ? 'w-64' : 'w-240'" :aria-label="trans('shell.sidebar')" data-testid="shell.sidebar">
                <div class="sticky top-0 h-dvh">
                    <Sidebar collapsible />
                </div>
            </aside>

            <DialogRoot v-model:open="drawer">
                <DialogPortal>
                    <DialogOverlay class="sc-fade fixed inset-0 z-40 bg-scrim shell:hidden" />
                    <DialogContent class="sc-slide-in-left fixed inset-y-0 left-0 z-50 w-240 max-w-full border-r border-line bg-surface shell:hidden" data-testid="shell.drawer">
                        <DialogTitle class="sr-only">{{ trans('shell.sidebar') }}</DialogTitle>
                        <Sidebar @navigate="drawer = false" />
                    </DialogContent>
                </DialogPortal>
            </DialogRoot>

            <div class="flex min-w-0 flex-1 flex-col">
                <TopBar class="sticky top-0 z-30" :shortcut="shortcut" @menu="drawer = true" @search="palette = true" />
                <main id="main" tabindex="-1" class="min-w-0 flex-1 focus:outline-none">
                    <div class="mx-auto w-full max-w-1440 px-16 py-24 tablet:px-24 desktop:px-32">
                        <TwoFactorReminder />
                        <FlashCenter />
                        <slot />
                    </div>
                </main>
            </div>
        </div>
        <CommandPalette v-model:open="palette" />
        <ShortcutSheet v-model:open="shortcutSheet" :targets="goTargets()" :palette="shortcut" />
        <IdleWarning />
        <PasswordConfirmDialog />
        <Toaster />
    </TooltipProvider>
</template>
