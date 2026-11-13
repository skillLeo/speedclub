<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { actionLabel, actorName } from '../../../lib/audit';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import { formatDateTime } from '../../../lib/format';
import type { FeedEntry } from '../types';

/** ADM-10 "Audit": events with the member as target or actor (and the decisions about them), newest first; the full log is ADM-44. */
defineProps<{ events: FeedEntry[]; more: boolean; logHref: string | null }>();
</script>

<template>
    <div class="flex flex-col gap-12" data-testid="ADM-10.audit">
        <p v-if="events.length === 0" class="text-admin-base text-ink-2">{{ trans('members.audit.empty') }}</p>
        <ScrollRegion v-else :label="trans('members.audit.caption')">
            <table class="w-full border-collapse text-admin-base">
                <caption class="sr-only">{{ trans('members.audit.caption') }}</caption>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('audit.columns.occurred_at') }}</th>
                        <th scope="col" class="px-12">{{ trans('audit.columns.action') }}</th>
                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('audit.columns.actor') }}</th>
                        <th scope="col" class="px-12">{{ trans('audit.columns.reason') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="event in events" :key="event.id" class="h-40 border-b border-line-subtle last:border-b-0">
                        <td class="whitespace-nowrap px-12 text-ink tabular-nums">{{ formatDateTime(event.occurred_at) }}</td>
                        <td class="whitespace-nowrap px-12 text-ink" :title="event.action">{{ actionLabel(event.action) }}</td>
                        <td class="sc-key whitespace-nowrap px-12 text-ink-2">{{ actorName(event) ?? trans('audit.actor.system') }}</td>
                        <!-- Free text: one line with an ellipsis, the full reason as title (DQ-535). -->
                        <td class="px-12"><span class="block max-w-320 truncate text-ink-2" :title="event.reason ?? undefined">{{ event.reason ?? '–' }}</span></td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>
        <a v-if="logHref" :href="logHref" class="inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {{ more ? trans('members.audit.more') : trans('members.audit.open_log') }}
        </a>
    </div>
</template>
