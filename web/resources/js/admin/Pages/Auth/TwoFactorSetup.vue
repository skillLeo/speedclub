<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhCopy, PhDownloadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, ref } from 'vue';
import AuthNotice from '../../Components/shell/AuthNotice.vue';
import Button from '../../Components/ui/Button.vue';
import Checkbox from '../../Components/ui/Checkbox.vue';
import Field from '../../Components/ui/Field.vue';
import Input from '../../Components/ui/Input.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import { usePageState } from '../../composables/pageState';
import { JsonError, requestJson } from '../../lib/http';
import { qaState } from '../../lib/qa';
import { routeOr } from '../../lib/routes';

/**
 * ADM-03 mandatory TOTP enrolment. Nothing secret comes with the page: after the password confirmation it enables TOTP, then fetches
 * the QR code and the key one after the other (never in parallel with the confirmation, SEC-P1-41), confirms a code, and shows
 * the recovery codes once. The response is no-store (TwoFactorSetupController).
 */
/** Outside production only, with ?qaStep=scan|recovery: a sample QR code of a made-up key and sample recovery codes (DQ-502). */
interface QaSample {
    step: 'scan' | 'recovery';
    svg: string;
    key: string;
    codes: string[];
}

const props = withDefaults(defineProps<{ passwordConfirmed?: boolean; qaSample?: QaSample | null }>(), { passwordConfirmed: false, qaSample: null });

type Step = 'password' | 'preparing' | 'scan' | 'recovery' | 'failed';

const step = ref<Step>(props.qaSample?.step ?? (props.passwordConfirmed ? 'preparing' : 'password'));
const state = usePageState(() => (step.value === 'failed' ? 'error' : step.value === 'preparing' ? 'loading' : 'ready'));
const password = ref('');
const code = ref('');
const error = ref<string | null>(null);
const processing = ref(false);
const qrSvg = ref<string | null>(props.qaSample?.svg ?? null);
const secret = ref<string | null>(props.qaSample?.key ?? null);
const recoveryCodes = ref<string[]>(props.qaSample?.codes ?? []);
const saved = ref(false);

const qrSrc = computed(() => (qrSvg.value === null ? null : `data:image/svg+xml;base64,${window.btoa(qrSvg.value)}`));
// Two even lines of four groups ("ABCD EFGH IJKL MNOP" / …), never 5 + 3 (DQ-551).
const secretLines = computed(() => {
    const groups = (secret.value ?? '').match(/.{1,4}/g) ?? [];
    const lines: string[] = [];
    for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(' '));
    return lines;
});

function message(e: unknown, fallback: string, field?: string): string {
    if (e instanceof JsonError) {
        if (field) {
            const text = e.field(field);
            if (text) return text;
        }
        if (e.status === 429) return trans('auth.common.throttled');
        if (e.status === 423) return trans('auth.setup.password_expired');
    }
    return fallback;
}

async function confirmPassword(): Promise<void> {
    if (password.value === '') {
        error.value = trans('auth.setup.password_required');
        return;
    }
    processing.value = true;
    error.value = null;
    try {
        await requestJson('post', routeOr('password.confirm.store', '/admin/user/confirm-password'), { password: password.value });
        password.value = '';
        await prepare();
    } catch (e) {
        error.value = message(e, trans('auth.setup.password_failed'), 'password');
    } finally {
        processing.value = false;
    }
}

/** Enable, then QR code, then key: strictly one request after the other. */
async function prepare(): Promise<void> {
    step.value = 'preparing';
    error.value = null;
    try {
        // force: an enrolment abandoned earlier (an unconfirmed key) starts over; confirmed TOTP is never replaced (EnableStaffTwoFactor).
        await requestJson('post', routeOr('two-factor.enable', '/admin/user/two-factor-authentication'), { force: true });
        const qr = await requestJson<{ svg?: string }>('get', routeOr('two-factor.qr-code', '/admin/user/two-factor-qr-code'));
        const key = await requestJson<{ secretKey?: string }>('get', routeOr('two-factor.secret-key', '/admin/user/two-factor-secret-key'));
        qrSvg.value = typeof qr.svg === 'string' ? qr.svg : null;
        secret.value = typeof key.secretKey === 'string' ? key.secretKey : null;
        step.value = 'scan';
    } catch (e) {
        if (e instanceof JsonError && e.status === 423) {
            step.value = 'password';
            error.value = trans('auth.setup.password_expired');
            return;
        }
        error.value = message(e, trans('auth.setup.prepare_failed'));
        step.value = 'failed';
    }
}

