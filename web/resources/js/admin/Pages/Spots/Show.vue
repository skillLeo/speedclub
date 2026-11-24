<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhLockSimple, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Badge, Button, EmptyQueue, Skeleton, type TabItem, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatNumber, formatTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { memberHref } from '../Moderation/shared';
import RemoveSpotDialog from './Partials/RemoveSpotDialog.vue';
import { activeSignals, dexLabel, errorText, indexUrl, removeUrl, signalDetail, spotHref, vehicleHref, type SpotSignals } from './shared';

/**
 * ADM-62 Spot record (09 §10.2 record page): the spot (time, city, counted, night, First Spotter, source; never a place), spotter and
 * car with owner, its signals with their detail, the spotter's spots an hour either side (Spotter-Verlauf) and the spotter's removed
 * spots (Entfernungen); the activity column from the audit log. "Spot entfernen" (⚿) for moderation.decide while the spot is
 * active; otherwise read-only.
 */
type Line = { id: string; spotted_at: string | null; vehicle: { id: string; title: string; dex_number: number | null }; city: string | null; night: boolean; removed_at: string | null };
interface SpotDetail {
    id: string;
    spotted_at: string | null;
    removed_at: string | null;
    removal: { by: string | null; at: string | null; reason: string | null } | null;
    counted: boolean;
    night: boolean;
    first_three: boolean;
    source: string;
    city: string | null;
    bundesland: string | null;
    spotter: { id: string; username: string | null; display_name: string | null; joined_at: string | null; spots: number; removed: number };
    vehicle: { id: string; title: string; dex_number: number | null; cover: string | null; cover_focus: string | null; cover_placeholder: string | null; owner: { id: string; username: string | null } | null };
    signals: SpotSignals;
    context: (Line & { current: boolean; signals: SpotSignals | null })[];
    removals: (Line & { by: string | null; reason: string | null })[];
    can: { remove: boolean };
}
type Activity = { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null };
const props = defineProps<{ spot: SpotDetail; activity?: Activity[] }>();

const { can } = usePermissions();
const state = usePageState();
const s = computed(() => props.spot);
const mayRemove = computed(() => s.value.can.remove && can('moderation.decide'));

