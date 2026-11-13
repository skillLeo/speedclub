<script setup lang="ts">
import { Head, Link, useForm, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Button from '../../Components/ui/Button.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import AuthNotice from '../../Components/shell/AuthNotice.vue';
import { usePageState } from '../../composables/pageState';
import { flashText } from '../../lib/i18n';
import { routeOr } from '../../lib/routes';

/** ADM-01 staff sign-in (Fortify, guard "staff"). */
const props = withDefaults(defineProps<{ status?: string | null }>(), { status: null });
const page = usePage();
const state = usePageState();

const form = useForm({ email: '', password: '' });

const notice = computed(() => {
    if (page.props.flash.session_expired) return { tone: 'warning' as const, text: trans('auth.login.session_expired') };
    if (props.status) return { tone: 'success' as const, text: flashText(props.status, trans) };
    if (page.props.flash.error) return { tone: 'error' as const, text: flashText(page.props.flash.error, trans) };
    return null;
});

function submit(): void {
    form.post(routeOr('login.store', '/admin/login'), { onFinish: () => form.reset('password') });
}
</script>

<template>
    <Head :title="trans('auth.login.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-01" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-2 text-ink">{{ trans('auth.login.title') }}</h1>
            <p class="text-admin-base text-ink-2">{{ trans('auth.login.intro') }}</p>
        </div>

        <AuthNotice v-if="notice" :tone="notice.tone" :text="notice.text" test-id="ADM-01.notice" />
        <AuthNotice v-if="state === 'error'" tone="error" :text="trans('auth.common.server_error')" test-id="ADM-01.error" />

        <form class="flex flex-col gap-16" novalidate data-testid="ADM-01.form" @submit.prevent="submit">
            <Field :label="trans('auth.fields.email')" :error="form.errors.email" required>
                <Input v-model="form.email" type="email" name="email" autocomplete="username" autofocus data-testid="ADM-01.email" />
            </Field>
            <Field :label="trans('auth.fields.password')" :error="form.errors.password" required>
                <Input v-model="form.password" type="password" name="password" autocomplete="current-password" data-testid="ADM-01.password" />
            </Field>
            <Button type="submit" variant="primary" block :loading="form.processing || state === 'loading'" data-testid="ADM-01.submit">
                {{ form.processing ? trans('auth.login.submitting') : trans('auth.login.submit') }}
            </Button>
        </form>

        <Link :href="routeOr('password.request', '/admin/forgot-password')" class="inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="ADM-01.forgot">
            {{ trans('auth.login.forgot') }}
        </Link>
    </div>
</template>
