<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Button, DateRangeField, Drawer, Field, Input, Select, SegmentedControl, Textarea } from '../../../Components/ui';
import { routeOr } from '../../../lib/routes';
import type { RequestType } from '../shared';

/**
 * ADM-45 "Anfrage erfassen" (privacy.process): type, how it came in, a member (@username) or an external person (name, address), the reply
 * language, when it arrived (empty = today) and what was asked. The server sets the deadline (one month).
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ failed?: boolean; sample?: boolean }>(), { failed: false, sample: false });

const TYPES: RequestType[] = ['access', 'export', 'erasure', 'rectification', 'objection', 'restriction'];
const action = useAdminAction();
const form = reactive({ type: 'access', source: 'email', who: 'member', member: '', requester_name: '', requester_email: '', locale: 'de', received_at: '', details: '' });
const errors = reactive<Record<string, string | null>>({ member: null, requester_email: null });
const typeOptions = computed(() => TYPES.map((t) => ({ value: t, label: `${trans(`privacy.types.${t}`)} (${trans('privacy.article', { article: String({ access: 15, rectification: 16, erasure: 17, restriction: 18, export: 20, objection: 21 }[t]) })})` })));
const sourceOptions = computed(() => (['email', 'post', 'support', 'other'] as const).map((v) => ({ value: v, label: trans(`privacy.sources.${v}`) })));
const whoOptions = computed(() => [
    { value: 'member', label: trans('privacy.create.who_member') },
    { value: 'external', label: trans('privacy.create.who_external') },
]);
const localeOptions = computed(() => (['de', 'en'] as const).map((v) => ({ value: v, label: trans(`team.invite.locales.${v}`) })));

watch(open, (value) => {
    if (!value) return;
    Object.assign(form, { type: 'access', source: 'email', who: 'member', member: '', requester_name: '', requester_email: '', locale: 'de', received_at: '', details: '' });
    errors.member = null;
    errors.requester_email = null;
    action.reset();
    if (props.sample) Object.assign(form, { type: 'access', source: 'email', who: 'member', member: '@lukas.sc', details: 'Bitte schickt mir alle Daten, die ihr über mich gespeichert habt, inklusive der Fahrzeugfotos.' });
    if (props.failed) action.error.value = trans('ui.state.server_error');
}, { immediate: true });

function submit(): void {
    errors.member = form.who === 'member' && form.member.replace(/^@/, '').trim() === '' ? trans('privacy.create.errors.member') : null;
    errors.requester_email = form.who === 'external' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.requester_email.trim()) ? trans('privacy.create.errors.email') : null;
    if (errors.member || errors.requester_email) return;
    const data: Record<string, unknown> = {
        type: form.type,
        source: form.source,
        locale: form.locale,
        details: form.details.trim() === '' ? null : form.details.trim(),
        received_at: form.received_at === '' ? null : form.received_at,
        ...(form.who === 'member' ? { member: form.member.trim() } : { requester_name: form.requester_name.trim() || null, requester_email: form.requester_email.trim() }),
    };
    action.run('post', routeOr('admin.privacy.requests.store', '/admin/privacy/requests'), data, { sensitive: true, onSuccess: () => (open.value = false) });
}
</script>

<template>
    <Drawer v-model:open="open" :title="trans('privacy.create.title')" :description="trans('privacy.create.body')" :dismissible="!action.processing.value" test-id="ADM-45.create-drawer">
        <form class="flex flex-col gap-16" novalidate @submit.prevent="submit()">
            <StateBlock v-if="action.error.value" kind="error" :title="trans('ui.state.error_title')" :body="action.error.value" :retryable="false" test-id="ADM-45.create.server-error" />
            <Field :label="trans('privacy.create.type')" required><Select v-model="form.type" :options="typeOptions" data-testid="ADM-45.create.type" /></Field>
            <Field :label="trans('privacy.create.source')" required><Select v-model="form.source" :options="sourceOptions" data-testid="ADM-45.create.source" /></Field>
            <div class="flex flex-col gap-8">
                <span class="text-admin-base-strong text-ink">{{ trans('privacy.create.who') }}</span>
                <SegmentedControl v-model="form.who" :options="whoOptions" :label="trans('privacy.create.who')" data-testid="ADM-45.create.who" />
            </div>
            <Field v-if="form.who === 'member'" :label="trans('privacy.create.member')" :hint="trans('privacy.create.member_hint')" :error="errors.member" required>
                <Input v-model="form.member" maxlength="40" autocomplete="off" data-testid="ADM-45.create.member" />
            </Field>
            <template v-else>
                <Field :label="trans('privacy.create.name')" optional><Input v-model="form.requester_name" maxlength="160" autocomplete="off" data-testid="ADM-45.create.name" /></Field>
                <Field :label="trans('privacy.create.email')" :hint="trans('privacy.create.email_hint')" :error="errors.requester_email" required><Input v-model="form.requester_email" type="email" maxlength="191" autocomplete="off" data-testid="ADM-45.create.email" /></Field>
            </template>
            <Field :label="trans('privacy.create.locale')"><Select v-model="form.locale" :options="localeOptions" data-testid="ADM-45.create.locale" /></Field>
            <Field :label="trans('privacy.create.received')" :hint="trans('privacy.create.received_hint')" optional>
                <DateRangeField v-model:from="form.received_at" single test-id="ADM-45.create.received" />
            </Field>
            <Field :label="trans('privacy.create.details')" :hint="trans('privacy.create.details_hint')" optional>
                <Textarea v-model="form.details" :rows="4" :maxlength="5000" show-count data-testid="ADM-45.create.details" />
            </Field>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="action.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button variant="primary" :loading="action.processing.value" data-testid="ADM-45.create.submit" @click="submit()">{{ trans('privacy.create.submit') }}</Button>
        </template>
    </Drawer>
</template>
