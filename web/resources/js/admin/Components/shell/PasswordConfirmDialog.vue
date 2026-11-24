<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { ref, watch } from 'vue';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import { passwordConfirmed, passwordDialogCancelled, passwordDialogOpen } from '../../composables/recentPassword';
import { JsonError, requestJson } from '../../lib/http';
import { loginUrl, routeOr } from '../../lib/routes';

/** Password confirmation for sensitive actions (ADR-215): Fortify password.confirm.store, then the action runs again. An ended session
 * offers the sign-in (M5.1). */
const password = ref('');
const error = ref<string | null>(null);
const processing = ref(false);

watch(passwordDialogOpen, (open, was) => {
    if (open) {
        password.value = '';
        error.value = null;
        sessionEnded.value = false;
    } else if (was && !processing.value) {
        passwordDialogCancelled();
    }
});

/**
 * M5.1: only a refused password says "Das Passwort stimmt nicht". An ended session (401, 30 idle minutes or a sign-out elsewhere) or a
 * stale form token (419) used to say the same, so the correct password was typed again and again and nothing ever went live.
 */
function failure(e: unknown): string {
    if (!(e instanceof JsonError)) return trans('ui.state.server_error');
    if (e.status === 401 || e.status === 419) return trans('shell.password.session_expired');
    if (e.status === 429) return e.field('password') ?? trans('shell.password.throttled');
    if (e.status === 422) return e.field('password') ?? trans('shell.password.failed');
    if (e.status === 403) return trans('shell.password.forbidden');
    return trans('ui.state.server_error');
}
/** N-4: set where the failure is known, not by comparing translated text. */
const sessionEnded = ref(false);

async function submit(): Promise<void> {
    if (password.value === '') {
        error.value = trans('shell.password.required');
        return;
    }
    processing.value = true;
    error.value = null;
    sessionEnded.value = false;
    try {
        await requestJson('post', routeOr('password.confirm.store', '/admin/user/confirm-password'), { password: password.value });
        password.value = '';
        passwordConfirmed();
    } catch (e) {
        error.value = failure(e);
        sessionEnded.value = e instanceof JsonError && (e.status === 401 || e.status === 419);
    } finally {
        processing.value = false;
    }
}
</script>

<template>
    <Dialog v-model:open="passwordDialogOpen" :title="trans('shell.password.title')" :description="trans('shell.password.body')" size="sm" test-id="shell.password">
        <form id="shell-password-form" novalidate @submit.prevent="submit">
            <Field :label="trans('shell.password.label')" :error="error" required>
                <Input v-model="password" type="password" autocomplete="current-password" data-testid="shell.password.input" />
            </Field>
        </form>
        <template #footer>
            <Button v-if="sessionEnded" variant="secondary" :href="loginUrl()" data-testid="shell.password.login">{{ trans('shell.password.sign_in') }}</Button>
            <Button variant="ghost" :disabled="processing" @click="passwordDialogOpen = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" form="shell-password-form" variant="primary" :loading="processing" data-testid="shell.password.submit">{{ trans('shell.password.submit') }}</Button>
        </template>
    </Dialog>
</template>
