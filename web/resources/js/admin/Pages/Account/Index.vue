<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhCopy, PhDownloadSimple, PhEye, PhEyeSlash, PhKey, PhSignOut } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, reactive, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DialogError from '../../Components/patterns/DialogError.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Field, Input, Skeleton, toast } from '../../Components/ui';
import { confirmPasswordFirst } from '../../composables/recentPassword';
import { usePageState } from '../../composables/pageState';
import { formatDate, formatDateTime, formatTime } from '../../lib/format';
import { JsonError, requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';
import { roleLabel } from '../Team/shared';

/**
 * ADM-51 my staff account (06 §3 Settings, m3.6 §1, ADR-238, SEC-P1-36/39): profile (read-only), the password change (Fortify; every
 * other session ends), the authenticator rotation (a current code → the new key and its QR code → a code of the new key; the old key works
 * until then), the recovery codes behind a current code (shown or regenerated), and the own sessions with sign-out. Keys and codes come
 * only as the no-store JSON answer of their step and live in this page's memory.
 */
interface Session {
    handle: string;
    current: boolean;
    last_active_at: string;
    browser: string | null;
    os: string | null;
}
const props = defineProps<{
    account: { name: string; email: string; roles: string[]; two_factor_confirmed_at: string | null; last_login_at: string | null; rotation_expires_at: string | null };
    sessions: Session[];
    passwordMinLength: number;
    qaSample?: { step: 'rotation' | 'recovery'; svg: string; key: string; codes: string[]; expires_at: string } | null;
}>();

const state = usePageState();

function fail(error: unknown, fallback: string): string {
    if (error instanceof JsonError) {
        if (typeof error.body.message === 'string' && error.status !== 409) return error.field('code') ?? error.body.message;
        if (error.status === 429) return trans('auth.common.throttled');
    }
    return fallback;
}
/** A code step: ask for the password first when it is stale (403 password_confirmation_required), then once more. */
async function codeStep<T>(method: 'post' | 'delete', url: string, data: Record<string, unknown>): Promise<T> {
    try {
        return await requestJson<T>(method, url, data);
    } catch (error) {
        if (error instanceof JsonError && error.body.code === 'password_confirmation_required') {
            return await new Promise<T>((resolve, reject) => confirmPasswordFirst(() => void requestJson<T>(method, url, data).then(resolve, reject)));
        }
        throw error;
    }
}
const sixDigits = (value: string) => /^\d{6}$/.test(value.replace(/\s/g, ''));

// ---- password ---------------------------------------------------------------------------------------------------------------
const password = reactive({ current_password: '', password: '', password_confirmation: '' });
const passwordErrors = reactive<{ current_password: string | null; password: string | null; password_confirmation: string | null; form: string | null }>({ current_password: null, password: null, password_confirmation: null, form: null });
const passwordBusy = ref(false);
async function changePassword(): Promise<void> {
    passwordErrors.current_password = password.current_password === '' ? trans('account.password.errors.current') : null;
    passwordErrors.password = password.password.length < props.passwordMinLength ? trans('account.password.errors.new', { min: String(props.passwordMinLength) }) : null;
    passwordErrors.password_confirmation = password.password !== password.password_confirmation ? trans('account.password.errors.confirmation') : null;
    passwordErrors.form = null;
    if (passwordErrors.current_password || passwordErrors.password || passwordErrors.password_confirmation) return;
    passwordBusy.value = true;
    try {
        await requestJson('put', routeOr('user-password.update', '/admin/user/password'), { ...password });
        Object.assign(password, { current_password: '', password: '', password_confirmation: '' });
        toast('success', trans('account.password.done'));
        router.reload({ only: ['sessions'] });
    } catch (error) {
        if (error instanceof JsonError && error.status === 422) {
            passwordErrors.current_password = error.field('current_password');
            passwordErrors.password = error.field('password');
            passwordErrors.form = passwordErrors.current_password || passwordErrors.password ? null : fail(error, trans('account.two_factor.errors.failed'));
        } else passwordErrors.form = fail(error, trans('account.two_factor.errors.failed'));
    } finally {
        passwordBusy.value = false;
    }
}

// ---- rotation -----------------------------------------------------------------------------------------------------------------
type RotationStep = 'idle' | 'code' | 'scan';
const rotation = reactive<{ step: RotationStep; code: string; newCode: string; secret: string; svg: string; expires: string; error: string | null; busy: boolean; copied: boolean }>({ step: 'idle', code: '', newCode: '', secret: '', svg: '', expires: '', error: null, busy: false, copied: false });
const qrSrc = computed(() => (rotation.svg === '' ? null : `data:image/svg+xml;base64,${window.btoa(rotation.svg)}`));
// The address breaks only after "@" or "." (DQ-635), never inside a word.
const emailParts = computed(() => props.account.email.split(/(?<=[@.])/));
const secretLines = computed(() => {
    const groups = rotation.secret.match(/.{1,4}/g) ?? [];
    const lines: string[] = [];
    for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(' '));
    return lines;
});
async function startRotation(): Promise<void> {
    if (!sixDigits(rotation.code)) {
        rotation.error = trans('account.two_factor.errors.code');
        return;
    }
    rotation.busy = true;
    rotation.error = null;
    try {
        const answer = await codeStep<{ secret: string; qr_svg: string; expires_at: string }>('post', routeOr('admin.account.rotation.start', '/admin/account/two-factor/rotation'), { code: rotation.code });
        Object.assign(rotation, { step: 'scan', secret: answer.secret, svg: answer.qr_svg, expires: answer.expires_at, code: '' });
    } catch (error) {
        rotation.error = fail(error, trans('account.two_factor.errors.failed'));
    } finally {
        rotation.busy = false;
    }
}
async function confirmRotation(): Promise<void> {
    if (!sixDigits(rotation.newCode)) {
        rotation.error = trans('account.two_factor.errors.code');
        return;
    }
    rotation.busy = true;
    rotation.error = null;
    try {
        await codeStep('post', routeOr('admin.account.rotation.confirm', '/admin/account/two-factor/rotation/confirm'), { code: rotation.newCode });
        Object.assign(rotation, { step: 'idle', secret: '', svg: '', newCode: '' });
        toast('success', trans('account.two_factor.done'));
        router.reload({ only: ['account', 'sessions'] });
    } catch (error) {
        rotation.error = fail(error, trans('account.two_factor.errors.failed'));
    } finally {
        rotation.busy = false;
    }
}
async function cancelRotation(): Promise<void> {
    const wasPending = rotation.step === 'scan' || props.account.rotation_expires_at !== null;
    Object.assign(rotation, { step: 'idle', secret: '', svg: '', code: '', newCode: '', error: null });
    if (!wasPending) return;
    try {
        await requestJson('delete', routeOr('admin.account.rotation.cancel', '/admin/account/two-factor/rotation'));
    } finally {
        router.reload({ only: ['account'] });
    }
}
async function copySecret(): Promise<void> {
    await navigator.clipboard?.writeText(rotation.secret).catch(() => undefined);
    rotation.copied = true;
}

