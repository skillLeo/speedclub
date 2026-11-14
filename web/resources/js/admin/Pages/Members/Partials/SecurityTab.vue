<script setup lang="ts">
import { PhSignOut } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Badge from '../../../Components/ui/Badge.vue';
import Button from '../../../Components/ui/Button.vue';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import { actionLabel } from '../../../lib/audit';
import { formatDate, formatDateTime, formatNumber, formatRelative, formatTime } from '../../../lib/format';
import type { MemberSecurity } from '../types';

/**
 * ADM-10 "Sicherheit & Sitzungen" (with ADM-59, 09 §10.3): two-factor state, signed-in devices and browser sessions (dates, device
 * names, platform; never an IP), passkeys, linked sign-in providers, sign-ins by device and the security events. Read-only apart from
 * "Alle Sitzungen beenden", the record's action, offered here too beside what it ends (emits `revoke`; the record opens its dialog). Staff never see a secret, a provider's e-mail or an IP.
 */
const props = withDefaults(defineProps<{ security: MemberSecurity; canRevoke?: boolean }>(), { canRevoke: false });
const emit = defineEmits<{ revoke: [] }>();

// DQ-1197: one definition of "signed in": the app tokens and the browser sessions still alive, the two things "Alle Sitzungen beenden"
// ends. The sign-ins by device below are history (known_devices), so their heading says so.
const sessions = computed(() => props.security.browser_sessions ?? []);
const activeCount = computed(() => props.security.devices.length + sessions.value.length);
const browserLabel = (row: { browser: string | null; os: string | null }): string =>
    [row.browser, row.os].filter((part): part is string => typeof part === 'string' && part !== '').join(' · ') || trans('members.security.browser');

type SecurityEvent = NonNullable<MemberSecurity['events']>[number];
interface EventGroup {
    key: string;
    event: SecurityEvent;
    count: number;
    /** Oldest moment of the group (the list is newest first). */
    first: string;
}
/** DQ-1197: repeated events in a row (same kind, device and city, same day) read as one line with a count, not 30 identical rows. */
const eventGroups = computed<EventGroup[]>(() => {
    const groups: EventGroup[] = [];
    for (const event of props.security.events ?? []) {
        const last = groups[groups.length - 1];
        const same =
            last !== undefined &&
            last.event.type === event.type &&
            last.event.device_name === event.device_name &&
            last.event.approx_city === event.approx_city &&
            formatDate(last.event.created_at) === formatDate(event.created_at);
        if (same) {
            last.count += 1;
            last.first = event.created_at;
        } else groups.push({ key: event.id, event, count: 1, first: event.created_at });
    }
    return groups;
});
function eventWhen(group: EventGroup): string {
    if (group.count === 1) return formatDateTime(group.event.created_at);
    return trans('members.security.events_repeat', { date: formatDate(group.event.created_at), from: formatTime(group.first), to: formatTime(group.event.created_at) });
}

type SignIn = MemberSecurity['sign_ins'][number];
/** "Pixel 8 · Android", "Chrome · macOS", "Browser"; "Gerät 2" only when nothing is known (DQ-541). */
function deviceLabel(item: SignIn, index: number): string {
    const platform = item.platform ? trans(`members.security.platform_${item.platform}`) : null;
    const parts = item.kind === 'app' ? [item.name, platform ?? item.os] : [item.browser, item.os];
    const known = parts.filter((part): part is string => typeof part === 'string' && part !== '');
    if (known.length > 0) return known.join(' · ');
    if (item.kind === 'browser') return trans('members.security.browser');
    return trans('members.security.device_n', { n: String(index + 1) });
}
</script>

