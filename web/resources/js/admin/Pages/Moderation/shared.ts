import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** Shared shapes and labels of the moderation pages (ADM-20…24); the server builds them in CaseListQuery / CaseRecord. */
export type TargetType = 'member' | 'vehicle' | 'photo' | 'message' | 'build_update' | 'modification' | 'comment' | 'event';
export type CaseStatus = 'new' | 'in_review' | 'decided' | 'closed';
export type DecisionActionKey = 'no_action' | 'remove_content' | 'restrict' | 'suspend' | 'reverse';

export interface PriorityParts {
    total: number;
    reason: number;
    reporters: number;
    reporter_count: number;
    repeat: number;
    repeat_count: number;
    age: number;
    age_days: number;
}

export interface Assigned {
    id: number;
    name: string;
    me: boolean;
}

export interface CaseRow {
    id: string;
    reference: string;
    status: CaseStatus;
    origin: 'report' | 'staff';
    target_type: TargetType;
    target_label: string | null;
    reason: string | null;
    sub_reason: string | null;
    other_reasons: number;
    reporters: number;
    reports: number;
    automated: boolean;
    web_form: boolean;
    priority: PriorityParts;
    first_report_at: string | null;
    last_report_at: string | null;
    assigned: Assigned | null;
    ai_score: number | null;
    ai_summary: string | null;
    decision: { action: DecisionActionKey; decided_at: string } | null;
    /** ADM-22 only: the username of the member who reported the message first (DQ-598). */
    reporter?: string | null;
}

export interface CaseSummary {
    id: string;
    reference: string;
    status: CaseStatus;
    origin: 'report' | 'staff';
    target_type: TargetType;
    target_id: string;
    target_label: string | null;
    subject: { id: string; username: string | null; deleted: boolean } | null;
    assigned: Assigned | null;
    report_count: number;
    automated_detection: boolean;
    ai_score: number | null;
    ai_summary: string | null;
    appeal_id: string | null;
    priority: PriorityParts;
    created_at: string | null;
    decided_at: string | null;
}

export interface ReportItem {
    id: string;
    source: 'app' | 'web_form' | 'automated';
    reason: string;
    sub_reason: string | null;
    details: string | null;
    details_withheld: boolean;
    good_faith: boolean;
    reporter: { id: string; username: string | null } | null;
    /** The address is always masked (SEC-P3-25); can_reveal_contact: "Anzeigen" fetches it (members.view_pii, audited, capped). */
    contact: { name: string | null; email: string | null } | null;
    can_reveal_contact: boolean;
    created_at: string;
}

export interface AppealItem {
    id: string;
    role: 'affected' | 'reporter';
    status: 'open' | 'upheld' | 'reversed';
    appellant: string | null;
    text: string | null;
    created_at: string;
    decided_at: string | null;
    decided_by: string | null;
    may_decide: boolean;
}

export interface DecisionDetail {
    id: string;
    action: DecisionActionKey;
    restriction: { type?: string; until?: string | null } | null;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string | null;
    automated_detection: boolean;
    automated_decision: boolean;
    decided_by: { id: number; name: string; me: boolean } | null;
    decided_at: string;
    appeal_until: string | null;
    reverses_decision_id: string | null;
    reversed_by: { id: string; decided_at: string } | null;
    appeals: AppealItem[];
}

export interface PriorDecision {
    id: string;
    case_id: string;
    action: DecisionActionKey;
    target_type: TargetType;
    decided_at: string;
    reversed: boolean;
}

export interface ComposerOptions {
    actions: Exclude<DecisionActionKey, 'reverse'>[];
    member_locale: 'de' | 'en';
    max_suspension_days: number | null;
    automated_detection: boolean;
    automated_decision: boolean;
    placeholders: { target: string; date: string; member: string };
}

export interface SorTemplate {
    id: string;
    key: string;
    locale: 'de' | 'en';
    action: string;
    label: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string | null;
    sort: number;
    updated_at: string | null;
}

/** "Foto von Audi RS6 C8", "Profil @paul.roadster"; language-free label from the server, framed per type. */
export function targetText(type: TargetType, label: string | null): string {
    return label === null || label === '' ? `${trans(`moderation.target_types.${type}`)} · ${trans('moderation.unnamed')}` : trans(`moderation.target_of.${type}`, { label });
}

export function reasonText(reason: string | null, sub: string | null = null): string {
    if (reason === null) return '–';
    const main = trans(`moderation.reasons.${reason}`);
    return sub === null ? main : `${main} · ${trans(`moderation.sub_reasons.${sub}`)}`;
}

export function priorityTooltip(p: PriorityParts): string {
    return trans('moderation.priority.tooltip', {
        total: formatNumber(p.total),
        reason: formatNumber(p.reason),
        reporters: formatNumber(p.reporters),
        count: formatNumber(p.reporter_count),
        repeat: formatNumber(p.repeat),
        repeat_count: formatNumber(p.repeat_count),
        age: formatNumber(p.age),
        days: formatNumber(p.age_days),
    });
}

export const statusTones: Record<CaseStatus, Tone> = { new: 'info', in_review: 'warning', decided: 'neutral', closed: 'neutral' };
export const outcomeTones: Record<DecisionActionKey, Tone> = { no_action: 'neutral', remove_content: 'warning', restrict: 'warning', suspend: 'danger', reverse: 'success' };
export const appealTones: Record<AppealItem['status'], Tone> = { open: 'info', upheld: 'neutral', reversed: 'success' };

export function caseHref(id: string): string {
    return routeOr('admin.moderation.cases.show', `/admin/moderation/cases/${id}`, { case: id });
}

export function memberHref(id: string): string {
    return routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
}

/** Fills {target}, {date}, {member} of a template. */
export function fillPlaceholders(text: string, values: ComposerOptions['placeholders']): string {
    return text.replaceAll('{target}', values.target).replaceAll('{date}', values.date).replaceAll('{member}', values.member);
}