// ---- recovery codes -----------------------------------------------------------------------------------------------------------
const recovery = reactive<{ mode: 'idle' | 'show' | 'regenerate'; code: string; codes: string[]; error: string | null; busy: boolean }>({ mode: 'idle', code: '', codes: [], error: null, busy: false });
async function recoveryStep(): Promise<void> {
    if (!sixDigits(recovery.code)) {
        recovery.error = trans('account.two_factor.errors.code');
        return;
    }
    recovery.busy = true;
    recovery.error = null;
    const regenerate = recovery.mode === 'regenerate';
    try {
        const answer = await codeStep<{ codes: string[] }>('post', regenerate ? routeOr('admin.account.recovery-codes.regenerate', '/admin/account/recovery-codes/regenerate') : routeOr('admin.account.recovery-codes.show', '/admin/account/recovery-codes'), { code: recovery.code });
        Object.assign(recovery, { codes: answer.codes, code: '', mode: 'idle' });
        if (regenerate) {
            toast('success', trans('account.recovery.new_done'));
            router.reload({ only: ['sessions'] });
        }
    } catch (error) {
        recovery.error = fail(error, trans('account.two_factor.errors.failed'));
    } finally {
        recovery.busy = false;
    }
}
const recoveryFile = computed(() => `data:text/plain;charset=utf-8,${encodeURIComponent(`${trans('account.recovery.file_title')}\n\n${recovery.codes.join('\n')}\n`)}`);

