import { trans } from 'laravel-vue-i18n';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** Shapes and helpers of ADM-62 Spots (SpotListQuery::rows / SpotAdminRecord::detail on the server). */
export type SignalKey = 'burst' | 'device' | 'hop';

export interface SpotSignals {
    burst: { spots: number } | null;
    device: { accounts: number } | null;
    hop: { city: string | null; minutes: number; km: number } | null;
}

export interface SpotRow {
    id: string;
    spotted_at: string | null;
    spotter: { id: string; username: string | null };
    vehicle: { id: string; title: string; dex_number: number | null; cover: string | null; cover_focus: string | null; cover_placeholder: string | null };
    city: string | null;
    bundesland: string | null;
    counted: boolean;
    night: boolean;
    first_three: boolean;
    source: string;
    removed_at: string | null;
    signals: SpotSignals;
}

export interface SignalRules {
    device_available: boolean;
    burst: { more_than: number; minutes: number };
    hop: { km: number; minutes: number };
}

export const SIGNAL_KEYS: SignalKey[] = ['burst', 'device', 'hop'];

export function activeSignals(signals: SpotSignals | null | undefined): SignalKey[] {
    return signals ? SIGNAL_KEYS.filter((key) => signals[key] !== null) : [];
}

/** "12 Spots in 10 Min.", "Gerät mit 2 weiteren Konten", "München, 456 km in 40 Min.". */
export function signalDetail(key: SignalKey, signals: SpotSignals, rules: SignalRules | null): string {
    if (key === 'burst' && signals.burst) return trans('spots.signal.burst_detail', { count: formatNumber(signals.burst.spots), minutes: formatNumber(rules?.burst.minutes ?? 10) });
    if (key === 'device' && signals.device) return trans('spots.signal.device_detail', { count: formatNumber(signals.device.accounts) });
    if (key === 'hop' && signals.hop) {
        const values = { km: formatNumber(signals.hop.km), minutes: formatNumber(signals.hop.minutes) };
        return signals.hop.city ? trans('spots.signal.hop_detail', { city: signals.hop.city, ...values }) : trans('spots.signal.hop_detail_unknown', values);
    }
    return '';
}

export function dexLabel(number: number | null): string {
    return number === null ? trans('spots.no_dex_number') : trans('spots.dex_number', { number: String(number) });
}

export const indexUrl = (): string => routeOr('admin.spots.index', '/admin/moderation/spots');
export const spotHref = (id: string): string => routeOr('admin.spots.show', `/admin/moderation/spots/${id}`, { spot: id });
export const removeUrl = (id: string): string => routeOr('admin.spots.remove', `/admin/moderation/spots/${id}/remove`, { spot: id });
export const bulkRemoveUrl = (): string => routeOr('admin.spots.bulk-remove', '/admin/moderation/spots/bulk-remove');
export const vehicleHref = (id: string): string => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });

/** A server error is an admin i18n key (RemoveSpots' window and busy refusals) or a validation sentence. */
export function errorText(message: string | undefined): string | null {
    if (message === undefined) return null;
    return /^spots\.[a-z_.]+$/.test(message) ? trans(message) : message;
}
