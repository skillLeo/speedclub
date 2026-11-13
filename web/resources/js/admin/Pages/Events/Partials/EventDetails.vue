<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { PhImageBroken, PhLockSimple, PhMapPin, PhPencilSimpleLine } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Badge } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatDate, formatDateTime, formatNumber, formatTime } from '../../../lib/format';
import { hasRoute } from '../../../lib/routes';
import { memberHref } from '../../Moderation/shared';
import { changedFields, type EventDetail } from '../shared';

/**
 * What staff review of an event (ADM-53 pane, ADM-54 overview): the change since the last approval, cover, time, the place (exact for
 * staff; the note says who else sees it), the organiser with their history, description, the organiser's rules and the confirmed
 * community rules, capacity and answers. Text only as the organiser wrote it.
 */
const props = withDefaults(defineProps<{ event: EventDetail; compact?: boolean; testId: string }>(), { compact: false });

const e = computed(() => props.event);
const placeLines = computed(() => {
    const p = e.value.place;
    return [p.venue_name, p.street, [p.postcode, p.city].filter(Boolean).join(' ')].filter((line): line is string => typeof line === 'string' && line.trim() !== '');
});
const timeText = computed(() => {
    if (e.value.starts_at === null) return '–';
    const start = formatDateTime(e.value.starts_at);
    if (e.value.ends_at === null) return start;
    const sameDay = formatDate(e.value.starts_at) === formatDate(e.value.ends_at);
    return `${start} – ${sameDay ? formatTime(e.value.ends_at) : formatDateTime(e.value.ends_at)}`;
});
const coordinates = computed(() => (e.value.place.lat !== null && e.value.place.lng !== null ? `${e.value.place.lat.toFixed(4)}, ${e.value.place.lng.toFixed(4)}` : null));
const memberLink = computed(() => (hasRoute('admin.members.show') ? memberHref(e.value.organiser.id) : null));
</script>

<template>
    <div class="flex flex-col gap-20" :data-testid="testId">
        <p v-if="e.changed_since_review.length > 0" class="flex items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" :data-testid="`${testId}.changed`">
            <PhPencilSimpleLine :size="16" class="mt-2 shrink-0 text-warning" aria-hidden="true" />
            <span><span class="text-admin-base-strong">{{ trans('events.detail.changed') }}:</span> {{ changedFields(e) }}</span>
        </p>

        <div class="flex flex-col gap-16" :class="compact ? '' : 'desktop:flex-row'">
            <img v-if="e.cover" :src="e.cover" :alt="trans('events.detail.cover', { title: e.title })" class="aspect-video shrink-0 rounded-sm object-cover" :class="compact ? 'w-full max-w-480' : 'w-full desktop:w-320'" :data-testid="`${testId}.cover`" />

            <dl class="grid min-w-0 grow grid-cols-1 content-start gap-x-24 gap-y-12 tablet:grid-cols-2">
                <!-- No cover: one line, not an empty 16:9 frame (no grey placeholder blocks). -->
                <div v-if="!e.cover" class="flex items-center gap-8 text-caption text-ink-3 tablet:col-span-2" :data-testid="`${testId}.no-cover`">
                    <dt class="sr-only">{{ trans('events.detail.cover', { title: e.title }) }}</dt>
                    <dd class="flex items-center gap-8"><PhImageBroken :size="16" aria-hidden="true" />{{ trans('events.detail.no_cover') }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.time') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ timeText }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.organiser') }}</dt>
                    <dd class="flex flex-wrap items-center gap-x-8 text-admin-base text-ink">
                        <Link v-if="memberLink" :href="memberLink" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs hover:underline']" :data-testid="`${testId}.organiser`">{{ `@${e.organiser.username ?? '–'}` }}</Link>
                        <span v-else class="sc-key">{{ `@${e.organiser.username ?? '–'}` }}</span>
                        <span class="text-caption text-ink-3 tabular-nums">
                            {{ [e.organiser.approved_events === 0 ? trans('events.organiser.first') : trans('events.organiser.approved', { count: formatNumber(e.organiser.approved_events) }), e.organiser.joined_at ? trans('events.organiser.since', { date: formatDate(e.organiser.joined_at) }) : null].filter(Boolean).join(' · ') }}
                        </span>
                    </dd>
                </div>
                <div class="flex flex-col gap-2 tablet:col-span-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.place') }}</dt>
                    <dd class="flex flex-col gap-4 text-admin-base text-ink" :data-testid="`${testId}.place`">
                        <span v-if="placeLines.length > 0" class="flex items-start gap-8">
                            <PhMapPin :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />
                            <span class="flex flex-col">
                                <span v-for="line in placeLines" :key="line">{{ line }}</span>
                                <span v-if="coordinates" class="text-caption text-ink-3 tabular-nums">{{ coordinates }}</span>
                            </span>
                        </span>
                        <span v-else class="text-ink-3">{{ trans('events.detail.no_place') }}</span>
                        <span class="flex items-start gap-8 text-caption text-ink-2">
                            <PhLockSimple v-if="e.location_visibility === 'after_rsvp'" :size="16" class="shrink-0" aria-hidden="true" />
                            {{ e.location_visibility === 'after_rsvp' ? trans('events.detail.place_private') : trans('events.detail.place_public') }}
                        </span>
                    </dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.visibility') }}</dt>
                    <dd class="text-admin-base text-ink">{{ trans(`events.visibility.${e.visibility}`) }}</dd>
                </div>
                <div class="flex flex-col gap-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.capacity') }}</dt>
                    <dd class="text-admin-base text-ink tabular-nums">{{ e.capacity === null ? trans('events.detail.unlimited') : formatNumber(e.capacity) }}</dd>
                </div>
                <div class="flex flex-col gap-2 tablet:col-span-2">
                    <dt class="text-caption text-ink-3">{{ trans('events.detail.answers') }}</dt>
                    <dd class="flex flex-wrap gap-x-16 text-admin-base text-ink tabular-nums" :data-testid="`${testId}.counts`">
                        <span>{{ trans('events.detail.going') }} {{ formatNumber(e.counts.going) }}</span>
                        <span>{{ trans('events.detail.interested') }} {{ formatNumber(e.counts.interested) }}</span>
                        <span>{{ trans('events.detail.waitlist') }} {{ formatNumber(e.counts.waitlist) }}</span>
                    </dd>
                </div>
            </dl>
        </div>

        <section class="flex flex-col gap-4">
            <h3 class="text-admin-base-strong text-ink">{{ trans('events.detail.description') }}</h3>
            <p class="max-w-720 whitespace-pre-line text-admin-base" :class="e.description ? 'text-ink' : 'text-ink-3'" :data-testid="`${testId}.description`">{{ e.description || trans('events.detail.no_description') }}</p>
        </section>
        <section v-if="e.organiser_rules" class="flex flex-col gap-4">
            <h3 class="text-admin-base-strong text-ink">{{ trans('events.detail.organiser_rules') }}</h3>
            <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ e.organiser_rules }}</p>
        </section>
        <section v-if="e.rules.length > 0" class="flex flex-col gap-8">
            <h3 class="text-admin-base-strong text-ink">{{ trans('events.detail.rules') }}</h3>
            <ul class="flex flex-wrap gap-8">
                <li v-for="rule in e.rules" :key="rule"><Badge tone="neutral">{{ trans(`events.rules.${rule}`) }}</Badge></li>
            </ul>
        </section>
    </div>
</template>
