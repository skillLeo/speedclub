<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { currentLocale, trans } from 'laravel-vue-i18n';
import { focusRing } from '../ui/styles';

/**
 * DE/EN (03 §14). Writes the cookie `sc_admin_lang` (path /admin, one year) and reloads the page, which answers in that language
 * (App\Http\Controllers\Admin\Support\AdminLocale). Works signed out too; there is no route behind it. The pressed button is the
 * language the page shows (also under ?qaLocale=). Each button's name starts with its visible text ("DE, Deutsch").
 */
function choose(locale: 'de' | 'en'): void {
    if (locale === currentLocale.value) return;
    document.cookie = `sc_admin_lang=${locale}; path=/admin; max-age=${60 * 60 * 24 * 365}; samesite=lax${window.location.protocol === 'https:' ? '; secure' : ''}`;
    // A qaLocale in the URL would win over the cookie: drop it.
    const url = new URL(window.location.href);
    url.searchParams.delete('qaLocale');
    router.visit(url.pathname + url.search, { preserveScroll: true, preserveState: true, replace: true });
}
</script>

<template>
    <div role="group" :aria-label="trans('shell.locale.label')" class="flex items-center gap-2" data-testid="shell.locale">
        <button
            v-for="locale in (['de', 'en'] as const)"
            :key="locale"
            type="button"
            :lang="locale"
            :aria-pressed="currentLocale === locale"
            :title="trans(`shell.locale.${locale}_name`)"
            :class="[
                focusRing,
                'inline-flex h-32 min-w-32 items-center justify-center rounded-sm border px-8 text-label-s',
                currentLocale === locale ? 'border-line-control bg-selected text-ink' : 'border-transparent text-ink-2 hover:bg-hover hover:text-ink',
            ]"
            :data-testid="`shell.locale.${locale}`"
            @click="choose(locale)"
        >
            {{ trans(`shell.locale.${locale}`) }}<span class="sr-only">{{ trans('shell.locale.separator') }}{{ trans(`shell.locale.${locale}_name`) }}</span>
        </button>
    </div>
</template>
