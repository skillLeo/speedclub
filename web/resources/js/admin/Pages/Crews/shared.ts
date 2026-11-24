import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { routeOr } from '../../lib/routes';

/** ADM-80/81 Crews (R4-2.3): the shapes of App\Http\Controllers\Admin\Crews\CrewAdminRecord. */
/** R4DQ-55: `ended` = the system ended it because nobody was left (crews.ended_reason). */
export type CrewState = 'active' | 'hidden' | 'removed' | 'deleted' | 'ended';
export type JoinMode = 'open' | 'request' | 'invite';
export type CrewRole = 'founder' | 'admin' | 'member';

export interface CrewRow {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    founder: { id: string; username: string | null } | null;
    bundesland: string | null;
    join_mode: JoinMode;
    members: number;
    state: CrewState;
    is_sample: boolean;
    created_at: string | null;
}

export interface CrewDetail {
    id: string;
    name: string;
    slug: string;
    previous_slug: string | null;
    description: string | null;
    bundesland: string | null;
    join_mode: JoinMode;
    state: CrewState;
    is_sample: boolean;
    members: number;
    logo: string | null;
    cover: string | null;
    cover_placeholder: string | null;
    founder: { id: string; username: string | null; display_name: string | null } | null;
    open_requests: number;
    open_invites: number;
    hidden_since: string | null;
    removed_at: string | null;
    deleted_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    public_url: string | null;
    can: { hide: boolean; unhide: boolean; remove: boolean; restore: boolean };
}

export interface CrewMemberRow {
    id: string;
    member: { id: string; username: string | null; display_name: string | null; status: string } | null;
    role: CrewRole;
    joined_at: string;
}

export interface CrewCase {
    id: string;
    origin: 'report' | 'staff';
    status: string;
    report_count: number;
    created_at: string | null;
    decision: { action: string; decided_at: string } | null;
}

/** Hidden and both deletions are exceptions (danger), an active crew is the quiet default. */
export const stateTone: Record<CrewState, Tone> = { active: 'neutral', hidden: 'warning', removed: 'danger', deleted: 'neutral', ended: 'neutral' };

export const stateLabel = (state: CrewState): string => trans(`crews.state.${state}`);

export const indexUrl = (): string => routeOr('admin.crews.index', '/admin/crews');
export const showUrl = (id: string): string => routeOr('admin.crews.show', `/admin/crews/${id}`, { crew: id });
export const actionUrl = (id: string, action: 'hide' | 'unhide' | 'remove' | 'restore'): string => routeOr(`admin.crews.${action}`, `/admin/crews/${id}/${action}`, { crew: id });