const tab = ref(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') ?? 'overview');
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('spots.record.tabs.overview') },
    { value: 'context', label: trans('spots.record.tabs.context'), count: s.value.context.length },
    { value: 'removals', label: trans('spots.record.tabs.removals'), count: s.value.removals.length },
]);
const title = computed(() => trans('spots.record.title', { date: formatDateTime(s.value.spotted_at) }));
const crumbs = computed(() => [{ label: trans('shell.groups.moderation') }, { label: trans('spots.record.crumb'), href: indexUrl() }]);
const status = computed<{ tone: Tone; label: string }>(() => (s.value.removed_at ? { tone: 'neutral', label: trans('spots.status.removed') } : { tone: 'success', label: trans('spots.status.active') }));
const activity = computed<TimelineEntry[]>(() => (props.activity ?? []).map((a) => ({ id: a.id, occurred_at: a.occurred_at, label: actionLabel(a.action), actor: actorName(a), reason: a.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=spot&filter[target_id]=${s.value.id}` : undefined));
const signals = computed(() => activeSignals(s.value.signals));
const yesNo = (value: boolean): string => trans(value ? 'spots.yes' : 'spots.no');

// ---- remove -------------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const removeOpen = ref(qaDialog() === 'remove' && mayRemove.value);
function confirmRemove(): void {
    action.run('post', removeUrl(s.value.id), {}, { sensitive: true, onSuccess: () => (removeOpen.value = false) });
}
</script>

<template>
    <Head :title="title" />
    <div data-testid="ADM-62R-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('spots.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-62R.error" @retry="router.reload()" />
        <RecordLayout
            v-else
            v-model:tab="tab"
            :title="title"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('spots.record.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            :loading-actions="1"
            loading-meta="line"
            test-id="ADM-62R"
        >
            <template #loading>
                <div class="flex flex-col gap-16 desktop:flex-row" aria-hidden="true">
                    <Skeleton class="aspect-video w-full desktop:w-320" />
                    <div class="flex grow flex-col gap-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-62R.meta">
                    <span class="sc-key">{{ `@${s.spotter.username ?? '–'}` }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ s.vehicle.title }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ s.city ?? trans('spots.no_city') }}</span>
                </p>
            </template>
            <template #actions>
                <Button v-if="mayRemove" variant="destructive" size="sm" :icon="PhTrash" :disabled="action.processing.value" data-testid="ADM-62R.remove" @click="removeOpen = true">{{ trans('spots.actions.remove') }}</Button>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24" data-testid="ADM-62R.detail">
                    <p v-if="!can('moderation.decide')" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-62R.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('spots.view_only') }}</p>

                    <div v-if="s.removed_at" class="flex flex-col gap-2 border-b border-line-subtle pb-20" data-testid="ADM-62R.removal">
                        <span class="text-caption text-ink-3">{{ trans('spots.record.facts.removal') }}</span>
                        <span class="text-admin-base text-ink tabular-nums">
                            {{ s.removal?.by ? trans('spots.record.removed_by', { date: formatDateTime(s.removed_at), name: s.removal.by }) : trans('spots.record.removed_by_unknown', { date: formatDateTime(s.removed_at) }) }}
                        </span>
                        <span v-if="s.removal?.reason" class="max-w-720 whitespace-pre-line text-admin-base text-ink-2">{{ s.removal.reason }}</span>
                    </div>

                    <div class="flex flex-col gap-16 desktop:flex-row">
                        <span class="relative block aspect-video w-full shrink-0 overflow-hidden rounded-sm bg-raised bg-cover bg-center desktop:w-320" :style="s.vehicle.cover_placeholder ? { backgroundImage: `url(&quot;${s.vehicle.cover_placeholder}&quot;)` } : undefined">
                            <img v-if="s.vehicle.cover" :src="s.vehicle.cover" alt="" class="block size-full object-cover" :style="s.vehicle.cover_focus ? { objectPosition: s.vehicle.cover_focus } : undefined" />
                        </span>
                        <dl class="grid min-w-0 grow grid-cols-1 content-start gap-x-24 gap-y-12 tablet:grid-cols-2">
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.car') }}</dt>
                                <dd class="flex flex-col gap-2 text-admin-base text-ink">
                                    <Link v-if="hasRoute('admin.vehicles.show')" :href="vehicleHref(s.vehicle.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs hover:underline']" data-testid="ADM-62R.car">{{ s.vehicle.title }}<PhArrowSquareOut :size="16" aria-hidden="true" /></Link>
                                    <span v-else>{{ s.vehicle.title }}</span>
                                    <span class="text-caption text-ink-3 tabular-nums">{{ dexLabel(s.vehicle.dex_number) }}</span>
                                </dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.owner') }}</dt>
                                <dd class="text-admin-base text-ink">
                                    <Link v-if="s.vehicle.owner && hasRoute('admin.members.show')" :href="memberHref(s.vehicle.owner.id)" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs hover:underline']">{{ `@${s.vehicle.owner.username ?? '–'}` }}</Link>
                                    <span v-else class="text-ink-3">–</span>
                                </dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.spotter') }}</dt>
                                <dd class="flex flex-col gap-2 text-admin-base text-ink">
                                    <Link v-if="hasRoute('admin.members.show')" :href="memberHref(s.spotter.id)" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center self-start rounded-xs hover:underline']" data-testid="ADM-62R.spotter">{{ `@${s.spotter.username ?? '–'}` }}</Link>
                                    <span v-else class="sc-key">{{ `@${s.spotter.username ?? '–'}` }}</span>
                                    <span class="text-caption text-ink-3 tabular-nums">
                                        {{ [trans('spots.record.spots_count', { count: formatNumber(s.spotter.spots) }), trans('spots.record.removed_count', { count: formatNumber(s.spotter.removed) }), s.spotter.joined_at ? `${trans('spots.record.facts.joined')} ${formatDate(s.spotter.joined_at)}` : null].filter(Boolean).join(' · ') }}
                                    </span>
                                </dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.spotted_at') }}</dt>
                                <dd class="text-admin-base text-ink tabular-nums"><time :datetime="s.spotted_at ?? undefined">{{ formatDateTime(s.spotted_at) }}</time></dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.city') }}</dt>
                                <dd class="text-admin-base text-ink" data-testid="ADM-62R.city">{{ [s.city ?? trans('spots.no_city'), s.bundesland].filter(Boolean).join(' · ') }}</dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.counted') }}</dt>
                                <dd class="text-admin-base" :class="s.counted ? 'text-ink' : 'text-warning'">{{ s.counted ? trans('spots.yes') : trans('spots.not_counted') }}</dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.night') }}</dt>
                                <dd class="text-admin-base text-ink">{{ yesNo(s.night) }}</dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.first_three') }}</dt>
                                <dd class="text-admin-base text-ink">{{ yesNo(s.first_three) }}</dd>
                            </div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.source') }}</dt>
                                <dd class="text-admin-base text-ink">{{ trans(`spots.source.${s.source}`) }}</dd>
                            </div>
                            <div class="flex flex-col gap-2 tablet:col-span-2">
                                <dt class="text-caption text-ink-3">{{ trans('spots.record.facts.signals') }}</dt>
                                <dd class="flex flex-col gap-4 text-admin-base text-ink" data-testid="ADM-62R.signals">
                                    <span v-for="key in signals" :key="key" class="flex flex-wrap items-center gap-8" :data-testid="`ADM-62R.signal.${key}`">
                                        <Badge tone="warning">{{ trans(`spots.signal.${key}`) }}</Badge><span class="tabular-nums">{{ signalDetail(key, s.signals, null) }}</span>
                                    </span>
                                    <span v-if="signals.length === 0" class="text-ink-3">{{ trans('spots.signal.none') }}</span>
                                </dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </template>

            <template #context>
                <div class="flex flex-col gap-12" data-testid="ADM-62R.context">
                    <p class="text-admin-base text-ink-2">{{ trans('spots.record.context_intro') }}</p>
                    <EmptyQueue v-if="s.context.length <= 1" compact variant="quiet" :title="trans('spots.record.context_empty')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="line in s.context" :key="line.id" class="flex min-h-40 flex-wrap items-center gap-x-16 gap-y-4 border-t border-line-subtle py-4 first:border-t-0" :aria-current="line.current ? 'true' : undefined">
                            <time :datetime="line.spotted_at ?? undefined" class="w-48 text-ink-2 tabular-nums">{{ formatTime(line.spotted_at) }}</time>
                            <Link v-if="!line.current" :href="spotHref(line.id)" :class="[focusRing, 'min-w-0 grow rounded-xs text-admin-base text-ink hover:underline']">{{ line.vehicle.title }}</Link>
                            <span v-else class="min-w-0 grow text-admin-base-strong text-ink">{{ line.vehicle.title }} · {{ trans('spots.record.this_spot') }}</span>
                            <span class="w-160 truncate text-ink-2">{{ line.city ?? trans('spots.no_city') }}</span>
                            <span class="flex gap-4">
                                <Badge v-for="key in activeSignals(line.signals)" :key="key" tone="warning">{{ trans(`spots.signal.${key}`) }}</Badge>
                                <Badge v-if="line.removed_at">{{ trans('spots.removed_badge') }}</Badge>
                            </span>
                        </li>
                    </ul>
                </div>
            </template>

            <template #removals>
                <div class="flex flex-col gap-12" data-testid="ADM-62R.removals">
                    <p class="text-admin-base text-ink-2">{{ trans('spots.record.removals_intro') }}</p>
                    <EmptyQueue v-if="s.removals.length === 0" compact variant="quiet" :title="trans('spots.record.removals_empty')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="line in s.removals" :key="line.id" class="flex flex-col gap-2 border-t border-line-subtle py-8 first:border-t-0">
                            <span class="flex flex-wrap items-center gap-x-16 gap-y-4">
                                <Link :href="spotHref(line.id)" :class="[focusRing, 'rounded-xs text-admin-base text-ink tabular-nums hover:underline']">{{ formatDateTime(line.spotted_at) }}</Link>
                                <span class="text-admin-base text-ink">{{ line.vehicle.title }}</span>
                                <span class="text-ink-2">{{ line.city ?? trans('spots.no_city') }}</span>
                            </span>
                            <span class="text-caption text-ink-3 tabular-nums">
                                {{ line.by ? trans('spots.record.removed_by', { date: formatDateTime(line.removed_at), name: line.by }) : trans('spots.record.removed_by_unknown', { date: formatDateTime(line.removed_at) }) }}
                            </span>
                            <span v-if="line.reason" class="max-w-720 whitespace-pre-line text-caption text-ink-2">{{ line.reason }}</span>
                        </li>
                    </ul>
                </div>
            </template>
        </RecordLayout>

        <RemoveSpotDialog v-model:open="removeOpen" :processing="action.processing.value" :error="errorText(action.error.value ?? undefined)" test-id="ADM-62R.remove-dialog" @confirm="confirmRemove" />
    </div>
</template>
