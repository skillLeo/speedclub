<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import Button from '../../Components/ui/Button.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import AuthNotice from '../../Components/shell/AuthNotice.vue';
import { usePageState } from '../../composables/pageState';
import { flashText } from '../../lib/i18n';
import { loginUrl, routeOr } from '../../lib/routes';

/** ADM-04 (step 1). The answer is the same whether the address belongs to staff or not (SEC-P1-02). */
const props = withDefaults(defineProps<{ status?: string | null }>(), { status: null });
const state = usePageState();
const form = useForm({ email: '' });

function submit(): void {
    form.post(routeOr('password.email', '/admin/forgot-password'), { preserveScroll: true });
}
</script>

<template>
    <Head :title="trans('auth.forgot.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-04" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-m text-ink">{{ trans('auth.forgot.title') }}</h1>
            <p class="text-supporting text-ink-2">{{ trans('auth.forgot.intro') }}</p>
        </div>
        <AuthNotice v-if="props.status" tone="success" :text="flashText(props.status, trans)" test-id="ADM-04.status" />
        <AuthNotice v-if="state === 'error'" tone="error" :text="trans('auth.common.server_error')" />

        <form class="flex flex-col gap-16" novalidate data-testid="ADM-04.form" @submit.prevent="submit">
            <Field :label="trans('auth.fields.email')" :error="form.errors.email" required>
                <Input v-model="form.email" type="email" autocomplete="username" autofocus data-testid="ADM-04.email" />
            </Field>
            <Button type="submit" variant="primary" block :loading="form.processing || state === 'loading'" data-testid="ADM-04.submit">{{ trans('auth.forgot.submit') }}</Button>
        </form>
        <Link :href="loginUrl()" class="inline-flex h-32 items-center self-start rounded-xs text-label-s text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {{ trans('auth.common.back_to_login') }}
        </Link>
    </div>
</template>