<template>
    <div class="flex flex-col gap-32" data-testid="ADM-10.security">
        <section class="flex flex-col gap-12" :aria-label="trans('members.security.two_factor')">
            <h2 class="text-headline text-ink">{{ trans('members.security.two_factor') }}</h2>
            <div class="flex flex-wrap items-center gap-12">
                <StatusPill :tone="security.two_factor.on ? 'success' : 'neutral'" :label="trans(security.two_factor.on ? 'members.security.two_factor_on' : 'members.security.two_factor_off')" />
                <span v-if="security.two_factor.confirmed_at" class="text-admin-base text-ink-2 tabular-nums">{{ trans('members.security.confirmed_at', { date: formatDateTime(security.two_factor.confirmed_at) }) }}</span>
                <StatusPill v-if="security.two_factor.locked_at" tone="warning" :label="trans('members.security.locked', { date: formatDateTime(security.two_factor.locked_at) })" />
                <StatusPill v-if="security.force_password_change" tone="warning" :label="trans('members.security.force_password_change')" />
            </div>
        </section>

        <section class="flex flex-col gap-12" :aria-labelledby="'ADM-10-security-active'" data-testid="ADM-10.security.active">
            <div class="flex flex-wrap items-center justify-between gap-12">
                <div class="flex items-baseline gap-8">
                    <h2 id="ADM-10-security-active" class="text-headline text-ink">{{ trans('members.security.devices') }}</h2>
                    <span v-if="activeCount > 0" class="text-admin-base text-ink-2 tabular-nums" data-testid="ADM-10.security.active-count">{{ trans('members.security.active_count', { count: formatNumber(activeCount) }) }}</span>
                </div>
                <Button v-if="canRevoke && activeCount > 0" size="sm" variant="secondary" :icon="PhSignOut" data-testid="ADM-10.security.revoke" @click="emit('revoke')">{{ trans('members.actions.revoke_sessions') }}</Button>
            </div>
            <p v-if="activeCount === 0" class="text-admin-base text-ink-2">{{ trans('members.security.no_devices') }}</p>
            <ScrollRegion v-else :label="trans('members.security.devices')">
                <table class="w-full border-collapse text-admin-base">
                    <caption class="sr-only">{{ trans('members.security.devices') }}</caption>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                            <th scope="col" class="px-12">{{ trans('members.security.device') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.security.platform') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.security.created') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.security.last_used') }}</th>
                            <th scope="col" class="px-12">{{ trans('members.security.expires') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="device in security.devices" :key="device.id" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-10.security.device">
                            <td class="max-w-320 px-12">
                                <span class="flex min-w-0 items-center gap-8">
                                    <span class="truncate text-ink" :title="device.device_name ?? undefined">{{ device.device_name ?? trans('members.security.unknown_device') }}</span>
                                    <Badge v-if="device.view_as" tone="accent">{{ trans('members.security.view_as') }}</Badge>
                                </span>
                            </td>
                            <td class="px-12 text-ink-2">{{ device.platform ? trans(`members.security.platform_${device.platform}`) : '–' }}<template v-if="device.app_version"> · {{ device.app_version }}</template></td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(device.created_at) }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums" :title="formatDateTime(device.last_used_at)">{{ device.last_used_at ? formatRelative(device.last_used_at) : '–' }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ device.expires_at ? formatDateTime(device.expires_at) : trans('members.security.no_expiry') }}</td>
                        </tr>
                        <tr v-for="(row, index) in sessions" :key="`session-${index}`" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-10.security.session">
                            <td class="max-w-320 px-12"><span class="block truncate text-ink">{{ browserLabel(row) }}</span></td>
                            <td class="px-12 text-ink-2">{{ trans('members.security.browser_session') }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-3">–</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums" :title="formatDateTime(row.last_active_at)">{{ formatRelative(row.last_active_at) }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(row.expires_at) }}</td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <div class="grid grid-cols-1 gap-32 desktop:grid-cols-2">
            <section class="flex flex-col gap-12" :aria-label="trans('members.security.passkeys')" data-testid="ADM-10.security.passkeys">
                <h2 class="text-headline text-ink">{{ trans('members.security.passkeys') }}</h2>
                <p v-if="(security.passkeys ?? []).length === 0" class="text-admin-base text-ink-2">{{ trans('members.security.no_passkeys') }}</p>
                <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="key in security.passkeys" :key="key.id" class="flex min-h-40 flex-wrap items-center justify-between gap-x-12 border-b border-line-subtle px-12 py-4 text-admin-base last:border-b-0">
                        <span class="flex min-w-0 items-center gap-8">
                            <span class="truncate text-ink">{{ key.name }}</span>
                            <Badge v-if="key.synced" tone="neutral">{{ trans('members.security.passkey_synced') }}</Badge>
                        </span>
                        <span class="text-ink-2 tabular-nums">{{ trans('members.security.passkey_dates', { created: formatDateTime(key.created_at), used: key.last_used_at ? formatRelative(key.last_used_at) : trans('members.security.never') }) }}</span>
                    </li>
                </ul>
            </section>
            <section class="flex flex-col gap-12" :aria-label="trans('members.security.providers')" data-testid="ADM-10.security.providers">
                <h2 class="text-headline text-ink">{{ trans('members.security.providers') }}</h2>
                <p v-if="(security.providers ?? []).length === 0" class="text-admin-base text-ink-2">{{ trans('members.security.no_providers') }}</p>
                <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="account in security.providers" :key="account.id" class="flex min-h-40 flex-wrap items-center justify-between gap-x-12 border-b border-line-subtle px-12 py-4 text-admin-base last:border-b-0">
                        <span class="flex items-center gap-8">
                            <span class="text-ink">{{ trans(`members.security.provider_${account.provider}`) }}</span>
                            <Badge v-if="account.private_relay" tone="neutral">{{ trans('members.security.private_relay') }}</Badge>
                        </span>
                        <span class="text-ink-2 tabular-nums">{{ trans('members.security.linked_at', { date: formatDateTime(account.linked_at) }) }}</span>
                    </li>
                </ul>
            </section>
        </div>

        <section class="flex flex-col gap-12" :aria-label="trans('members.security.sign_ins')">
            <h2 class="text-headline text-ink">{{ trans('members.security.sign_ins') }}</h2>
            <p class="text-admin-base text-ink-3">{{ trans('members.security.sign_ins_note') }}</p>
            <p v-if="security.sign_ins.length === 0" class="text-admin-base text-ink-2">{{ trans('members.security.no_sign_ins') }}</p>
            <ol v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                <li v-for="(item, index) in security.sign_ins" :key="index" class="flex h-40 items-center justify-between gap-12 border-b border-line-subtle px-12 text-admin-base last:border-b-0">
                    <span class="text-ink">{{ deviceLabel(item, index) }}</span>
                    <span class="text-ink-2 tabular-nums">{{ trans('members.security.seen', { first: formatDateTime(item.first_seen_at), last: formatDateTime(item.last_seen_at) }) }}</span>
                </li>
            </ol>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.security.events')" data-testid="ADM-10.security.events">
            <h2 class="text-headline text-ink">{{ trans('members.security.events') }}</h2>
            <p class="text-admin-base text-ink-3">{{ trans('members.security.events_note') }}</p>
            <p v-if="(security.events ?? []).length === 0" class="text-admin-base text-ink-2">{{ trans('members.security.no_events') }}</p>
            <ol v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                <li v-for="group in eventGroups" :key="group.key" class="flex min-h-40 flex-wrap items-center justify-between gap-x-12 border-b border-line-subtle px-12 py-4 text-admin-base last:border-b-0" data-testid="ADM-10.security.event">
                    <span class="flex items-center gap-8">
                        <span class="text-ink">{{ actionLabel(group.event.type) }}</span>
                        <Badge v-if="group.count > 1" tone="neutral" tnum>{{ trans('members.security.times', { count: formatNumber(group.count) }) }}</Badge>
                    </span>
                    <span class="text-ink-2 tabular-nums">{{ [group.event.device_name, group.event.approx_city, eventWhen(group)].filter(Boolean).join(' · ') }}</span>
                </li>
            </ol>
        </section>
    </div>
</template>
