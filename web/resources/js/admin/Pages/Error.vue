<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { PhArrowClockwise, PhArrowLeft, PhGauge } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Button from '../Components/ui/Button.vue';
import { loginUrl, routeOr } from '../lib/routes';

/**
 * ADM-05 and the other error pages inside /admin (403, 404, 419, 429, 500, 503 maintenance; 400 for a malformed table query).
 * Signed-in staff see it inside the shell, so the way out is the navigation they can use.
 */
const props = defineProps<{ status: number }>();
const page = usePage();

const known = [400, 403, 404, 419, 429, 500, 503];
const key = computed(() => (known.includes(props.status) ? String(props.status) : '500'));
const signedIn = computed(() => page.props.staff?.two_factor_confirmed === true);
const canRetry = computed(() => [419, 429, 500, 503].includes(props.status));

function back(): void {
    window.history.back();
}

function reload(): void {
    window.location.reload();
}
</script>

<template>
    <Head :title="trans(`errors.${key}.title`)" />
    <section class="flex max-w-560 flex-col gap-16 py-24" data-testid="ADM-05" :data-status="status" :data-qa-state="'error'">
        <p class="text-caption text-ink-3 tabular-nums">{{ trans('errors.code', { code: String(status) }) }}</p>
        <h1 class="text-title-2 text-ink">{{ trans(`errors.${key}.title`) }}</h1>
        <p class="text-admin-base text-ink-2">{{ trans(`errors.${key}.body`) }}</p>
        <p v-if="status === 403 && signedIn" class="text-admin-base text-ink-3" data-testid="ADM-05.view-only">{{ trans('errors.403.hint') }}</p>
        <div class="mt-8 flex flex-wrap gap-8">
            <Button v-if="canRetry" variant="primary" :icon="PhArrowClockwise" data-testid="ADM-05.retry" @click="reload">{{ trans('errors.retry') }}</Button>
            <Button v-if="signedIn" :variant="canRetry ? 'secondary' : 'primary'" :icon="PhGauge" :href="routeOr('admin.dashboard', '/admin')" data-testid="ADM-05.dashboard">
                {{ trans('errors.dashboard') }}
            </Button>
            <Button v-else-if="status !== 503" variant="secondary" :href="loginUrl()" data-testid="ADM-05.login">{{ trans('errors.login') }}</Button>
            <Button variant="ghost" :icon="PhArrowLeft" @click="back">{{ trans('errors.back') }}</Button>
        </div>
    </section>
</template>
