<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import { focusRing } from '../../../Components/ui/styles';
import { formatDate, formatNumber } from '../../../lib/format';
import { hasRoute, routeOr } from '../../../lib/routes';
import type { MemberReports } from '../types';

/** ADM-10 "Meldungen": cases about the member (with their decision) and reports the member filed, linked to ADM-21 once it exists. */
defineProps<{ reports: MemberReports }>();
const caseHref = (id: string | null): string | null => (id !== null && hasRoute('admin.moderation.cases.show') ? routeOr('admin.moderation.cases.show', '/admin', { case: id }) : null);
/** The whole target line ("Fahrzeug · Toyota GR Yaris GXPA16"), also the title of its truncated cell. */
const targetText = (item: { target_type: string; target_label?: string | null }): string =>
    item.target_label ? `${trans(`members.reports.type_${item.target_type}`)} · ${item.target_label}` : trans(`members.reports.type_${item.target_type}`);
const tone = (status: string | null) => (status === 'new' ? 'info' : status === 'in_review' ? 'warning' : 'neutral');
</script>

<template>
    <div class="flex flex-col gap-32" data-testid="ADM-10.reports">
        <section class="flex flex-col gap-12" :aria-label="trans('members.reports.as_target')">
            <h2 class="text-title-s text-ink">{{ trans('members.reports.as_target') }}</h2>
            <p v-if="reports.as_target.length === 0" class="text-supporting text-ink-2">{{ trans('members.reports.none_target') }}</p>
            <ScrollRegion v-else :label="trans('members.reports.as_target')">
                <table class="w-full border-collapse text-supporting">
                    <caption class="sr-only">{{ trans('members.reports.as_target') }}</caption>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                            <th scope="col" class="px-12">{{ trans('members.reports.case') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.status') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.target') }}</th>
                            <th scope="col" class="px-12 text-right">{{ trans('members.reports.count') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.decision') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.opened') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in reports.as_target" :key="item.case_id" class="h-40 border-b border-line-subtle last:border-b-0">
                            <td class="px-12">
                                <component :is="caseHref(item.case_id) ? Link : 'span'" :href="caseHref(item.case_id) ?? undefined" :class="[caseHref(item.case_id) ? `${focusRing} underline underline-offset-4` : '', 'sc-key inline-flex h-32 items-center rounded-xs text-ink tabular-nums']">
                                    {{ item.case_id.slice(-8).toUpperCase() }}
                                </component>
                                <span class="ml-8 text-caption text-ink-3">{{ trans(`members.reports.origin_${item.origin}`) }}</span>
                            </td>
                            <td class="px-12"><StatusPill :tone="tone(item.status)" :label="trans(`members.reports.status_${item.status}`)" /></td>
                            <td class="max-w-240 px-12"><span class="block truncate text-ink-2" :title="targetText(item)">{{ targetText(item) }}</span></td>
                            <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(item.report_count) }}</td>
                            <td class="px-12 text-ink-2">{{ item.decision ? trans(`members.reports.action_${item.decision.action}`) : '–' }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDate(item.created_at) }}</td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.reports.as_reporter')">
            <h2 class="text-title-s text-ink">{{ trans('members.reports.as_reporter') }}</h2>
            <p v-if="reports.as_reporter.length === 0" class="text-supporting text-ink-2">{{ trans('members.reports.none_reporter') }}</p>
            <ScrollRegion v-else :label="trans('members.reports.as_reporter')">
                <table class="w-full border-collapse text-supporting">
                    <caption class="sr-only">{{ trans('members.reports.as_reporter') }}</caption>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                            <th scope="col" class="px-12">{{ trans('members.reports.case') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.target') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.reason') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.status') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.reports.filed') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in reports.as_reporter" :key="item.id" class="h-40 border-b border-line-subtle last:border-b-0">
                            <td class="px-12">
                                <component :is="caseHref(item.case_id) ? Link : 'span'" :href="caseHref(item.case_id) ?? undefined" :class="[caseHref(item.case_id) ? `${focusRing} underline underline-offset-4` : '', 'sc-key inline-flex h-32 items-center rounded-xs text-ink tabular-nums']">
                                    {{ item.case_id ? item.case_id.slice(-8).toUpperCase() : '–' }}
                                </component>
                            </td>
                            <td class="max-w-240 px-12"><span class="block truncate text-ink-2" :title="targetText(item)">{{ targetText(item) }}</span></td>
                            <td class="px-12 text-ink-2">{{ trans(`members.reports.reason_${item.reason}`) }}</td>
                            <td class="px-12"><StatusPill v-if="item.case_status" :tone="tone(item.case_status)" :label="trans(`members.reports.status_${item.case_status}`)" /></td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDate(item.created_at) }}</td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>
    </div>
</template>
