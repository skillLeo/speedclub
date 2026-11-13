import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { useDecisionWrites } from '../../composables/splitQueue';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** Shapes and helpers of ADM-55/56 (BusinessAdminRecord::rows / ::detail on the server). */
export type BusinessStatus = 'applied' | 'verified' | 'rejected' | 'suspended';
export type BusinessKind = 'workshop' | 'tuner' | 'detailing' | 'wrapping' | 'paint' | 'dealer' | 'parts_shop' | 'other';
export type BusinessAction = 'verify' | 'reject' | 'suspend' | 'reinstate' | 'reopen';
export const BUSINESS_KINDS: BusinessKind[] = ['workshop', 'tuner', 'detailing', 'wrapping', 'paint', 'dealer', 'parts_shop', 'other'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export interface BusinessRow {
    id: string;
    slug: string;
    name: string;
    kind: BusinessKind;
    city: string | null;
    status: BusinessStatus;
    legal_name: string | null;
    legal_form: string;
    submitted_at: string | null;
    version: string | null;
    waiting_minutes: number | null;
    owner: { id: string; username: string | null; joined_at: string | null };
    open_reports: number;
    removed: boolean;
    is_sample: boolean;
}

export interface BusinessDetail extends BusinessRow {
    about: string | null;
    services: string[];
    opening_hours: Partial<Record<(typeof WEEKDAYS)[number], [string, string][]>>;
    impressum: {
        legal_name: string | null;
        legal_form: string;
        representative: string | null;
        street: string | null;
        postcode: string | null;
        city: string | null;
        country: string | null;
        email: string | null;
        phone: string | null;
        website: string | null;
        register_court: string | null;
        register_number: string | null;
        vat_id: string | null;
    };
    needs_register: boolean;
    point: { lat: number | null; lng: number | null };
    document_note: string | null;
    logo: string | null;
    cover: string | null;
    review: { reason: string | null; reviewed_at: string | null; reviewed_by: string | null; verified_at: string | null; suspended_at: string | null };
    team: { username: string | null; role: 'owner' | 'staff' }[];
    tags: { accepted: number; pending: number };
    cases: { id: string; status: string; created_at: string | null }[];
    history: { action: string; reason: string | null; actor_type: string | null; occurred_at: string }[];
    can: Record<BusinessAction, boolean>;
}

/** The last decision of this session (BusinessActionsController → `businesses.decided`), for the 5-s undo. */
export interface DecidedBusiness {
    id: string;
    name: string;
    outcome: 'verified' | 'rejected' | 'reinstated' | 'reopened';
    status: BusinessStatus;
    version: string;
}

export const statusTones: Record<BusinessStatus, Tone> = { applied: 'warning', verified: 'success', rejected: 'danger', suspended: 'danger' };

export function statusLabel(business: Pick<BusinessRow, 'status' | 'removed'>): string {
    return trans(`businesses.status.${business.removed ? 'removed' : business.status}`);
}

/** "45 Min.", "5 Std.", "3 Tg.": the SLA timer of the queue. */
export function waitingText(minutes: number | null): string {
    if (minutes === null) return '–';
    if (minutes < 60) return trans('businesses.waiting.minutes', { count: formatNumber(minutes) });
    if (minutes < 48 * 60) return trans('businesses.waiting.hours', { count: formatNumber(Math.floor(minutes / 60)) });
    return trans('businesses.waiting.days', { count: formatNumber(Math.floor(minutes / (24 * 60))) });
}

/** An application waiting beyond a day is shown as a warning, as in the event queue (06 §3: queues with SLA timers). */
export const overdue = (minutes: number | null): boolean => minutes !== null && minutes >= 24 * 60;

export const queueUrl = (): string => routeOr('admin.businesses.queue', '/admin/businesses');
export const businessHref = (id: string): string => routeOr('admin.businesses.show', `/admin/businesses/${id}`, { business: id });
export const actionUrl = (id: string, action: BusinessAction): string => routeOr(`admin.businesses.${action}`, `/admin/businesses/${id}/${action}`, { business: id });

export const useBusinessWrites = () => useDecisionWrites<BusinessAction>('businesses', actionUrl);
