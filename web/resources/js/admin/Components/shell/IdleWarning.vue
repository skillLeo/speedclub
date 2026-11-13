<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import { useIdle } from '../../composables/idle';
import { requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';

/** "Sitzung läuft ab" at 25 minutes with "Sitzung verlängern" (ADR-217). Only shown to signed-in staff with TOTP (AdminLayout). */
const page = usePage();
const { warning, secondsLeft, touch } = useIdle(
    () => page.props.app.idle_minutes,
    () => page.props.app.warn_minutes,
);
const extending = ref(false);
const failed = ref(false);

const remaining = computed(() => {
    const minutes = Math.floor(secondsLeft.value / 60);
    const seconds = String(secondsLeft.value % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
});

const open = computed({
    get: () => warning.value,
    set: () => undefined,
});

async function extend(): Promise<void> {
    extending.value = true;
    failed.value = false;
    try {
        await requestJson('post', routeOr('admin.session.keep-alive', '/admin/session/keep-alive'));
        touch();
    } catch {
        failed.value = true;
    } finally {
        extending.value = false;
    }
}

function signOut(): void {
    router.post(routeOr('logout', '/admin/logout'));
}
</script>

<template>
    <Dialog v-model:open="open" :title="trans('shell.idle.title')" :dismissible="false" size="sm" role="alertdialog" test-id="shell.idle">
        <p class="text-admin-base text-ink-2" aria-live="polite">
            {{ trans('shell.idle.body', { time: remaining }) }}
        </p>
        <p v-if="failed" class="mt-8 text-admin-base text-danger" role="alert">{{ trans('shell.idle.failed') }}</p>
        <template #footer>
            <Button variant="ghost" data-testid="shell.idle.sign-out" @click="signOut">{{ trans('shell.staff.sign_out') }}</Button>
            <Button variant="primary" :loading="extending" data-testid="shell.idle.extend" @click="extend">{{ trans('shell.idle.extend') }}</Button>
        </template>
    </Dialog>
</template>
