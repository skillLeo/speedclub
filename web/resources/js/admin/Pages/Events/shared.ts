import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { useDecisionWrites } from '../../composables/splitQueue';
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

/** The writes of ADM-53/54 with their optimistic lock (ADR-439), from the shared SplitQueue composable. */
export const useEventWrites = () => useDecisionWrites<EventAction>('events', actionUrl);
