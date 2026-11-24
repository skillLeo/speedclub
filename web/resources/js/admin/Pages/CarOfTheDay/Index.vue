<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhDotsThree, PhLockSimple } from '@phosphor-icons/vue';
import { getActiveLanguage, trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import VehicleThumb from '../../Components/patterns/VehicleThumb.vue';
import ActivityTimeline, { type TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, ConfirmDialog, DropdownMenu, EmptyQueue, IconButton, Skeleton, StatusPill, type MenuEntry } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatNumber, keepShortHyphens } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import type { FeedEntry } from '../Members/types';
import OverrideDialog from './Partials/OverrideDialog.vue';
import { dayLabel, roundTone, shortDayLabel, skipUrl, sourceLabel, statusOf, statusTone, type CotdDay, type VoteRound, type VoteRounds } from './shared';

/**
 * ADM-64 Car of the Day (M5.9d admin, m5.9d contract §3, ADR-510/513): today and the next 14 days, then the last 14 — day, status (auf
 * Start, gewählt, offen, ausgesetzt), car, owner, Bundesland, automatic or team choice, story line. Today and later days: "Anderes Auto
 * festlegen" (OverrideCarOfTheDay; its refusals are field errors in the dialog) and "Tag aussetzen" (SkipCarOfTheDay), each
 * ⚿, audited (activity column). content.view reads, content.edit acts.
 * R4-2.1 "Abstimmungen": the vote rounds of the same range, each with the Picker's suggestions and their votes (all / counted), and how
 * the day was decided; a team choice or skip still wins. The counts are staff data only (contract-cotd-voting V7/V8).
 */
const props = defineProps<{ upcoming: CotdDay[]; past: CotdDay[]; times: { pick_at: string; publish_at: string }; canEdit: boolean; activity: FeedEntry[]; votes?: VoteRounds }>();

const { can } = usePermissions();
const state = usePageState();
const mayEdit = computed(() => props.canEdit && can('content.edit'));
const locale = computed(() => getActiveLanguage());
const label = (day: string): string => dayLabel(day, locale.value);

const statusLabel = (day: CotdDay): string => {
    const status = statusOf(day);
    return trans(`gift.cotd.status.${status}`, { time: status === 'open' ? props.times.pick_at : props.times.publish_at });
};
const vehicleHref = (id: string): string | null => (hasRoute('admin.vehicles.show') ? routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id }) : null);
const memberHref = (id: string): string | null => (hasRoute('admin.members.show') ? routeOr('admin.members.show', `/admin/members/${id}`, { member: id }) : null);

// ---- actions -------------------------------------------------------------------------------------------------------------------
const target = ref<CotdDay | null>(null);
const overrideOpen = ref(false);
const skipOpen = ref(false);
const action = useAdminAction();
function openOverride(day: CotdDay): void {
    target.value = day;
    overrideOpen.value = true;
}
function openSkip(day: CotdDay): void {
    target.value = day;
    action.reset();
    skipOpen.value = true;
}
function menu(day: CotdDay): MenuEntry[] {
    return [
        { key: 'override', label: trans('gift.cotd.actions.override'), testId: 'ADM-64.action.override', onSelect: () => openOverride(day) },
        { key: 'skip', label: trans('gift.cotd.actions.skip'), disabled: day.skipped, testId: 'ADM-64.action.skip', onSelect: () => openSkip(day) },
    ];
}
function skip(): void {
    if (target.value === null) return;
    action.run('post', skipUrl(target.value.day), {}, { sensitive: true, onSuccess: () => (skipOpen.value = false) });
}
const today = computed(() => props.upcoming[0] ?? null);
if (mayEdit.value && today.value) {
    if (qaDialog() === 'override') openOverride(today.value);
    if (qaDialog() === 'skip') openSkip(today.value);
}

const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
// Loading (DQ-P5-105): as many skeleton rows as the section will show (today + 14 days ahead, the last 14 days).
const skeletonRows = (section: { key: string; days: CotdDay[] }): number => section.days.length || (section.key === 'upcoming' ? 15 : 14);
const rounds = computed<VoteRound[]>(() => props.votes?.rounds ?? []);
const roundLabel = (round: VoteRound): string => trans(`gift.cotd.votes.status.${round.status}`, { time: round.status === 'open' ? (props.votes?.closes_at ?? '') : props.times.pick_at });
// R4DQ-34: why the round that opened last has no vote ("Für den 22.11. zu wenige Kandidaten"), instead of "no round yet".
const unavailable = computed<{ title: string; body: string } | null>(() => {
    const current = props.votes?.current;
    if (!props.votes?.enabled || !current || current.unavailable === null) return null;
    const day = shortDayLabel(current.day, locale.value);
    return { title: trans(`gift.cotd.votes.unavailable.${current.unavailable}.title`, { day }), body: trans(`gift.cotd.votes.unavailable.${current.unavailable}.body`) };
});
const sections = computed(() => [
    { key: 'upcoming', title: trans('gift.cotd.upcoming'), caption: trans('gift.cotd.caption_upcoming'), days: props.upcoming },
    { key: 'past', title: trans('gift.cotd.past'), caption: trans('gift.cotd.caption_past'), days: props.past },
]);
</script>

