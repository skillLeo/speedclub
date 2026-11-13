<script setup lang="ts">
import { PhDownloadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import Button from '../../../Components/ui/Button.vue';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import { formatDateTime } from '../../../lib/format';
import type { MemberPrivacy } from '../types';

/** ADM-10 "Datenschutz/Einwilligungen": consents, data exports (who asked; the requester downloads an approved staff export), deletion. */
defineProps<{ privacy: MemberPrivacy }>();
const tone = (status: string) => (status === 'ready' ? 'success' : status === 'failed' ? 'danger' : status === 'expired' ? 'neutral' : 'info');
</script>

<template>
    <div class="flex flex-col gap-32" data-testid="ADM-10.privacy">
        <section class="flex flex-col gap-12" :aria-label="trans('members.record.consents')">
            <h2 class="text-headline text-ink">{{ trans('members.record.consents') }}</h2>
            <dl class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.terms') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ privacy.consents.terms_version ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.privacy_version') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ privacy.consents.privacy_version ?? '–' }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.consented_at') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ formatDateTime(privacy.consents.consented_at) }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('members.record.marketing') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ privacy.consents.marketing_consent_at ? formatDateTime(privacy.consents.marketing_consent_at) : trans('members.record.marketing_none') }}</dd>
                </div>
            </dl>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.privacy.exports')">
            <h2 class="text-headline text-ink">{{ trans('members.privacy.exports') }}</h2>
            <p v-if="privacy.exports.length === 0" class="text-admin-base text-ink-2">{{ trans('members.privacy.no_exports') }}</p>
            <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                <li v-for="item in privacy.exports" :key="item.id" class="flex flex-wrap items-center gap-12 border-b border-line-subtle px-12 py-8 last:border-b-0" data-testid="ADM-10.privacy.export">
                    <StatusPill :tone="tone(item.status)" :label="trans(`members.privacy.export_${item.status}`)" />
                    <span class="min-w-0 flex-1 text-admin-base text-ink-2 tabular-nums">
                        {{ item.for_staff ? trans('members.privacy.by_staff', { name: item.requested_by ?? '–' }) : trans('members.privacy.by_member') }} ·
                        {{ formatDateTime(item.requested_at) }}<template v-if="item.expires_at"> · {{ trans('members.privacy.until', { date: formatDateTime(item.expires_at) }) }}</template>
                    </span>
                    <Button v-if="item.download" size="sm" :icon="PhDownloadSimple" :href="item.download" external data-testid="ADM-10.privacy.download">{{ trans('members.privacy.download') }}</Button>
                </li>
            </ul>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.privacy.deletion')">
            <h2 class="text-headline text-ink">{{ trans('members.privacy.deletion') }}</h2>
            <p class="text-admin-base text-ink-2 tabular-nums">
                {{ privacy.deletion.requested_at ? trans('members.privacy.deletion_requested', { date: formatDateTime(privacy.deletion.requested_at), until: formatDateTime(privacy.deletion.hard_delete_by) }) : trans('members.privacy.deletion_none') }}
            </p>
        </section>
    </div>
</template>
