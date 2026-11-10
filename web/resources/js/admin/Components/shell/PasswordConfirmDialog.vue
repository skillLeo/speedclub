<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { ref, watch } from 'vue';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import { passwordConfirmed, passwordDialogCancelled, passwordDialogOpen } from '../../composables/recentPassword';
import { JsonError, requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';

/** Password confirmation for sensitive actions (ADR-215): Fortify password.confirm.store, then the action runs again. */
const password = ref('');
const error = ref<string | null>(null);
const processing = ref(false);

watch(passwordDialogOpen, (open, was) => {
    if (open) {
        password.value = '';
        error.value = null;
    } else if (was && !processing.value) {
        passwordDialogCancelled();
    }
});

async function submit(): Promise<void> {
    if (password.value === '') {
        error.value = trans('shell.password.required');
        return;
    }
    processing.value = true;
    error.value = null;
    try {
        await requestJson('post', routeOr('password.confirm.store', '/admin/user/confirm-password'), { password: password.value });
        password.value = '';
        passwordConfirmed();
    } catch (e) {
        error.value = e instanceof JsonError ? (e.field('password') ?? (e.status === 429 ? trans('shell.password.throttled') : trans('shell.password.failed'))) : trans('shell.password.failed');
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
            <Button variant="ghost" :disabled="processing" @click="passwordDialogOpen = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" form="shell-password-form" variant="primary" :loading="processing" data-testid="shell.password.submit">{{ trans('shell.password.submit') }}</Button>
        </template>
    </Dialog>
</template>
