<script setup lang="ts">
import { PhEye } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import Button from '../../../Components/ui/Button.vue';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import type { MemberOverview } from '../types';

/** ADM-10 "Übersicht": profile, status, restrictions with their end and decision, counters, consent dates. */
defineProps<{ member: MemberOverview; email: string; revealed: boolean; canReveal: boolean; revealing: boolean; revealError: string | null; canLift: (type: string) => boolean }>();
const emit = defineEmits<{ reveal: []; lift: [type: 'messaging' | 'publishing' | 'suspension'] }>();
</script>

<template>
    <div class="flex flex-col gap-32" data-testid="ADM-10.overview">
        <section class="flex flex-col gap-12" :aria-label="trans('members.record.profile')">
            <h2 class="text-headline text-ink">{{ trans('members.record.profile') }}</h2>
            <dl class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.columns.username') }}</dt>
                    <dd class="sc-key text-admin-base text-ink">{{ member.username ? `@${member.username}` : trans('members.no_username') }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.columns.display_name') }}</dt>
                    <dd class="text-admin-base text-ink">{{ member.display_name ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.columns.email') }}</dt>
                    <dd class="flex flex-wrap items-center gap-8 text-admin-base text-ink">
                        <span class="sc-key tabular-nums" data-testid="ADM-10.email">{{ email }}</span>
                        <Button v-if="canReveal && !revealed" size="sm" variant="ghost" :icon="PhEye" :loading="revealing" data-testid="ADM-10.reveal" @click="emit('reveal')">{{ trans('members.record.reveal') }}</Button>
                        <span v-if="revealed" class="text-admin-base text-ink-3">{{ trans('members.record.revealed_note') }}</span>
                    </dd>
                    <p v-if="revealError" class="text-admin-base text-danger" role="alert">{{ revealError }}</p>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.email_verified') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ member.email_verified_at ? formatDateTime(member.email_verified_at) : trans('members.record.not_verified') }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.city') }}</dt>
                    <dd class="text-admin-base text-ink">{{ member.city ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.signup_ref') }}</dt>
                    <dd class="text-admin-base text-ink">{{ member.signup_ref ? trans(`members.record.ref_${member.signup_ref}`) : trans('members.record.ref_none') }}</dd>
                </div>
                <div class="flex flex-col gap-2 tablet:col-span-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.bio') }}</dt>
                    <dd class="max-w-720 text-admin-base text-ink">{{ member.bio ?? '–' }}</dd>
                </div>
            </dl>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.record.restrictions')" data-testid="ADM-10.restrictions">
            <h2 class="text-headline text-ink">{{ trans('members.record.restrictions') }}</h2>
            <p v-if="member.restrictions.length === 0 && !member.suspended" class="text-admin-base text-ink-2">{{ trans('members.record.no_restrictions') }}</p>
            <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                <li v-for="item in member.restrictions" :key="item.type" class="flex flex-wrap items-center gap-12 border-b border-line-subtle px-12 py-8 last:border-b-0">
                    <StatusPill :tone="item.type === 'suspension' ? 'danger' : 'warning'" :label="trans(`decisions.measures.${item.type}`)" />
                    <span class="min-w-0 flex-1 text-admin-base text-ink-2 tabular-nums">
                        {{ item.until ? trans('members.record.until', { date: formatDateTime(item.until) }) : trans('members.record.no_end') }}
                        <template v-if="item.decided_at"> · {{ trans('members.record.decided', { date: formatDate(item.decided_at) }) }}</template>
                    </span>
                    <Button v-if="item.decision_id && canLift(item.type)" size="sm" variant="secondary" :data-testid="`ADM-10.lift.${item.type}`" @click="emit('lift', item.type)">{{ trans('members.actions.lift') }}</Button>
                </li>
            </ul>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.record.counters')">
            <h2 class="text-headline text-ink">{{ trans('members.record.counters') }}</h2>
            <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-5" data-qa-exempt="hairline">
                <!-- The value sits at the foot of each tile, so a two-line label never lifts its number off the row (DQ-534). -->
                <div v-for="key in (['vehicles', 'followers', 'following', 'reports_as_target', 'decisions'] as const)" :key="key" class="flex flex-col justify-between gap-4 bg-surface px-16 py-12">
                    <dt class="text-caption text-ink-2">{{ trans(`members.counters.${key}`) }}</dt>
                    <dd class="t-title-2 text-ink tabular-nums">{{ formatNumber(member.counters[key]) }}</dd>
                </div>
            </dl>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.record.consents')">
            <h2 class="text-headline text-ink">{{ trans('members.record.consents') }}</h2>
            <dl class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.terms') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ member.consents.terms_version ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.privacy_version') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ member.consents.privacy_version ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.consented_at') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ formatDateTime(member.consents.consented_at) }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.marketing') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ member.consents.marketing_consent_at ? formatDateTime(member.consents.marketing_consent_at) : trans('members.record.marketing_none') }}</dd>
                </div>
            </dl>
        </section>
    </div>
</template>
