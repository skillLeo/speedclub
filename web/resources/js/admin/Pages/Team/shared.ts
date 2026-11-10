import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { actionLabel } from '../../lib/audit';
import { routeOr } from '../../lib/routes';

/** Shared bits of ADM-39…42 (Team & Rollen). */
export type StaffState = 'active' | 'invited' | 'suspended' | 'deactivated' | 'deleted';

export interface RoleOption {
    name: string;
    description: string | null;
    atoms: string[];
    sensitive: boolean;
    locked: boolean;
}

export interface StaffRow {
    id: number;
    name: string;
    email: string | null;
    roles: string[];
    state: StaffState;
    two_factor: boolean;
    last_login_at: string | null;
    created_at: string | null;
    invite_expires_at: string | null;
    me: boolean;
}

/** The four-eyes atoms of the permission matrix (PermissionMatrix::SENSITIVE). */
export const SENSITIVE_ATOMS = ['roles.manage', 'approvals.decide', 'members.delete', 'members.export', 'audit.export', 'maintenance.toggle'];
export const PRIVILEGED_ROLES = ['owner', 'admin'];
const SEEDED_ROLES = ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'];

export const stateTones: Record<StaffState, Tone> = { active: 'success', invited: 'warning', suspended: 'danger', deactivated: 'neutral', deleted: 'neutral' };

/** A seeded role's German/English name; a custom role keeps the name it was given. */
export function roleLabel(name: string): string {
    return SEEDED_ROLES.includes(name) ? trans(`team.roles_names.${name}`) : name;
}

/** What a role may do, in one line (DQ-634): a custom role's own description, else the base role's from the lang file. */
export function roleDescription(name: string, description: string | null): string | null {
    if (description !== null && description !== '') return description;
    return SEEDED_ROLES.includes(name) ? trans(`team.roles_about.${name}`) : null;
}

/** The label of a permission atom ("members.view_pii" → "Persönliche Daten sehen"); an unknown atom stays as it is. */
export function atomLabel(atom: string): string {
    const key = `team.atoms.${atom}`;
    const text = trans(key);
    return text === key ? atom : text;
}

export function atomGroupLabel(group: string): string {
    const key = `team.atom_groups.${group}`;
    const text = trans(key);
    return text === key ? group : text;
}

/** Atoms grouped by their first segment, in the order of the list. */
export function groupAtoms(atoms: string[]): { group: string; atoms: string[] }[] {
    const groups: { group: string; atoms: string[] }[] = [];
    for (const atom of atoms) {
        const group = atom.split('.')[0] ?? atom;
        const last = groups[groups.length - 1];
        if (last && last.group === group) last.atoms.push(atom);
        else groups.push({ group, atoms: [atom] });
    }
    return groups;
}

/** Every atom the roles carry (sorted, unique). */
export function atomsOf(roles: string[], options: RoleOption[]): string[] {
    const set = new Set<string>();
    for (const option of options) if (roles.includes(option.name)) option.atoms.forEach((atom) => set.add(atom));
    return [...set].sort();
}

/**
 * Whether a role change is four-eyes, by the server's rules (ChangeStaffRoles): it grants Owner/Admin or a sensitive atom (also through a
 * custom role), it touches an Owner, or it takes Admin away.
 */
export function roleChangeReasons(before: string[], after: string[], options: RoleOption[]): ('elevates' | 'owner' | 'demotes')[] {
    const reasons: ('elevates' | 'owner' | 'demotes')[] = [];
    const addedAtoms = atomsOf(after, options).filter((atom) => !atomsOf(before, options).includes(atom));
    if (after.some((role) => PRIVILEGED_ROLES.includes(role) && !before.includes(role)) || addedAtoms.some((atom) => SENSITIVE_ATOMS.includes(atom))) reasons.push('elevates');
    if (before.includes('owner') || after.includes('owner')) reasons.push('owner');
    if (before.includes('admin') && !after.includes('admin')) reasons.push('demotes');
    return reasons;
}

/** An audit action of a staff record: the Team label when there is one, else the audit log's. */
export function teamEventLabel(action: string): string {
    const key = `team.events.${action}`;
    const text = trans(key);
    return text === key ? actionLabel(action) : text;
}

export const staffHref = (id: number) => routeOr('admin.team.staff.show', `/admin/team/${id}`, { staff: id });
