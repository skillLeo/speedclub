<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import VehicleThumb from '../../../Components/patterns/VehicleThumb.vue';
import EmptyQueue from '../../../Components/ui/EmptyQueue.vue';
import QrCodeText from '../../../Components/ui/QrCodeText.vue';
import StatusPill from '../../../Components/ui/StatusPill.vue';
import { focusRing } from '../../../Components/ui/styles';
import { formatDate, formatNumber } from '../../../lib/format';
import { hasRoute, routeOr } from '../../../lib/routes';
import { moderationPill, visibilityPill } from '../../../lib/vehicleStatus';
import type { MemberVehicle } from '../types';

/** ADM-10 "Fahrzeuge": the member's vehicles with visibility, moderation state, photos, mods and QR, linked to ADM-12. */
defineProps<{ vehicles: MemberVehicle[] }>();
const href = (id: string): string | null => (hasRoute('admin.vehicles.show') ? routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id }) : null);
const pills = (vehicle: MemberVehicle) => [visibilityPill(vehicle), moderationPill(vehicle)].filter((pill) => pill !== null);
const qrHref = (code: string): string | null => (hasRoute('admin.qr.show') ? routeOr('admin.qr.show', `/admin/qr/${code}`, { qr: code }) : null);
</script>

<template>
    <EmptyQueue v-if="vehicles.length === 0" variant="first" :title="trans('members.vehicles.empty_title')" :body="trans('members.vehicles.empty_body')" data-testid="ADM-10.vehicles.empty" />
    <ScrollRegion v-else :label="trans('members.vehicles.caption')" test-id="ADM-10.vehicles">
        <table class="w-full border-collapse text-admin-base">
            <caption class="sr-only">{{ trans('members.vehicles.caption') }}</caption>
            <thead>
                <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                    <th scope="col" class="w-56 px-12"><span class="sr-only">{{ trans('members.vehicles.cover') }}</span></th>
                    <th scope="col" class="px-12">{{ trans('members.vehicles.title') }}</th>
                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.vehicles.visibility') }}</th>
                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('members.vehicles.photos') }}</th>
                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('members.vehicles.mods') }}</th>
                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.vehicles.qr') }}</th>
                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.vehicles.updated') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="vehicle in vehicles" :key="vehicle.id" class="h-40 border-b border-line-subtle last:border-b-0">
                    <td class="px-12"><VehicleThumb :src="vehicle.cover" :focus="vehicle.cover_focus" :placeholder="vehicle.cover_placeholder" /></td>
                    <td class="px-12">
                        <component :is="href(vehicle.id) ? Link : 'span'" :href="href(vehicle.id) ?? undefined" :title="vehicle.title" :class="[href(vehicle.id) ? `${focusRing} hover:underline` : '', 'inline-flex min-h-32 items-center rounded-xs text-ink']">
                            {{ vehicle.title }}<template v-if="vehicle.model_year"> · {{ vehicle.model_year }}</template>
                        </component>
                    </td>
                    <td class="whitespace-nowrap px-12">
                        <span class="flex items-center gap-4">
                            <StatusPill v-for="pill in pills(vehicle)" :key="pill.label" :tone="pill.tone" :label="pill.label" />
                        </span>
                    </td>
                    <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(vehicle.photos) }}</td>
                    <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(vehicle.mods) }}</td>
                    <td class="whitespace-nowrap px-12">
                        <QrCodeText v-if="vehicle.qr" :code="vehicle.qr" :href="qrHref(vehicle.qr)" muted />
                        <span v-else class="text-ink-3">–</span>
                    </td>
                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDate(vehicle.updated_at) }}</td>
                </tr>
            </tbody>
        </table>
    </ScrollRegion>
</template>