// ---- sessions -----------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const ending = ref<Session | null>(null);
const endOpen = computed({ get: () => ending.value !== null, set: (v: boolean) => (v ? null : (ending.value = null)) });
const othersOpen = ref(false);
const deviceText = (s: Session) => (s.browser || s.os ? trans('account.sessions.line', { browser: s.browser ?? '–', os: s.os ?? '–' }) : trans('account.sessions.unknown'));
const others = computed(() => props.sessions.filter((s) => !s.current));

onMounted(() => {
    const sample = props.qaSample;
    if (!sample) return;
    if (sample.step === 'rotation') Object.assign(rotation, { step: 'scan', secret: sample.key, svg: sample.svg, expires: sample.expires_at });
    else recovery.codes = sample.codes;
});
</script>

<template>
    <Head :title="trans('account.title')" />
    <div class="flex flex-col gap-32" data-testid="ADM-51" :data-qa-state="state">
        <PageHeader :title="trans('account.title')" :crumbs="[{ label: trans('shell.groups.settings') }]" :description="trans('account.intro')" />

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('account.error')" :body="trans('ui.state.error_body')" test-id="ADM-51.error" @retry="router.reload()" />
        <div v-else-if="state === 'loading'" class="grid grid-cols-1 gap-24 desktop:grid-cols-2" aria-busy="true" data-testid="ADM-51.loading">
            <div v-for="n in 4" :key="n" class="flex flex-col gap-12 rounded-sm border border-line bg-surface p-16">
                <Skeleton shape="text" class="h-20 w-200" /><Skeleton shape="text" class="w-full" />
                <Skeleton class="h-40 w-full" /><Skeleton class="h-32 w-160" />
            </div>
        </div>
        <div v-else class="grid grid-cols-1 items-start gap-24 desktop:grid-cols-2">
            <!-- Profile -->
            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" data-testid="ADM-51.profile" aria-labelledby="adm51-profile">
                <h2 id="adm51-profile" class="text-headline text-ink">{{ trans('account.profile.title') }}</h2>
                <dl class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                    <div class="flex flex-col gap-2"><dt class="text-caption text-ink-3">{{ trans('account.profile.name') }}</dt><dd class="text-admin-base text-ink">{{ account.name }}</dd></div>
                    <div class="flex flex-col gap-2"><dt class="text-caption text-ink-3">{{ trans('account.profile.email') }}</dt><dd class="text-admin-base text-ink" data-testid="ADM-51.profile.email"><template v-for="(part, i) in emailParts" :key="i">{{ part }}<wbr /></template></dd></div>
                    <div class="flex flex-col gap-2"><dt class="text-caption text-ink-3">{{ trans('account.profile.roles') }}</dt><dd class="text-admin-base text-ink">{{ account.roles.length > 0 ? account.roles.map(roleLabel).join(', ') : trans('account.profile.no_roles') }}</dd></div>
                    <div class="flex flex-col gap-2"><dt class="text-caption text-ink-3">{{ trans('account.profile.last_login') }}</dt><dd class="text-admin-base text-ink tabular-nums">{{ formatDateTime(account.last_login_at) }}</dd></div>
                </dl>
                <p class="text-admin-base text-ink-3">{{ trans('account.profile.managed') }}</p>
            </section>

            <!-- Password -->
            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" data-testid="ADM-51.password" aria-labelledby="adm51-password">
                <div class="flex flex-col gap-4">
                    <h2 id="adm51-password" class="text-headline text-ink">{{ trans('account.password.title') }}</h2>
                    <p class="text-admin-base text-ink-2">{{ trans('account.password.body') }}</p>
                </div>
                <form class="flex flex-col gap-16" novalidate @submit.prevent="changePassword()">
                    <Field :label="trans('account.password.current')" :error="passwordErrors.current_password" required><Input v-model="password.current_password" type="password" autocomplete="current-password" data-testid="ADM-51.password.current" /></Field>
                    <Field :label="trans('account.password.new')" :hint="trans('account.password.new_hint', { min: String(passwordMinLength) })" :error="passwordErrors.password" required><Input v-model="password.password" type="password" autocomplete="new-password" data-testid="ADM-51.password.new" /></Field>
                    <Field :label="trans('account.password.confirmation')" :error="passwordErrors.password_confirmation" required><Input v-model="password.password_confirmation" type="password" autocomplete="new-password" data-testid="ADM-51.password.confirmation" /></Field>
                    <div class="flex flex-wrap items-center gap-12">
                        <Button type="submit" size="sm" variant="primary" :loading="passwordBusy" data-testid="ADM-51.password.submit">{{ trans('account.password.submit') }}</Button>
                        <DialogError :message="passwordErrors.form" test-id="ADM-51.password.error" />
                    </div>
                </form>
            </section>

            <!-- Two-factor rotation -->
            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" data-testid="ADM-51.two-factor" aria-labelledby="adm51-2fa" :data-step="rotation.step">
                <div class="flex flex-col gap-4">
                    <h2 id="adm51-2fa" class="text-headline text-ink">{{ trans('account.two_factor.title') }}</h2>
                    <p class="text-admin-base text-ink-2 tabular-nums">{{ account.two_factor_confirmed_at ? trans('account.two_factor.on', { date: formatDate(account.two_factor_confirmed_at) }) : trans('account.two_factor.off') }}</p>
                </div>
                <template v-if="rotation.step === 'idle'">
                    <p v-if="account.rotation_expires_at" class="text-admin-base text-warning" data-testid="ADM-51.rotation.pending">{{ trans('account.two_factor.pending', { time: formatTime(account.rotation_expires_at) }) }}</p>
                    <p class="text-admin-base text-ink-2">{{ trans('account.two_factor.rotate_body') }}</p>
                    <div class="flex flex-wrap gap-8">
                        <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" data-testid="ADM-51.rotation.begin" @click="(rotation.step = 'code', (rotation.error = null))">{{ account.rotation_expires_at ? trans('account.two_factor.restart') : trans('account.two_factor.rotate') }}</Button>
                        <Button v-if="account.rotation_expires_at" size="sm" variant="ghost" data-testid="ADM-51.rotation.cancel-pending" @click="cancelRotation()">{{ trans('account.two_factor.cancel') }}</Button>
                    </div>
                </template>
                <form v-else-if="rotation.step === 'code'" class="flex flex-col gap-16" novalidate @submit.prevent="startRotation()">
                    <Field :label="trans('account.two_factor.code')" :hint="trans('account.two_factor.code_hint')" :error="rotation.error" required>
                        <Input v-model="rotation.code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" tnum class="w-160" data-autofocus data-testid="ADM-51.rotation.code" />
                    </Field>
                    <div class="flex flex-wrap gap-8">
                        <Button type="submit" size="sm" variant="primary" :loading="rotation.busy" data-testid="ADM-51.rotation.start">{{ trans('account.two_factor.start') }}</Button>
                        <Button size="sm" variant="ghost" :disabled="rotation.busy" @click="cancelRotation()">{{ trans('account.two_factor.cancel') }}</Button>
                    </div>
                </form>
                <div v-else class="flex flex-col gap-16" data-testid="ADM-51.rotation.scan">
                    <p class="text-admin-base text-ink">{{ trans('account.two_factor.scan') }}</p>
                    <div class="flex flex-wrap items-start gap-24">
                        <div class="rounded-sm bg-qr-bg p-16"><img v-if="qrSrc" :src="qrSrc" :alt="trans('account.two_factor.qr_alt')" class="size-160" data-testid="ADM-51.rotation.qr" /></div>
                        <div class="flex flex-col gap-4">
                            <p class="text-caption text-ink-2">{{ trans('account.two_factor.key') }}</p>
                            <code class="sc-key flex flex-col font-ui text-admin-base text-ink tabular-nums" data-testid="ADM-51.rotation.key"><span v-for="line in secretLines" :key="line" class="whitespace-nowrap">{{ line }}</span></code>
                            <Button size="sm" variant="ghost" :icon="PhCopy" class="-ml-12 self-start" @click="copySecret()">{{ rotation.copied ? trans('account.two_factor.copied') : trans('account.two_factor.copy') }}</Button>
                            <p class="text-admin-base text-ink-3 tabular-nums">{{ trans('account.two_factor.expires', { time: formatTime(rotation.expires) }) }}</p>
                        </div>
                    </div>
                    <form class="flex flex-col gap-16" novalidate @submit.prevent="confirmRotation()">
                        <Field :label="trans('account.two_factor.new_code')" :hint="trans('account.two_factor.new_code_hint')" :error="rotation.error" required>
                            <Input v-model="rotation.newCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" tnum class="w-160" data-testid="ADM-51.rotation.new-code" />
                        </Field>
                        <div class="flex flex-wrap gap-8">
                            <Button type="submit" size="sm" variant="primary" :loading="rotation.busy" data-testid="ADM-51.rotation.confirm">{{ trans('account.two_factor.confirm') }}</Button>
                            <Button size="sm" variant="ghost" :disabled="rotation.busy" data-testid="ADM-51.rotation.cancel" @click="cancelRotation()">{{ trans('account.two_factor.cancel') }}</Button>
                        </div>
                    </form>
                </div>
            </section>

            <!-- Recovery codes -->
            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" data-testid="ADM-51.recovery" aria-labelledby="adm51-recovery">
                <div class="flex flex-col gap-4">
                    <h2 id="adm51-recovery" class="text-headline text-ink">{{ trans('account.recovery.title') }}</h2>
                    <p class="text-admin-base text-ink-2">{{ trans('account.recovery.body') }}</p>
                </div>
                <div v-if="recovery.codes.length > 0" class="@container flex flex-col gap-12" data-testid="ADM-51.recovery.codes">
                    <p class="text-admin-base-strong text-ink">{{ trans('account.recovery.list_title') }}</p>
                    <!-- DQ-619: two columns only where two codes fit with a 24 gap; a narrower card lists them in one column. -->
                    <ol class="grid grid-cols-1 gap-x-24 gap-y-4 rounded-sm border border-line-subtle bg-raised px-16 py-12 font-ui text-admin-base text-ink tabular-nums @xl:grid-cols-2">
                        <li v-for="c in recovery.codes" :key="c" class="sc-key whitespace-nowrap">{{ c }}</li>
                    </ol>
                    <p class="text-admin-base text-ink-3">{{ trans('account.recovery.list_hint') }}</p>
                    <div class="flex flex-wrap gap-8">
                        <Button size="sm" variant="secondary" :icon="PhDownloadSimple" :href="recoveryFile" external download="speedclub-admin-recovery-codes.txt">{{ trans('account.recovery.download') }}</Button>
                        <Button size="sm" variant="ghost" :icon="PhEyeSlash" data-testid="ADM-51.recovery.hide" @click="recovery.codes = []">{{ trans('account.recovery.hide') }}</Button>
                    </div>
                </div>
                <form v-else-if="recovery.mode !== 'idle'" class="flex flex-col gap-16" novalidate @submit.prevent="recoveryStep()">
                    <p v-if="recovery.mode === 'regenerate'" class="text-admin-base text-warning">{{ trans('account.recovery.regenerate_body') }}</p>
                    <Field :label="trans('account.two_factor.code')" :hint="trans('account.two_factor.code_hint')" :error="recovery.error" required>
                        <Input v-model="recovery.code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" tnum class="w-160" data-autofocus data-testid="ADM-51.recovery.code" />
                    </Field>
                    <div class="flex flex-wrap gap-8">
                        <Button type="submit" size="sm" variant="primary" :loading="recovery.busy" data-testid="ADM-51.recovery.submit">{{ recovery.mode === 'regenerate' ? trans('account.recovery.regenerate') : trans('account.recovery.show') }}</Button>
                        <Button size="sm" variant="ghost" :disabled="recovery.busy" @click="(recovery.mode = 'idle', (recovery.code = ''), (recovery.error = null))">{{ trans('account.two_factor.cancel') }}</Button>
                    </div>
                </form>
                <div v-else class="flex flex-wrap gap-8">
                    <Button size="sm" variant="secondary" :icon="PhEye" :disabled="!account.two_factor_confirmed_at" data-testid="ADM-51.recovery.show" @click="(recovery.mode = 'show', (recovery.error = null))">{{ trans('account.recovery.show') }}</Button>
                    <Button size="sm" variant="secondary" :icon="PhKey" :disabled="!account.two_factor_confirmed_at" data-testid="ADM-51.recovery.regenerate" @click="(recovery.mode = 'regenerate', (recovery.error = null))">{{ trans('account.recovery.regenerate') }}</Button>
                </div>
            </section>

            <!-- Sessions -->
            <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16 desktop:col-span-2" data-testid="ADM-51.sessions" aria-labelledby="adm51-sessions">
                <div class="flex flex-wrap items-start justify-between gap-12">
                    <div class="flex flex-col gap-4">
                        <h2 id="adm51-sessions" class="text-headline text-ink">{{ trans('account.sessions.title') }}</h2>
                        <p class="text-admin-base text-ink-2">{{ trans('account.sessions.body') }}</p>
                    </div>
                    <Button v-if="others.length > 0" size="sm" variant="secondary" :icon="PhSignOut" data-testid="ADM-51.sessions.others" @click="(action.reset(), (othersOpen = true))">{{ trans('account.sessions.end_others') }}</Button>
                </div>
                <ul class="flex flex-col rounded-sm border border-line-subtle">
                    <li v-for="s in sessions" :key="s.handle" class="flex min-h-48 flex-wrap items-center gap-x-12 gap-y-2 border-b border-line-subtle px-12 py-8 text-admin-base last:border-b-0" :data-testid="s.current ? 'ADM-51.sessions.current' : 'ADM-51.sessions.other'">
                        <span class="min-w-0 flex-1 text-ink">{{ deviceText(s) }}</span>
                        <span v-if="s.current" class="text-admin-base-strong text-ink-2">{{ trans('account.sessions.current') }}</span>
                        <span v-else class="text-ink-3 tabular-nums">{{ trans('account.sessions.active', { date: formatDateTime(s.last_active_at) }) }}</span>
                        <Button v-if="!s.current" size="sm" variant="ghost" :icon="PhSignOut" :aria-label="trans('account.sessions.end_label', { device: deviceText(s) })" @click="(action.reset(), (ending = s))">{{ trans('account.sessions.end') }}</Button>
                    </li>
                    <li v-if="sessions.length === 0" class="px-12 py-8 text-admin-base text-ink-3">{{ trans('account.sessions.empty') }}</li>
                </ul>
            </section>
        </div>

        <ConfirmDialog v-model:open="endOpen" :title="trans('account.sessions.end_title')" :body="trans('account.sessions.end_body', { device: ending ? deviceText(ending) : '' })" :confirm-label="trans('account.sessions.end')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-51.end-dialog" @confirm="() => ending && action.run('delete', routeOr('admin.account.sessions.destroy', `/admin/account/sessions/${ending.handle}`, { handle: ending.handle }), {}, { onSuccess: () => (ending = null) })" />
        <ConfirmDialog v-model:open="othersOpen" :title="trans('account.sessions.end_others_title')" :body="trans('account.sessions.end_others_body')" :confirm-label="trans('account.sessions.end_others')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-51.others-dialog" @confirm="() => action.run('post', routeOr('admin.account.sessions.others', '/admin/account/sessions/others'), {}, { onSuccess: () => (othersOpen = false) })" />
    </div>
</template>
