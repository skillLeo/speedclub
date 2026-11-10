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
 * The invite link's page (M3.6, ADR-218/237): /admin/invite#token=…. The token comes in the fragment, which no browser sends to a server;
 * the page drops it from the address bar at once and posts it with the new password (the staff password rules). Then the sign-in page;
 * after signing in the account sets up two-factor sign-in (ADM-03). An unknown, used, replaced or expired link answers the same.
 */
const props = withDefaults(defineProps<{ passwordMinLength?: number }>(), { passwordMinLength: 10 });
const form = useForm({ token: '', password: '', password_confirmation: '' });
const ready = ref(false);
const linkBroken = ref(false);
const state = usePageState(() => (!ready.value ? 'loading' : linkBroken.value ? 'error' : 'ready'));

onMounted(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('token') ?? '';
    if (window.location.hash !== '') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    form.token = token;
    linkBroken.value = !/^[A-Za-z0-9]{64}$/.test(token);
    ready.value = true;
});

function submit(): void {
    form.post(routeOr('admin.invite.store', '/admin/invite'), { onFinish: () => form.reset('password', 'password_confirmation') });
}
</script>

<template>
    <Head :title="trans('team.accept.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-INVITE" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-m text-ink">{{ trans('team.accept.title') }}</h1>
            <p class="text-supporting text-ink-2">{{ trans('team.accept.intro') }}</p>
        </div>

        <!-- The form's own geometry: two fields (label, 40 control, the hint under the first), then the button. -->
        <div v-if="state === 'loading'" class="flex flex-col gap-16" aria-busy="true" data-testid="ADM-INVITE.loading">
            <div v-for="n in 2" :key="n" class="flex flex-col gap-4">
                <div class="flex h-20 items-center"><Skeleton shape="text" class="w-160" /></div>
                <Skeleton class="h-40 w-full" />
                <div v-if="n === 1" class="flex h-16 items-center"><Skeleton shape="text" class="w-full" /></div>
            </div>
            <Skeleton class="h-40 w-full" />
        </div>
        <AuthNotice v-else-if="state === 'error'" tone="error" :text="trans('team.accept.link_broken')" test-id="ADM-INVITE.link-broken" />
        <form v-else class="flex flex-col gap-16" novalidate data-testid="ADM-INVITE.form" @submit.prevent="submit">
            <AuthNotice v-if="form.errors.token" tone="error" :text="form.errors.token" test-id="ADM-INVITE.invalid" />
            <Field :label="trans('team.accept.password')" :hint="trans('team.accept.password_hint', { min: String(props.passwordMinLength) })" :error="form.errors.password" required>
                <Input v-model="form.password" type="password" autocomplete="new-password" autofocus data-testid="ADM-INVITE.password" />
            </Field>
            <Field :label="trans('team.accept.password_confirmation')" :error="form.errors.password_confirmation" required>
                <Input v-model="form.password_confirmation" type="password" autocomplete="new-password" data-testid="ADM-INVITE.password-confirmation" />
            </Field>
            <Button type="submit" variant="primary" block :loading="form.processing" data-testid="ADM-INVITE.submit">{{ trans('team.accept.submit') }}</Button>
        </form>
        <Link :href="loginUrl()" class="inline-flex h-32 items-center self-start rounded-xs text-label-s text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {{ trans('team.accept.back') }}
        </Link>
    </div>
</template>
