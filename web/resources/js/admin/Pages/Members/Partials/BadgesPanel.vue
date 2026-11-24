<script setup lang="ts">
import { PhEyeSlash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { ref } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import { Badge, Button, ConfirmDialog } from '../../../Components/ui';
import EmptyQueue from '../../../Components/ui/EmptyQueue.vue';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDate } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import type { MemberBadges } from '../types';

/**
 * ADM-10 Übersicht, panel "Abzeichen" (SEC-P5G-05): the member's earned badges, newest first. With moderation.decide each row offers
 * "Entziehen" (RevokeBadge: ⚿, audited `badge.revoked`); the dialog says the nightly run awards it again while the rule holds.
 */
const props = defineProps<{ badges: MemberBadges; memberId: string }>();

const tierTone = { bronze: 'neutral', silver: 'info', gold: 'warning' } as const;
const action = useAdminAction();
const target = ref<MemberBadges['earned'][number] | null>(null);
const open = ref(false);
function ask(row: MemberBadges['earned'][number]): void {
    target.value = row;
    action.reset();
    open.value = true;
}
if (qaDialog() === 'revoke-badge' && props.badges.can_revoke && props.badges.earned[0]) ask(props.badges.earned[0]);
function revoke(): void {
    if (target.value === null) return;
    const key = target.value.key;
    action.run('post', routeOr('admin.members.badges.revoke', `/admin/members/${props.memberId}/badges/${key}/revoke`, { member: props.memberId, badge: key }), {}, { sensitive: true, onSuccess: () => (open.value = false) });
}
</script>

<template>
    <section class="flex flex-col gap-8" aria-labelledby="adm10-badges" data-testid="ADM-10.badges">
        <h3 id="adm10-badges" class="text-admin-base-strong text-ink">{{ trans('members.badges.title') }}</h3>
        <EmptyQueue v-if="badges.earned.length === 0" variant="quiet" compact :title="trans('members.badges.empty')" data-testid="ADM-10.badges.empty" />
        <ScrollRegion v-else :label="trans('members.badges.caption')" test-id="ADM-10.badges.table">
            <table class="w-full border-collapse text-admin-base">
                <caption class="sr-only">{{ trans('members.badges.caption') }}</caption>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                        <th scope="col" class="px-12">{{ trans('members.badges.columns.name') }}</th>
                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.badges.columns.tier') }}</th>
                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.badges.columns.awarded') }}</th>
                        <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.badges.columns.source') }}</th>
                        <th v-if="badges.can_revoke" scope="col" class="w-px px-12"><span class="sr-only">{{ trans('members.badges.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in badges.earned" :key="row.key" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-10.badges.row">
                        <td class="px-12">
                            <span class="flex min-w-0 items-center gap-8">
                                <span class="truncate text-ink">{{ row.name }}</span>
                                <PhEyeSlash v-if="row.hidden" :size="16" class="shrink-0 text-ink-3" :aria-label="trans('members.badges.hidden')" />
                                <Badge v-if="!row.active">{{ trans('members.badges.inactive') }}</Badge>
                            </span>
                        </td>
                        <td class="whitespace-nowrap px-12">
                            <Badge v-if="row.tier" :tone="tierTone[row.tier as keyof typeof tierTone] ?? 'neutral'">{{ trans(`members.badges.tiers.${row.tier}`) }}</Badge>
                        </td>
                        <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDate(row.awarded_at) }}</td>
                        <td class="whitespace-nowrap px-12 text-ink-2">{{ row.source ? trans(`members.badges.source.${row.source}`) : '–' }}</td>
                        <td v-if="badges.can_revoke" class="whitespace-nowrap px-12 text-right">
                            <Button size="sm" variant="destructive" :aria-label="trans('members.badges.revoke_label', { name: row.name })" data-testid="ADM-10.badges.revoke" @click="ask(row)">{{ trans('members.badges.revoke') }}</Button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <ConfirmDialog
            v-model:open="open"
            :title="trans('members.badges.revoke_title', { name: target?.name ?? '' })"
            :body="trans('members.badges.revoke_body')"
            :confirm-label="trans('members.badges.revoke')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-10.badges.revoke-dialog"
            @confirm="revoke"
        />
    </section>
</template>
