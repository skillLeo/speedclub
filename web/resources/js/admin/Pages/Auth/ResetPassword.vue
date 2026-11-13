<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { onMounted, ref } from 'vue';
import AuthNotice from '../../Components/shell/AuthNotice.vue';
import Button from '../../Components/ui/Button.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import { usePageState } from '../../composables/pageState';
import { loginUrl, routeOr } from '../../lib/routes';

/**
 * ADM-04 (step 2): new password from the e-mailed link. Token and address come in the link's fragment (#token=…&email=…), which no
 * browser sends to a server (SEC-P1-07); the server props stay null. The page drops the fragment from the address bar at once.
 */
const props = withDefaults(defineProps<{ token?: string | null; email?: string | null }>(), { token: null, email: null });

const form = useForm({ token: props.token ?? '', email: props.email ?? '', password: '', password_confirmation: '' });
const ready = ref(false);
const linkBroken = ref(false);
const state = usePageState(() => (!ready.value ? 'loading' : linkBroken.value ? 'error' : 'ready'));

onMounted(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('token') ?? props.token ?? '';
    const email = fragment.get('email') ?? props.email ?? '';
    if (window.location.hash !== '') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    form.token = token;
    form.email = email;
    linkBroken.value = token === '' || email === '';
    ready.value = true;
});

function submit(): void {
    form.post(routeOr('password.update', '/admin/reset-password'), { onFinish: () => form.reset('password', 'password_confirmation') });
}
</script>

<template>
    <Head :title="trans('auth.reset.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-04" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-2 text-ink">{{ trans('auth.reset.title') }}</h1>
            <p class="text-admin-base text-ink-2">{{ trans('auth.reset.intro') }}</p>
        </div>

        <!-- The form's own geometry: three fields (label, 40 control, the hint of the new password), then the button (DQ-514). -->
        <div v-if="state === 'loading'" class="flex flex-col gap-16" aria-busy="true" data-testid="ADM-04.loading">
            <div v-for="n in 3" :key="n" class="flex flex-col gap-4">
                <div class="flex h-20 items-center"><Skeleton shape="text" class="w-160" /></div>
                <Skeleton class="h-40 w-full" />
                <template v-if="n === 2">
                    <div class="flex h-16 items-center"><Skeleton shape="text" class="w-full" /></div>
                    <div class="flex h-16 items-center"><Skeleton shape="text" class="w-1/2" /></div>
                </template>
            </div>
            <Skeleton class="h-40 w-full" />
        </div>
        <template v-else-if="state === 'error'">
            <AuthNotice tone="error" :text="trans('auth.reset.link_broken')" test-id="ADM-04.link-broken" />
            <Button variant="primary" :href="routeOr('password.request', '/admin/forgot-password')">{{ trans('auth.reset.request_new') }}</Button>
        </template>
        <form v-else class="flex flex-col gap-16" novalidate data-testid="ADM-04.reset-form" @submit.prevent="submit">
            <Field :label="trans('auth.fields.email')" :error="form.errors.email">
                <Input v-model="form.email" type="email" autocomplete="username" readonly data-testid="ADM-04.email" />
            </Field>
            <Field :label="trans('auth.reset.password')" :hint="trans('auth.reset.password_hint')" :error="form.errors.password" required>
                <Input v-model="form.password" type="password" autocomplete="new-password" autofocus data-testid="ADM-04.password" />
            </Field>
            <Field :label="trans('auth.reset.password_confirmation')" :error="form.errors.password_confirmation" required>
                <Input v-model="form.password_confirmation" type="password" autocomplete="new-password" data-testid="ADM-04.password-confirmation" />
            </Field>
            <AuthNotice v-if="form.errors.token" tone="error" :text="form.errors.token" />
            <Button type="submit" variant="primary" block :loading="form.processing" data-testid="ADM-04.reset-submit">{{ trans('auth.reset.submit') }}</Button>
        </form>
        <Link :href="loginUrl()" class="inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {{ trans('auth.common.back_to_login') }}
        </Link>
    </div>
</template>
