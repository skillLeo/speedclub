import { PhProhibit, PhUsers } from '@phosphor-icons/vue';
import { routeOr } from '../lib/routes';
import { defineModule } from './registry';

/** Mitglieder (ADM-09/10, M3.2): list, record, saved views as palette shortcuts. */
export default defineModule({
    key: 'members',
    nav: [
        {
            group: 'members',
            items: [{ route: 'admin.members.index', match: 'admin.members.*', label: 'members.nav.title', icon: PhUsers, atom: 'members.view', order: 1, testId: 'members', keywords: ['mitglieder', 'members', 'nutzer', 'konto'] }],
        },
    ],
    actions: [
        {
            key: 'member-suspend',
            label: 'shell.palette.actions.member_suspend',
            kind: 'member',
            atom: 'members.suspend',
            route: 'admin.members.show',
            target: (id: string) => `${routeOr('admin.members.show', `/admin/members/${id}`, { member: id })}?action=suspend`,
            icon: PhProhibit,
            keywords: ['sperren', 'suspend', 'block', 'mitglied'],
        },
    ],
    palette: [
        { key: 'members-restricted', label: 'members.presets.restricted', route: 'admin.members.index', params: { 'filter[restricted]': 'any' }, atom: 'members.view', keywords: ['eingeschränkt', 'gesperrt', 'restricted'] },
        { key: 'members-reported', label: 'members.presets.reported', route: 'admin.members.index', params: { 'filter[reported]': '1' }, atom: 'members.view', keywords: ['gemeldet', 'reported'] },
    ],
});