async function confirmCode(): Promise<void> {
    const value = code.value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(value)) {
        error.value = trans('auth.setup.code_format');
        return;
    }
    processing.value = true;
    error.value = null;
    try {
        await requestJson('post', routeOr('two-factor.confirm', '/admin/user/confirmed-two-factor-authentication'), { code: value });
        // The key is read again after enabling: the page forgets it as soon as the code is confirmed.
        secret.value = null;
        qrSvg.value = null;
        const codes = await requestJson<{ value?: unknown } & Record<string, unknown>>('get', routeOr('two-factor.recovery-codes', '/admin/user/two-factor-recovery-codes'));
        const list = Array.isArray(codes.value) ? codes.value : Object.values(codes);
        recoveryCodes.value = list.filter((c): c is string => typeof c === 'string');
        step.value = 'recovery';
    } catch (e) {
        error.value = message(e, trans('auth.setup.code_failed'), 'code');
    } finally {
        processing.value = false;
    }
}

async function copySecret(): Promise<void> {
    if (secret.value) await navigator.clipboard.writeText(secret.value).catch(() => undefined);
}

const recoveryFile = computed(() => `data:text/plain;charset=utf-8,${encodeURIComponent(`${trans('auth.setup.recovery_file_title')}\n\n${recoveryCodes.value.join('\n')}\n`)}`);

function finish(): void {
    router.visit(routeOr('admin.dashboard', '/admin'));
}

onMounted(() => {
    // With ?qaState=loading the page stays on its skeleton.
    if (step.value === 'preparing' && qaState() === null) void prepare();
});
</script>

