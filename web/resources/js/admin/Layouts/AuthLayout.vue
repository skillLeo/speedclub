<script setup lang="ts">
import { TooltipProvider } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import EnvBadge from '../Components/shell/EnvBadge.vue';
import LocaleToggle from '../Components/shell/LocaleToggle.vue';
import ThemeToggle from '../Components/shell/ThemeToggle.vue';
import Toaster from '../Components/ui/Toaster.vue';

/** Sign-in, two-factor, password reset and errors without a session (ADM-01…05): one narrow column, left-aligned. */
</script>

<template>
    <TooltipProvider :delay-duration="400">
        <div class="flex min-h-dvh flex-col bg-canvas text-ink">
            <header class="flex h-56 items-center gap-8 px-16 tablet:px-24">
                <span class="font-display text-title-s text-ink">{{ trans('shell.brand') }}</span>
                <span class="text-caption text-ink-3">{{ trans('shell.brand_suffix') }}</span>
                <div class="ml-auto flex items-center gap-8">
                    <EnvBadge />
                    <ThemeToggle />
                    <LocaleToggle />
                </div>
            </header>
            <main id="main" class="flex flex-1 items-start justify-center px-16 pb-64 pt-48 tablet:pt-64">
                <div class="w-full max-w-400">
                    <slot />
                </div>
            </main>
        </div>
        <Toaster />
    </TooltipProvider>
</template>
