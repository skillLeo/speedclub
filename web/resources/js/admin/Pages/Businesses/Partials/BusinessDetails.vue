<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhFileText, PhMapPin, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Badge } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatDate, formatNumber } from '../../../lib/format';
import { hasRoute } from '../../../lib/routes';
import { memberHref } from '../../Moderation/shared';
import { WEEKDAYS, type BusinessDetail } from '../shared';

/**
 * What staff check before verifying a business (ADM-55 pane, ADM-56 overview; 09 §8.10): the Impressum fields of § 5 DDG with what is
 * missing, the applicant's note on documents, address and map point, website, the applicant (@username, never an e-mail), services,
 * opening hours, the team and the portfolio. Text only as the applicant wrote it.
 */
const props = withDefaults(defineProps<{ business: BusinessDetail; compact?: boolean; testId: string }>(), { compact: false });

const b = computed(() => props.business);
const i = computed(() => b.value.impressum);
const addressLines = computed(() => [i.value.street, [i.value.postcode, i.value.city].filter(Boolean).join(' '), i.value.country].filter((line): line is string => typeof line === 'string' && line.trim() !== ''));
const coordinates = computed(() => (b.value.point.lat !== null && b.value.point.lng !== null ? `${b.value.point.lat.toFixed(4)}, ${b.value.point.lng.toFixed(4)}` : null));
const memberLink = computed(() => (hasRoute('admin.members.show') ? memberHref(b.value.owner.id) : null));
const website = computed(() => (i.value.website && /^https:\/\//.test(i.value.website) ? i.value.website : null));

/** The Impressum rows in the order of § 5 DDG; a required one that is empty is flagged. */
const impressumRows = computed(() => {
    const register = b.value.needs_register;
    return [
        { key: 'legal_name', value: i.value.legal_name, required: true },
        { key: 'legal_form', value: trans(`businesses.legal_forms.${i.value.legal_form}`), required: true },
        { key: 'representative', value: i.value.representative, required: true },
        { key: 'email', value: i.value.email, required: true },
        { key: 'phone', value: i.value.phone, required: false },
        { key: 'register_court', value: i.value.register_court, required: register },
        { key: 'register_number', value: i.value.register_number, required: register },
        { key: 'vat_id', value: i.value.vat_id, required: false },
    ];
});
const missing = computed(() => impressumRows.value.filter((row) => row.required && !row.value).length + (addressLines.value.length < 2 ? 1 : 0));

const hours = computed(() =>
    WEEKDAYS.map((day) => {
        const slots = b.value.opening_hours[day] ?? [];
        return { day, text: slots.length === 0 ? trans('businesses.detail.closed') : slots.map(([from, to]) => `${from}–${to}`).join(', ') };
    }),
);
const hasHours = computed(() => WEEKDAYS.some((day) => (b.value.opening_hours[day] ?? []).length > 0));
</script>

<template>
    <div class="flex flex-col gap-24" :data-testid="testId">
        <div class="flex flex-col gap-16" :class="compact ? '' : 'desktop:flex-row'">
            <img v-if="b.cover" :src="b.cover" :alt="trans('businesses.detail.cover', { name: b.name })" class="aspect-video shrink-0 rounded-sm object-cover" :class="compact ? 'w-full max-w-480' : 'w-full desktop:w-320'" :data-testid="`${testId}.cover`" />
            <div class="flex min-w-0 grow flex-col gap-12">
                <div class="flex items-center gap-12">
                    <img v-if="b.logo" :src="b.logo" :alt="trans('businesses.detail.logo', { name: b.name })" class="size-48 shrink-0 rounded-sm border border-line-subtle object-cover" />
                    <div class="flex min-w-0 flex-col gap-2">
                        <span class="text-caption text-ink-3">{{ trans('businesses.detail.applicant') }}</span>
                        <span class="flex flex-wrap items-center gap-x-8 text-admin-base text-ink">
                            <Link v-if="memberLink" :href="memberLink" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs hover:underline']" :data-testid="`${testId}.owner`">{{ `@${b.owner.username ?? '–'}` }}</Link>
                            <span v-else class="sc-key">{{ `@${b.owner.username ?? '–'}` }}</span>
                            <span v-if="b.owner.joined_at" class="text-caption text-ink-3 tabular-nums">{{ trans('businesses.detail.member_since', { date: formatDate(b.owner.joined_at) }) }}</span>
                        </span>
                    </div>
                </div>
                <p v-if="!b.cover" class="text-caption text-ink-3" :data-testid="`${testId}.no-cover`">{{ trans('businesses.detail.no_cover') }}</p>
            </div>
        </div>

        <section class="flex flex-col gap-8" :aria-labelledby="`${testId}-impressum`">
            <div class="flex flex-wrap items-center gap-8">
                <h3 :id="`${testId}-impressum`" class="text-admin-base-strong text-ink">{{ trans('businesses.detail.impressum') }}</h3>
                <Badge v-if="missing > 0" tone="warning" tnum :data-testid="`${testId}.missing`">{{ trans('businesses.detail.missing', { count: formatNumber(missing) }) }}</Badge>
                <Badge v-else tone="success">{{ trans('businesses.detail.complete') }}</Badge>
            </div>
            <dl class="grid grid-cols-1 gap-x-24 gap-y-12 tablet:grid-cols-2" :data-testid="`${testId}.impressum`">
                <div class="flex flex-col gap-2 tablet:col-span-2">
                    <dt class="text-caption text-ink-3">{{ trans('businesses.impressum.address') }}</dt>
                    <dd class="flex items-start gap-8 text-admin-base text-ink">
                        <PhMapPin :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />
                        <span class="flex flex-col">
                            <span v-for="line in addressLines" :key="line">{{ line }}</span>
                            <span v-if="addressLines.length === 0" class="text-warning">{{ trans('businesses.detail.not_given') }}</span>
                            <span v-if="coordinates" class="text-caption text-ink-3 tabular-nums">{{ coordinates }}</span>
                        </span>
                    </dd>
                </div>
                <div v-for="row in impressumRows" :key="row.key" class="flex min-w-0 flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans(`businesses.impressum.${row.key}`) }}</dt>
                    <dd class="min-w-0 break-words text-admin-base" :class="row.value ? 'text-ink' : row.required ? 'flex items-center gap-4 text-warning' : 'text-ink-3'">
                        <PhWarning v-if="!row.value && row.required" :size="16" class="shrink-0" aria-hidden="true" />
                        {{ row.value || (row.required ? trans('businesses.detail.missing_field') : trans('businesses.detail.not_given')) }}
                    </dd>
                </div>
                <div class="flex min-w-0 flex-col gap-2 tablet:col-span-2">
                    <dt class="text-caption text-ink-3">{{ trans('businesses.impressum.website') }}</dt>
                    <dd class="text-admin-base">
                        <a v-if="website" :href="website" target="_blank" rel="noopener noreferrer nofollow" :class="[focusRing, 'inline-flex min-h-32 max-w-full items-center gap-4 rounded-xs text-ink hover:underline']" :data-testid="`${testId}.website`">
                            <span class="truncate">{{ website }}</span><PhArrowSquareOut :size="16" class="shrink-0" aria-hidden="true" /><span class="sr-only">{{ trans('businesses.detail.new_tab') }}</span>
                        </a>
                        <span v-else class="text-ink-3">{{ i.website || trans('businesses.detail.not_given') }}</span>
                    </dd>
                </div>
            </dl>
        </section>

        <section class="flex flex-col gap-4">
            <h3 class="text-admin-base-strong text-ink">{{ trans('businesses.detail.document_note') }}</h3>
            <p class="flex max-w-720 items-start gap-8 whitespace-pre-line text-admin-base" :class="b.document_note ? 'text-ink' : 'text-ink-3'" :data-testid="`${testId}.document-note`">
                <PhFileText :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />{{ b.document_note || trans('businesses.detail.no_document_note') }}
            </p>
        </section>

        <section class="flex flex-col gap-4">
            <h3 class="text-admin-base-strong text-ink">{{ trans('businesses.detail.about') }}</h3>
            <p class="max-w-720 whitespace-pre-line text-admin-base" :class="b.about ? 'text-ink' : 'text-ink-3'">{{ b.about || trans('businesses.detail.no_about') }}</p>
        </section>

        <div class="grid grid-cols-1 gap-24" :class="compact ? '' : 'tablet:grid-cols-2'">
            <section class="flex flex-col gap-8">
                <h3 class="text-admin-base-strong text-ink">{{ trans('businesses.detail.services') }}</h3>
                <ul v-if="b.services.length > 0" class="flex flex-wrap gap-8">
                    <li v-for="service in b.services" :key="service"><Badge tone="neutral">{{ service }}</Badge></li>
                </ul>
                <p v-else class="text-admin-base text-ink-3">{{ trans('businesses.detail.no_services') }}</p>
            </section>
            <section class="flex flex-col gap-8">
                <h3 class="text-admin-base-strong text-ink">{{ trans('businesses.detail.hours') }}</h3>
                <dl v-if="hasHours" class="flex flex-col gap-2 text-admin-base tabular-nums">
                    <div v-for="row in hours" :key="row.day" class="flex gap-16">
                        <dt class="w-40 shrink-0 text-ink-3">{{ trans(`businesses.weekdays.${row.day}`) }}</dt>
                        <dd class="text-ink">{{ row.text }}</dd>
                    </div>
                </dl>
                <p v-else class="text-admin-base text-ink-3">{{ trans('businesses.detail.no_hours') }}</p>
            </section>
        </div>

        <dl class="grid grid-cols-1 gap-x-24 gap-y-12 border-t border-line-subtle pt-16 tablet:grid-cols-2">
            <div class="flex flex-col gap-2">
                <dt class="text-caption text-ink-3">{{ trans('businesses.detail.team') }}</dt>
                <dd class="flex flex-wrap gap-x-12 gap-y-4 text-admin-base text-ink">
                    <span v-for="member in b.team" :key="member.username ?? member.role" class="sc-key">{{ `@${member.username ?? '–'}` }} <span class="text-caption text-ink-3">{{ trans(`businesses.roles.${member.role}`) }}</span></span>
                    <span v-if="b.team.length === 0" class="text-ink-3">–</span>
                </dd>
            </div>
            <div class="flex flex-col gap-2">
                <dt class="text-caption text-ink-3">{{ trans('businesses.detail.portfolio') }}</dt>
                <dd class="text-admin-base text-ink tabular-nums">{{ trans('businesses.detail.tags', { accepted: formatNumber(b.tags.accepted), pending: formatNumber(b.tags.pending) }) }}</dd>
            </div>
        </dl>
    </div>
</template>
