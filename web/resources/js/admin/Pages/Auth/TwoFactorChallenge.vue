<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { nextTick, ref } from 'vue';
import Button from '../../Components/ui/Button.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import AuthNotice from '../../Components/shell/AuthNotice.vue';
import { usePageState } from '../../composables/pageState';
import { loginUrl, routeOr } from '../../lib/routes';

/** ADM-02: TOTP code from the authenticator app, or one recovery code. */
const state = usePageState();
const mode = ref<'code' | 'recovery'>('code');
const field = ref<{ focus: () => void } | null>(null);
const form = useForm({ code: '', recovery_code: '' });

async function toggle(): Promise<void> {
    mode.value = mode.value === 'code' ? 'recovery' : 'code';
    form.reset();
    form.clearErrors();
    await nextTick();
    field.value?.focus();
}

function submit(): void {
    form.transform((data) => (mode.value === 'code' ? { code: data.code.replace(/\s/g, '') } : { recovery_code: data.recovery_code.trim() })).post(routeOr('two-factor.login.store', '/admin/two-factor-challenge'), {
        onFinish: () => form.reset(),
    });
}
</script>

<template>
    <Head :title="trans('auth.challenge.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-02" :data-qa-state="state">
        <div class="flex flex-col gap-8">
            <h1 class="text-title-2 text-ink">{{ trans('auth.challenge.title') }}</h1>
            <p class="text-admin-base text-ink-2">{{ mode === 'code' ? trans('auth.challenge.intro_code') : trans('auth.challenge.intro_recovery') }}</p>
        </div>
        <AuthNotice v-if="state === 'error'" tone="error" :text="trans('auth.common.server_error')" />

        <form class="flex flex-col gap-16" novalidate data-testid="ADM-02.form" @submit.prevent="submit">
            <Field v-if="mode === 'code'" :label="trans('auth.challenge.code')" :error="form.errors.code" required>
                <Input ref="field" v-model="form.code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" autofocus tnum data-testid="ADM-02.code" />
            </Field>
            <Field v-else :label="trans('auth.challenge.recovery_code')" :error="form.errors.recovery_code" :hint="trans('auth.challenge.recovery_hint')" required>
                <Input ref="field" v-model="form.recovery_code" autocomplete="off" spellcheck="false" maxlength="40" data-testid="ADM-02.recovery-code" />
            </Field>
            <Button type="submit" variant="primary" block :loading="form.processing || state === 'loading'" data-testid="ADM-02.submit">{{ trans('auth.challenge.submit') }}</Button>
        </form>

        <!-- Two text links of the same kind, stacked at the column edge in every locale (DQ-508). -->
        <div class="flex flex-col items-start gap-12">
            <button
                type="button"
                class="inline-flex h-32 items-center rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                data-testid="ADM-02.toggle"
                @click="toggle"
            >
                {{ mode === 'code' ? trans('auth.challenge.use_recovery') : trans('auth.challenge.use_code') }}
            </button>
            <Link :href="loginUrl()" class="inline-flex h-32 items-center rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                {{ trans('auth.common.back_to_login') }}
            </Link>
        </div>
    </div>
</template>
