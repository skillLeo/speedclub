import { router } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { ref } from 'vue';
import type { Tone } from '../../Components/ui';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** Shapes and helpers of ADM-53/54 (EventAdminRecord::rows / ::detail on the server). */
export type EventStatus = 'draft' | 'pending_review' | 'published' | 'cancelled' | 'rejected';
export type EventTypeKey = 'meet' | 'cruise' | 'track_day' | 'show';
export type EventAction = 'approve' | 'reject' | 'cancel' | 'reopen';

export interface EventRow {
    id: string;
    slug: string;
    title: string;
    type: EventTypeKey;
    status: EventStatus;
    visibility: 'public' | 'followers' | 'unlisted';
    location_visibility: 'public' | 'after_rsvp';
    starts_at: string | null;
    ends_at: string | null;
    city: string | null;
    submitted_at: string | null;
    version: string | null;
    changed_since_review: string[];
    waiting_minutes: number | null;
    organiser: { id: string; username: string | null; joined_at: string | null; approved_events: number };
    going: number;
    open_reports: number;
    is_sample: boolean;
}

export interface EventDetail extends EventRow {
    description: string | null;
    organiser_rules: string | null;
    rules: string[];
    capacity: number | null;
    counts: { going: number; interested: number; waitlist: number };
    place: { venue_name: string | null; street: string | null; postcode: string | null; city: string | null; country: string | null; lat: number | null; lng: number | null };
    cover: string | null;
    review: { reason: string | null; reviewed_at: string | null; reviewed_by: string | null };
    cancellation: { reason: string | null; cancelled_at: string | null; by_staff: boolean };
    removed_at: string | null;
    updates: { id: string; body: string; created_at: string | null }[];
    cases: { id: string; status: string; created_at: string | null }[];
    can: Record<EventAction, boolean>;
}

/** The last decision of this session (EventActionsController → `events.decided`), for the 5-s undo. */
export interface DecidedEvent {
    id: string;
    title: string;
    outcome: 'approved' | 'rejected' | 'cancelled' | 'reopened';
    status: EventStatus;
    version: string;
}

export const statusTones: Record<EventStatus, Tone> = { draft: 'neutral', pending_review: 'warning', published: 'success', cancelled: 'neutral', rejected: 'danger' };

export function statusLabel(event: Pick<EventRow, 'status'> & { removed_at?: string | null }): string {
    return trans(`events.status.${event.removed_at ? 'removed' : event.status}`);
}

/** "45 Min.", "5 Std.", "3 Tg.": the SLA timer of the queue. */
export function waitingText(minutes: number | null): string {
    if (minutes === null) return '–';
    if (minutes < 60) return trans('events.waiting.minutes', { count: formatNumber(minutes) });
    if (minutes < 48 * 60) return trans('events.waiting.hours', { count: formatNumber(Math.floor(minutes / 60)) });
    return trans('events.waiting.days', { count: formatNumber(Math.floor(minutes / (24 * 60))) });
}

/** An SLA beyond a day is shown as a warning (06 §3: queues with SLA timers). */
export const overdue = (minutes: number | null): boolean => minutes !== null && minutes >= 24 * 60;

export function organiserCaption(row: EventRow): string {
    return row.organiser.approved_events === 0 ? trans('events.organiser.first') : trans('events.organiser.approved', { count: formatNumber(row.organiser.approved_events) });
}

export function changedFields(row: EventRow): string {
    return [...new Set(row.changed_since_review.map((field) => trans(`events.fields.${field}`)))].join(', ');
}

export const queueUrl = (): string => routeOr('admin.events.queue', '/admin/events');
export const eventHref = (id: string): string => routeOr('admin.events.show', `/admin/events/${id}`, { event: id });
export const actionUrl = (id: string, action: EventAction): string => routeOr(`admin.events.${action}`, `/admin/events/${id}/${action}`, { event: id });

/**
 * The writes of ADM-53/54 with their optimistic lock (ADR-439): every post carries the version the page shows. A changed event answers
 * the error `version` ("changed meanwhile": `conflict` is set and the page offers a reload), a decided one the error `state`.
 */
export function useEventWrites() {
    const processing = ref<EventAction | null>(null);
    const conflict = ref(false);
    const error = ref<string | null>(null);

    function post(event: Pick<EventRow, 'id' | 'version'>, action: EventAction, data: { reason?: string | null } = {}, onSuccess?: () => void): void {
        router.post(actionUrl(event.id, action), { ...data, version: event.version ?? '' } as never, {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                processing.value = action;
                conflict.value = false;
                error.value = null;
            },
            onFinish: () => (processing.value = null),
            onSuccess: (page) => {
                const errors = (page.props.errors ?? {}) as Record<string, string>;
                if (Object.keys(errors).length === 0) onSuccess?.();
            },
            onError: (errors) => {
                if (errors.version === 'events.conflict.changed') {
                    conflict.value = true;
                    return;
                }
                const first = errors.reason ?? errors.state ?? errors.version ?? Object.values(errors)[0] ?? null;
                error.value = first === null ? null : first.startsWith('events.') ? trans(first) : first;
            },
        });
    }

    function reload(only?: string[]): void {
        conflict.value = false;
        error.value = null;
        router.reload(only ? { only } : {});
    }

    return { processing, conflict, error, post, reload };
}
