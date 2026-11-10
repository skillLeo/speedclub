<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import Button from '../../Components/ui/Button.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import { usePageState } from '../../composables/pageState';
import { routeOr } from '../../lib/routes';

/** Fortify's password confirmation page (a GET that needed a recent password). Writes use the shell dialog instead (ADR-215). */
const state = usePageState();
const form = useForm({ password: '' });

function submit(): void {
    form.post(routeOr('password.confirm.store', '/admin/user/confirm-password'), { onFinish: () => form.reset() });
}
</script>

<template>
    <Head :title="trans('auth.confirm.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-01.confirm" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-m text-ink">{{ trans('auth.confirm.title') }}</h1>
            <p class="text-supporting text-ink-2">{{ trans('auth.confirm.intro') }}</p>
        </div>
        <form class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <Field :label="trans('auth.fields.password')" :error="form.errors.password" required>
                <Input v-model="form.password" type="password" autocomplete="current-password" autofocus data-testid="ADM-01.confirm.password" />
            </Field>
            <Button type="submit" variant="primary" block :loading="form.processing" data-testid="ADM-01.confirm.submit">{{ trans('auth.confirm.submit') }}</Button>
        </form>
    </div>
</template>