<template>
    <Head :title="trans('auth.setup.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-03" :data-qa-state="state" :data-step="step">
        <div class="flex flex-col gap-8">
            <p class="text-caption text-ink-3">{{ trans('auth.setup.eyebrow') }}</p>
            <h1 class="text-title-m text-ink">{{ trans('auth.setup.title') }}</h1>
            <p class="text-supporting text-ink-2">{{ trans('auth.setup.intro') }}</p>
        </div>

        <ol class="flex gap-8 text-caption" :aria-label="trans('auth.setup.steps')">
            <li v-for="(name, index) in (['password', 'scan', 'recovery'] as const)" :key="name" class="flex flex-1 flex-col gap-4">
                <span class="h-2 rounded-full" :class="(['password', 'scan', 'recovery'] as const).indexOf(step === 'preparing' || step === 'failed' ? 'scan' : step) >= index ? 'bg-ink' : 'bg-line'" aria-hidden="true" />
                <span :class="step === name ? 'text-ink' : 'text-ink-3'" :aria-current="step === name ? 'step' : undefined">{{ trans(`auth.setup.step_${name}`) }}</span>
            </li>
        </ol>

        <!-- preparing (also ?qaState=loading, whatever the step: DQ-501) -->
        <div v-if="state === 'loading'" class="flex flex-col gap-24" aria-busy="true" data-testid="ADM-03.loading">
            <!-- The scan step's own parts with skeletons for what is still coming: instruction, QR card, the two key lines, code field (DQ-533). -->
            <div class="flex flex-col gap-12">
                <p class="text-supporting text-ink">{{ trans('auth.setup.scan') }}</p>
                <div class="self-start rounded-lg bg-qr-bg p-16"><Skeleton class="size-160" /></div>
                <div class="flex flex-col gap-4">
                    <p class="text-caption text-ink-2">{{ trans('auth.setup.key_label') }}</p>
                    <div class="flex items-center gap-8">
                        <span class="flex flex-col">
                            <span class="flex h-20 items-center"><Skeleton shape="text" class="w-200" /></span>
                            <span class="flex h-20 items-center"><Skeleton shape="text" class="w-200" /></span>
                        </span>
                        <Skeleton class="h-32 w-96" />
                    </div>
                </div>
            </div>
            <div class="flex flex-col gap-16">
                <Field :label="trans('auth.setup.code')" required>
                    <Input model-value="" disabled />
                </Field>
                <Skeleton class="h-40 w-full" />
            </div>
        </div>

        <!-- failed -->
        <div v-else-if="state === 'error'" class="flex flex-col gap-16">
            <AuthNotice tone="error" :text="error ?? trans('auth.setup.prepare_failed')" test-id="ADM-03.error" />
            <Button variant="secondary" @click="prepare">{{ trans('auth.setup.retry') }}</Button>
        </div>

        <!-- 1 · password -->
        <form v-else-if="step === 'password'" class="flex flex-col gap-16" novalidate data-testid="ADM-03.password-form" @submit.prevent="confirmPassword">
            <Field :label="trans('auth.fields.password')" :hint="trans('auth.setup.password_hint')" :error="error" required>
                <Input v-model="password" type="password" autocomplete="current-password" autofocus data-testid="ADM-03.password" />
            </Field>
            <Button type="submit" variant="primary" block :loading="processing" data-testid="ADM-03.password-submit">{{ trans('auth.setup.continue') }}</Button>
        </form>

        <!-- 2 · scan + code -->
        <div v-else-if="step === 'scan'" class="flex flex-col gap-24">
            <div class="flex flex-col gap-12">
                <p class="text-supporting text-ink">{{ trans('auth.setup.scan') }}</p>
                <div class="self-start rounded-lg bg-qr-bg p-16">
                    <img v-if="qrSrc" :src="qrSrc" :alt="trans('auth.setup.qr_alt')" class="size-160" data-testid="ADM-03.qr" />
                </div>
                <div class="flex flex-col gap-4">
                    <p class="text-caption text-ink-2">{{ trans('auth.setup.key_label') }}</p>
                    <div class="flex items-center gap-8">
                        <code class="sc-key flex flex-col font-ui text-code text-ink tabular-nums" data-testid="ADM-03.key">
                            <span v-for="line in secretLines" :key="line" class="whitespace-nowrap">{{ line }}</span>
                        </code>
                        <Button size="sm" variant="ghost" :icon="PhCopy" @click="copySecret">{{ trans('auth.setup.copy_key') }}</Button>
                    </div>
                </div>
            </div>
            <form class="flex flex-col gap-16" novalidate data-testid="ADM-03.code-form" @submit.prevent="confirmCode">
                <Field :label="trans('auth.setup.code')" :error="error" required>
                    <Input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" tnum data-testid="ADM-03.code" />
                </Field>
                <Button type="submit" variant="primary" block :loading="processing" data-testid="ADM-03.code-submit">{{ trans('auth.setup.confirm') }}</Button>
            </form>
        </div>

        <!-- 3 · recovery codes, shown once -->
        <div v-else-if="step === 'recovery'" class="flex flex-col gap-16">
            <AuthNotice tone="success" :text="trans('auth.setup.enabled')" />
            <p class="text-supporting text-ink">{{ trans('auth.setup.recovery_intro') }}</p>
            <!-- One code per line, numbered, never broken at its hyphen (DQ-543). -->
            <ol class="flex flex-col gap-4 rounded-sm border border-line bg-surface px-16 py-12" data-testid="ADM-03.recovery-codes">
                <li v-for="(item, index) in recoveryCodes" :key="item" class="flex items-baseline gap-12">
                    <span class="w-16 text-right text-caption text-ink-3 tabular-nums" aria-hidden="true">{{ index + 1 }}</span>
                    <span class="sc-key whitespace-nowrap text-code text-ink tabular-nums">{{ item }}</span>
                </li>
            </ol>
            <Button variant="secondary" :icon="PhDownloadSimple" :href="recoveryFile" external download="speedclub-admin-recovery-codes.txt">{{ trans('auth.setup.download') }}</Button>
            <Checkbox v-model="saved" :label="trans('auth.setup.saved')" data-testid="ADM-03.saved" />
            <Button variant="primary" block :disabled="saved !== true" data-testid="ADM-03.finish" @click="finish">{{ trans('auth.setup.finish') }}</Button>
        </div>
    </div>
</template>
