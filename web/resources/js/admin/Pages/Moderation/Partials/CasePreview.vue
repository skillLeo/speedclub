<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhImageBroken, PhUserCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Badge, StatusPill } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatDateTime } from '../../../lib/format';
import { usePermissions } from '../../../lib/permissions';
import { hasRoute, routeOr } from '../../../lib/routes';
import { visibilityPill } from '../../../lib/vehicleStatus';
import type { CasePreviewData } from '../shared';

/**
 * The target of a case as members see it now (ADM-21 overview, ADM-20 SplitQueue pane). A message case shows no content: its evidence
 * is ADM-22's, behind moderation.messages.
 */
const props = defineProps<{ preview: CasePreviewData | null; messageCase: boolean; caseId: string; testId: string }>();
const { can } = usePermissions();
const messagesHref = computed(() => routeOr('admin.moderation.messages', '/admin/moderation/messages', {}) + `?case=${props.caseId}`);
</script>

<template>
    <div class="contents">
            <div v-if="messageCase" class="flex flex-col items-start gap-8 rounded-sm border border-dashed border-line px-16 py-16" :data-testid="`${testId}.preview.message`">
                <p class="text-admin-base text-ink-2">{{ trans('moderation.case.preview.message') }}</p>
                <Link v-if="can('moderation.messages')" :href="messagesHref" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']">
                    {{ trans('moderation.case.preview.message_link') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                </Link>
            </div>
            <p v-else-if="preview === null" class="text-admin-base text-ink-3" :data-testid="`${testId}.preview.gone`">{{ trans('moderation.case.preview.gone') }}</p>
            <div v-else-if="preview.kind === 'member'" class="flex items-start gap-16" :data-testid="`${testId}.preview`">
                <img v-if="preview.avatar" :src="String(preview.avatar)" alt="" class="size-48 shrink-0 rounded-full object-cover" />
                <PhUserCircle v-else :size="24" class="mt-4 shrink-0 text-ink-3" aria-hidden="true" />
                <div class="flex min-w-0 flex-col gap-4">
                    <p class="text-admin-base-strong text-ink">{{ preview.display_name ?? `@${preview.username}` }}</p>
                    <p class="sc-key text-admin-base text-ink-2">{{ `@${preview.username}` }}</p>
                    <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.bio ?? trans('moderation.case.preview.no_bio') }}</p>
                </div>
            </div>
            <div v-else-if="preview.kind === 'vehicle'" class="flex flex-col gap-12 desktop:flex-row" :data-testid="`${testId}.preview`">
                <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-4/3 w-240 shrink-0 rounded-sm object-cover" />
                <div class="flex min-w-0 flex-col gap-4">
                    <p class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                    <p v-if="preview.nickname" class="text-admin-base text-ink-2">{{ `„${preview.nickname}“` }}</p>
                    <div class="flex flex-wrap gap-8">
                        <StatusPill v-bind="visibilityPill({ status: String(preview.status), visibility: String(preview.visibility), deleted: preview.deleted === true })" />
                    </div>
                    <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.description ?? trans('moderation.case.preview.no_description') }}</p>
                </div>
            </div>
            <div v-else-if="preview.kind === 'photo'" class="flex flex-col gap-8" :data-testid="`${testId}.preview`">
                <img v-if="preview.url" :src="String(preview.url)" :alt="String(preview.alt ?? '')" class="aspect-4/3 w-320 rounded-sm object-cover" />
                <div v-else class="flex aspect-4/3 w-320 items-center justify-center rounded-sm border border-dashed border-line"><PhImageBroken :size="24" class="text-ink-3" aria-hidden="true" /></div>
                <p v-if="!preview.url" class="text-admin-base text-ink-2">{{ trans('moderation.case.preview.removed_photo') }}</p>
                <p v-else-if="preview.alt" class="text-admin-base text-ink-2">{{ preview.alt }}</p>
            </div>
            <!-- M4.11: a comment under a build update, as written; its author is the case's subject. -->
            <div v-else-if="preview.kind === 'comment'" class="flex flex-col gap-8" :data-testid="`${testId}.preview`">
                <p class="flex flex-wrap items-center gap-8 text-caption text-ink-3 tabular-nums">
                    <span>{{ preview.reply ? trans('moderation.case.preview.comment_reply') : trans('moderation.case.preview.comment_on') }}</span>
                    <time v-if="preview.created_at" :datetime="String(preview.created_at)">{{ formatDateTime(String(preview.created_at)) }}</time>
                    <Badge v-if="preview.deleted" tone="neutral">{{ trans('moderation.case.preview.comment_deleted') }}</Badge>
                </p>
                <blockquote class="max-w-720 whitespace-pre-line border-l-2 border-line-strong pl-12 text-admin-base text-ink" :data-testid="`${testId}.preview.comment`">{{ preview.body ?? '–' }}</blockquote>
                <p v-if="preview.status === 'removed'" class="text-admin-base text-ink-3">{{ trans('moderation.case.preview.comment_removed') }}</p>
                <Link v-if="preview.vehicle_id && hasRoute('admin.vehicles.show')" :href="routeOr('admin.vehicles.show', `/admin/vehicles/${String(preview.vehicle_id)}`, { vehicle: String(preview.vehicle_id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                    {{ trans('moderation.case.preview.open_vehicle') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                </Link>
            </div>
            <!-- M4.12: an event, linked to its ADM-54 record. -->
            <div v-else-if="preview.kind === 'event'" class="flex flex-col gap-12 desktop:flex-row" :data-testid="`${testId}.preview`">
                <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-video w-240 shrink-0 rounded-sm object-cover" />
                <div class="flex min-w-0 flex-col gap-4">
                    <p class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                    <p class="text-admin-base text-ink-2 tabular-nums">{{ [trans(`events.types.${String(preview.type)}`), preview.starts_at ? formatDateTime(String(preview.starts_at)) : null, preview.city].filter(Boolean).join(' · ') }}</p>
                    <div class="flex flex-wrap gap-8">
                        <StatusPill :tone="preview.removed ? 'danger' : 'neutral'" :label="preview.removed ? trans('moderation.case.preview.event_removed') : trans(`events.status.${String(preview.status)}`)" />
                    </div>
                    <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.description ?? trans('moderation.case.preview.no_description') }}</p>
                    <Link v-if="hasRoute('admin.events.show')" :href="routeOr('admin.events.show', `/admin/events/${String(preview.id)}`, { event: String(preview.id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                        {{ trans('moderation.case.preview.open_event') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                    </Link>
                </div>
            </div>
            <!-- M4.14/M4.17: a business profile, linked to its ADM-56 record. -->
            <div v-else-if="preview.kind === 'business'" class="flex flex-col gap-12 desktop:flex-row" :data-testid="`${testId}.preview`">
                <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-video w-240 shrink-0 rounded-sm object-cover" />
                <div class="flex min-w-0 flex-col gap-4">
                    <p class="text-admin-base-strong text-ink">{{ preview.name }}</p>
                    <p class="text-admin-base text-ink-2">{{ [preview.legal_name, preview.city].filter(Boolean).join(' · ') }}</p>
                    <div class="flex flex-wrap gap-8">
                        <StatusPill :tone="preview.removed ? 'danger' : 'neutral'" :label="preview.removed ? trans('moderation.case.preview.event_removed') : trans(`businesses.status.${String(preview.status)}`)" />
                    </div>
                    <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.about ?? trans('moderation.case.preview.no_description') }}</p>
                    <Link v-if="hasRoute('admin.businesses.show')" :href="routeOr('admin.businesses.show', `/admin/businesses/${String(preview.id)}`, { business: String(preview.id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                        {{ trans('moderation.case.preview.open_business') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                    </Link>
                </div>
            </div>
            <div v-else class="flex flex-col gap-4" :data-testid="`${testId}.preview`">
                <p v-if="preview.title" class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                <p v-if="preview.hidden" class="text-admin-base text-ink-3">{{ trans('moderation.case.preview.hidden') }}</p>
                <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.note ?? preview.part_name ?? '–' }}</p>
            </div>
    </div>
</template>
