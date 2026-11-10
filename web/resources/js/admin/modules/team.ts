import { PhGridNine, PhIdentificationBadge, PhUsersThree } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Team & Rollen (ADM-39…42, M3.6): staff list with invitations, roles, the permission matrix. ADM-43 approvals live in approvals.ts. */
export default defineModule({
    key: 'team',
    nav: [
        {
            group: 'team',
            items: [
                { route: 'admin.team.staff', match: 'admin.team.staff*', label: 'team.nav.staff', icon: PhUsersThree, atom: 'staff.view', order: 1, testId: 'team', keywords: ['team', 'staff', 'mitarbeiter', 'einladen', 'invite'] },
                { route: 'admin.team.roles', match: 'admin.team.roles', label: 'team.nav.roles', icon: PhIdentificationBadge, atom: 'staff.view', order: 2, testId: 'team-roles', keywords: ['rollen', 'roles'] },
                { route: 'admin.team.permissions', match: 'admin.team.permissions', label: 'team.nav.permissions', icon: PhGridNine, atom: 'staff.view', order: 3, testId: 'team-permissions', keywords: ['rechte', 'berechtigungen', 'permissions', 'matrix'] },
            ],
        },
    ],
    palette: [{ key: 'team-invited', label: 'team.index.presets.invited', route: 'admin.team.staff', params: { 'filter[state]': 'invited' }, atom: 'staff.view', keywords: ['einladungen', 'invitations'] }],
});
