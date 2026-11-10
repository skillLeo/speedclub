import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { routeOr } from '../../lib/routes';

/** Shapes and labels of ADM-25…27 (TicketListQuery / TicketShowController). */
export type TicketStatus = 'open' | 'pending' | 'closed';

export interface TicketFrom {
    kind: 'member' | 'web';
    id: string | null;
    username: string | null;
    name: string | null;
    email: string | null;
}

export interface TicketAssigned {
    id: number;
    name: string;
    me: boolean;
}

export const statusTones: Record<TicketStatus, Tone> = { open: 'info', pending: 'warning', closed: 'neutral' };

export function fromText(from: TicketFrom): string {
    if (from.kind === 'member') return from.username ? `@${from.username}` : trans('support.tickets.from.member_unknown');
    return from.name ?? from.email ?? trans('support.tickets.from.web_unknown');
}

export function ticketHref(id: string): string {
    return routeOr('admin.support.tickets.show', `/admin/support/tickets/${id}`, { ticket: id });
}

/** Fills {name} and {reference} of a macro (no staff name: replies sign as the team, ADR-240 f). */
export function fillVariables(text: string, values: Record<string, string>): string {
    return Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text);
}
