<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import Badge from '../../../Components/ui/Badge.vue';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import { formatDateTime, formatRelative } from '../../../lib/format';
import type { MemberSecurity } from '../types';

/** ADM-10 "Sicherheit & Sitzungen": two-factor state, signed-in devices (dates, device names, platform; never an IP), sign-ins by device. */
defineProps<{ security: MemberSecurity }>();

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
            <h2 class="text-title-s text-ink">{{ trans('members.security.two_factor') }}</h2>
            <div class="flex flex-wrap items-center gap-12">
                <StatusPill :tone="security.two_factor.on ? 'success' : 'neutral'" :label="trans(security.two_factor.on ? 'members.security.two_factor_on' : 'members.security.two_factor_off')" />
                <span v-if="security.two_factor.confirmed_at" class="text-supporting text-ink-2 tabular-nums">{{ trans('members.security.confirmed_at', { date: formatDateTime(security.two_factor.confirmed_at) }) }}</span>
                <StatusPill v-if="security.two_factor.locked_at" tone="warning" :label="trans('members.security.locked', { date: formatDateTime(security.two_factor.locked_at) })" />
                <StatusPill v-if="security.force_password_change" tone="warning" :label="trans('members.security.force_password_change')" />
            </div>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.security.devices')">
            <h2 class="text-title-s text-ink">{{ trans('members.security.devices') }}</h2>
            <p v-if="security.devices.length === 0" class="text-supporting text-ink-2">{{ trans('members.security.no_devices') }}</p>
            <ScrollRegion v-else :label="trans('members.security.devices')">
                <table class="w-full border-collapse text-supporting">
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
                        <tr v-for="device in security.devices" :key="device.id" class="h-40 border-b border-line-subtle last:border-b-0">
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
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <section class="flex flex-col gap-12" :aria-label="trans('members.security.sign_ins')">
            <h2 class="text-title-s text-ink">{{ trans('members.security.sign_ins') }}</h2>
            <p class="text-helper text-ink-3">{{ trans('members.security.sign_ins_note') }}</p>
            <p v-if="security.sign_ins.length === 0" class="text-supporting text-ink-2">{{ trans('members.security.no_sign_ins') }}</p>
            <ol v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                <li v-for="(item, index) in security.sign_ins" :key="index" class="flex h-40 items-center justify-between gap-12 border-b border-line-subtle px-12 text-supporting last:border-b-0">
                    <span class="text-ink">{{ deviceLabel(item, index) }}</span>
                    <span class="text-ink-2 tabular-nums">{{ trans('members.security.seen', { first: formatDateTime(item.first_seen_at), last: formatDateTime(item.last_seen_at) }) }}</span>
                </li>
            </ol>
        </section>
    </div>
</template>