<template>
    <Head :title="trans('gift.cotd.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-64" :data-qa-state="state">
        <PageHeader :title="trans('gift.cotd.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('gift.cotd.intro', { pick: times.pick_at, publish: times.publish_at })" />
        <p v-if="!mayEdit" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-64.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('gift.cotd.view_only') }}</p>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('gift.cotd.error')" :body="trans('ui.state.error_body')" test-id="ADM-64.error" @retry="router.reload()" />
        <div v-else class="flex flex-col gap-24">
            <div class="flex min-w-0 flex-col gap-24">
                <template v-for="section in sections" :key="section.key">
                    <section class="flex flex-col gap-8" :aria-labelledby="`adm64-${section.key}`">
                        <h2 :id="`adm64-${section.key}`" class="text-headline text-ink">{{ section.title }}</h2>
                        <!-- DQ-P5-105: loading draws the same framed table (header, columns, row geometry) with skeleton cells, so nothing jumps. -->
                        <ScrollRegion :label="section.caption" :test-id="state === 'loading' ? `ADM-64.${section.key}.loading` : `ADM-64.${section.key}`" :aria-busy="state === 'loading' ? 'true' : undefined">
                            <table class="w-full border-collapse text-admin-base">
                                <caption class="sr-only">{{ section.caption }}</caption>
                                <thead>
                                    <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.columns.day') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.columns.status') }}</th>
                                        <th scope="col" class="px-12">{{ trans('gift.cotd.columns.car') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.columns.owner') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.columns.bundesland') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.columns.source') }}</th>
                                        <th v-if="mayEdit && section.key === 'upcoming'" scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('gift.cotd.columns.actions') }}</span></th>
                                    </tr>
                                </thead>
                                <tbody v-if="state === 'loading'">
                                    <tr v-for="n in skeletonRows(section)" :key="n" class="border-b border-line-subtle last:border-b-0" aria-hidden="true">
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton shape="text" class="w-80" /></span></td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton class="h-20 w-80 rounded-xs" /></span></td>
                                        <td class="px-12 py-8 align-top">
                                            <div class="flex min-w-0 items-start gap-12">
                                                <span class="flex min-h-32 shrink-0 items-center"><Skeleton class="h-24 w-32 rounded-xs" /></span>
                                                <div class="flex min-w-0 flex-col">
                                                    <span class="flex min-h-32 items-center"><Skeleton shape="text" class="w-200" /></span>
                                                    <span class="flex h-16 items-center"><Skeleton shape="text" class="w-160" /></span>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton shape="text" class="w-96" /></span></td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton shape="text" class="w-96" /></span></td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton shape="text" class="w-80" /></span></td>
                                        <td v-if="mayEdit && section.key === 'upcoming'" class="px-12 py-8 align-top"><span class="flex min-h-32 items-center"><Skeleton class="size-32 rounded-sm" /></span></td>
                                    </tr>
                                </tbody>
                                <tbody v-else>
                                    <!-- R4B-012 (client round 4 hunt): on today's bg-selected row the quiet texts take ink-2; ink-3 fell below 4.5:1 there. -->
                                    <tr v-for="day in section.days" :key="day.day" :class="['border-b border-line-subtle last:border-b-0', day.today ? 'bg-selected' : '']" :aria-current="day.today ? 'date' : undefined" :data-status="statusOf(day)" data-testid="ADM-64.row">
                                        <td class="whitespace-nowrap px-12 py-8 align-top">
                                            <span class="flex min-h-32 flex-col justify-center">
                                                <time :datetime="day.day" class="text-ink tabular-nums">{{ label(day.day) }}</time>
                                                <span v-if="day.today" class="text-caption text-ink-2">{{ trans('gift.cotd.today') }}</span>
                                            </span>
                                        </td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top">
                                            <span class="flex min-h-32 items-center"><StatusPill :tone="statusTone[statusOf(day)]" :label="statusLabel(day)" data-testid="ADM-64.status" /></span>
                                        </td>
                                        <td class="px-12 py-8 align-top">
                                            <div v-if="day.vehicle" class="flex min-w-0 items-start gap-12">
                                                <span class="flex min-h-32 shrink-0 items-center"><VehicleThumb :src="day.vehicle.cover" :focus="day.vehicle.cover_focus" :placeholder="day.vehicle.cover_placeholder" /></span>
                                                <div class="flex min-w-0 flex-col">
                                                    <span class="flex flex-wrap items-center gap-8">
                                                        <component :is="vehicleHref(day.vehicle.id) ? Link : 'span'" :href="vehicleHref(day.vehicle.id) ?? undefined" :class="[vehicleHref(day.vehicle.id) ? `${focusRing} hover:underline` : '', 'inline-flex min-h-32 items-center rounded-xs text-ink']" data-testid="ADM-64.car">{{ keepShortHyphens(day.vehicle.title) }}</component>
                                                        <Badge v-if="day.is_sample">{{ trans('gift.cotd.sample') }}</Badge>
                                                    </span>
                                                    <span class="text-caption" :class="day.story_line || day.today ? 'text-ink-2' : 'text-ink-3'">{{ day.story_line ? `„${keepShortHyphens(day.story_line)}“` : trans('gift.cotd.no_story') }}</span>
                                                </div>
                                            </div>
                                            <p v-else-if="day.skipped && day.skipped_reason" class="flex min-h-32 items-center text-ink-2">{{ trans('gift.cotd.skipped_reason', { reason: day.skipped_reason }) }}</p>
                                            <span v-else class="flex min-h-32 items-center" :class="day.today ? 'text-ink-2' : 'text-ink-3'">–</span>
                                        </td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top">
                                            <component :is="memberHref(day.vehicle.owner.id) ? Link : 'span'" v-if="day.vehicle?.owner" :href="memberHref(day.vehicle.owner.id) ?? undefined" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs text-ink hover:underline']">{{ `@${day.vehicle.owner.username ?? '–'}` }}</component>
                                            <span v-else class="flex min-h-32 items-center" :class="day.today ? 'text-ink-2' : 'text-ink-3'">–</span>
                                        </td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center text-ink-2">{{ day.bundesland ?? '–' }}</span></td>
                                        <td class="whitespace-nowrap px-12 py-8 align-top"><span class="flex min-h-32 items-center text-ink-2">{{ sourceLabel(day) }}</span></td>
                                        <td v-if="mayEdit && section.key === 'upcoming'" class="px-12 py-8 align-top">
                                            <DropdownMenu v-if="day.editable" :items="menu(day)" :label="trans('gift.cotd.actions.menu', { day: label(day.day) })">
                                                <template #trigger>
                                                    <IconButton :icon="PhDotsThree" :label="trans('gift.cotd.actions.menu', { day: label(day.day) })" data-testid="ADM-64.actions" />
                                                </template>
                                            </DropdownMenu>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </ScrollRegion>
                    </section>
                <!-- R4-2.1: the vote rounds with their counts (staff only); R4DQ-34: above the history of the last 14 days. -->
                <section v-if="section.key === 'upcoming'" class="flex flex-col gap-8" aria-labelledby="adm64-votes" data-testid="ADM-64.votes">
                    <h2 id="adm64-votes" class="text-headline text-ink">{{ trans('gift.cotd.votes.title') }}</h2>
                    <p class="max-w-720 text-admin-base text-ink-2">{{ trans('gift.cotd.votes.intro') }}</p>
                    <p v-if="votes && !votes.enabled" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-64.votes.off">
                        <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans(rounds.length > 0 ? 'gift.cotd.votes.off_with_rounds' : 'gift.cotd.votes.off') }}
                    </p>
                    <div v-if="state === 'loading'" class="flex flex-col gap-8" aria-hidden="true" data-testid="ADM-64.votes.loading">
                        <Skeleton v-for="n in 4" :key="n" class="h-40 w-full rounded-xs" />
                    </div>
                    <EmptyQueue v-else-if="rounds.length === 0 && unavailable" compact variant="quiet" :title="unavailable.title" :body="unavailable.body" data-testid="ADM-64.votes.unavailable" />
                    <EmptyQueue v-else-if="rounds.length === 0 && (!votes || votes.enabled)" compact variant="quiet" :title="trans('gift.cotd.votes.empty_title')" :body="trans('gift.cotd.votes.empty_body')" data-testid="ADM-64.votes.empty" />
                    <template v-else-if="rounds.length > 0">
                        <p v-if="unavailable" class="max-w-720 text-admin-base text-ink-2" data-testid="ADM-64.votes.unavailable"><span class="text-admin-base-strong text-ink">{{ unavailable.title }}.</span> {{ unavailable.body }}</p>
                        <ScrollRegion :label="trans('gift.cotd.votes.caption')" test-id="ADM-64.votes.table">
                            <table class="w-full border-collapse text-admin-base">
                                <caption class="sr-only">{{ trans('gift.cotd.votes.caption') }}</caption>
                                <thead>
                                    <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                                        <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('gift.cotd.votes.columns.position') }}</th>
                                        <th scope="col" class="px-12">{{ trans('gift.cotd.votes.columns.car') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('gift.cotd.votes.columns.owner') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('gift.cotd.votes.columns.votes') }}</th>
                                        <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('gift.cotd.votes.columns.counted') }}</th>
                                    </tr>
                                </thead>
                                <tbody v-for="round in rounds" :key="round.day" :data-status="round.status" data-testid="ADM-64.round">
                                    <tr class="h-40 border-b border-line-subtle bg-surface">
                                        <th scope="rowgroup" colspan="5" class="px-12 text-left font-normal">
                                            <span class="flex flex-wrap items-center gap-x-12 gap-y-4">
                                                <time :datetime="round.day" class="text-admin-base-strong text-ink tabular-nums">{{ label(round.day) }}</time>
                                                <StatusPill :tone="roundTone[round.status]" :label="roundLabel(round)" data-testid="ADM-64.round.status" />
                                                <span class="text-caption text-ink-2 tabular-nums">{{ trans('gift.cotd.votes.total', { count: formatNumber(round.total) }) }}</span>
                                            </span>
                                        </th>
                                    </tr>
                                    <tr v-for="candidate in round.candidates" :key="candidate.position" class="h-40 border-b border-line-subtle" data-testid="ADM-64.candidate">
                                        <td class="whitespace-nowrap px-12 text-right text-ink-2 tabular-nums">{{ candidate.position }}</td>
                                        <td class="px-12 py-4">
                                            <div v-if="candidate.vehicle" class="flex min-w-0 items-center gap-12">
                                                <VehicleThumb :src="candidate.vehicle.cover" :focus="candidate.vehicle.cover_focus" :placeholder="candidate.vehicle.cover_placeholder" />
                                                <component :is="vehicleHref(candidate.vehicle.id) ? Link : 'span'" :href="vehicleHref(candidate.vehicle.id) ?? undefined" :class="[vehicleHref(candidate.vehicle.id) ? `${focusRing} hover:underline` : '', 'inline-flex min-h-32 items-center rounded-xs text-ink']">{{ keepShortHyphens(candidate.vehicle.title) }}</component>
                                                <Badge v-if="candidate.winner" tone="success" data-testid="ADM-64.candidate.winner">{{ trans('gift.cotd.votes.winner') }}</Badge>
                                                <Badge v-if="candidate.vehicle.deleted">{{ trans('gift.cotd.votes.gone') }}</Badge>
                                            </div>
                                            <span v-else class="text-ink-3">{{ trans('gift.cotd.votes.gone') }}</span>
                                        </td>
                                        <td class="whitespace-nowrap px-12">
                                            <component :is="memberHref(candidate.vehicle.owner.id) ? Link : 'span'" v-if="candidate.vehicle?.owner" :href="memberHref(candidate.vehicle.owner.id) ?? undefined" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs text-ink hover:underline']">{{ `@${candidate.vehicle.owner.username ?? '–'}` }}</component>
                                            <span v-else class="text-ink-3">–</span>
                                        </td>
                                        <td class="whitespace-nowrap px-12 text-right text-ink tabular-nums" data-testid="ADM-64.candidate.votes">{{ formatNumber(candidate.votes) }}</td>
                                        <td class="whitespace-nowrap px-12 text-right text-ink tabular-nums" data-testid="ADM-64.candidate.counted">{{ formatNumber(candidate.counted) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </ScrollRegion>
                        <p class="text-caption text-ink-3">{{ trans('gift.cotd.votes.counted_hint') }}</p>
                    </template>
                </section>
                </template>
            </div>
            <!-- The activity under the two lists: beside them the car column would wrap at 1280. -->
            <section class="max-w-720 border-t border-line-subtle pt-16">
                <ActivityTimeline :entries="activity" :state="state === 'loading' ? 'loading' : 'ready'" test-id="ADM-64.activity" />
            </section>
        </div>

        <OverrideDialog v-if="target" v-model:open="overrideOpen" :day="target.day" :day-label="label(target.day)" />
        <ConfirmDialog
            v-model:open="skipOpen"
            :title="trans('gift.cotd.skip.title', { day: target ? label(target.day) : '' })"
            :body="trans('gift.cotd.skip.body')"
            :confirm-label="trans('gift.cotd.skip.confirm')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-64.skip-dialog"
            @confirm="skip"
        />
    </div>
</template>
