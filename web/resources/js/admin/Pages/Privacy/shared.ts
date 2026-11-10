import { trans, transChoice } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { actionLabel } from '../../lib/audit';
import { formatDate, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** Shared bits of ADM-45/46 (GDPR requests). */
export type RequestStatus = 'open' | 'in_progress' | 'waiting' | 'completed' | 'rejected';
export type RequestType = 'access' | 'export' | 'erasure' | 'rectification' | 'objection' | 'restriction';

export interface Requester {
    kind: 'member' | 'external';
    id: string | null;
    username: string | null;
    deleted: boolean;
    name: string | null;
    email: string | null;
}

export interface RequestRow {
    id: string;
    reference: string;
    type: RequestType;
    article: number;
    status: RequestStatus;
    source: 'email' | 'post' | 'support' | 'other';
    requester: Requester;
    received_at: string;
    due_at: string;
    extended: boolean;
    /** The deadline as the server reads it with the page's clock (DQ-617): the browser never compares dates itself. */
    due: { state: 'overdue' | 'soon' | 'later' | 'done'; days: number };
    completed_at: string | null;
    assigned: { id: number; name: string; me: boolean } | null;
}

export const statusTones: Record<RequestStatus, Tone> = { open: 'warning', in_progress: 'info', waiting: 'neutral', completed: 'success', rejected: 'neutral' };
export const FINAL: RequestStatus[] = ['completed', 'rejected'];

/** How the due date reads (≤ N days emphasised, overdue in red); closed requests show when they were done. The state comes from the server. */
export function dueInfo(row: Pick<RequestRow, 'due' | 'completed_at'>): { text: string; tone: 'warning' | 'danger' | null } {
    const { state, days } = row.due;
    if (state === 'done') return { text: trans('privacy.due.done', { date: formatDate(row.completed_at) }), tone: null };
    if (state === 'overdue') return { text: transChoice('privacy.due.overdue', days, { count: formatNumber(days) }), tone: 'danger' };
    return { text: transChoice('privacy.due.in_days', days, { count: formatNumber(days) }), tone: state === 'soon' ? 'warning' : null };
}

export function requesterText(r: Requester): string {
    if (r.kind === 'member') return r.deleted ? trans('privacy.requests.deleted_member') : r.username ? `@${r.username}` : trans('privacy.requests.deleted_member');
    return r.name ?? trans('privacy.requests.external');
}

export function typeLabel(type: RequestType): string {
    return trans(`privacy.types.${type}`);
}

/** An audit action of a request: the privacy label when there is one, else the audit log's. */
export function privacyEventLabel(action: string): string {
    const key = `privacy.events.${action}`;
    const text = trans(key);
    return text === key ? actionLabel(action) : text;
}

export const requestHref = (id: string) => routeOr('admin.privacy.requests.show', `/admin/privacy/requests/${id}`, { privacyRequest: id });
export const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
