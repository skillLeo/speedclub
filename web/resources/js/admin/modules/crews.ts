import { PhUsersThree } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * Crews (R4-2.3, contract-crews.md §6/§8): ADM-80 the list and ADM-81 the record with the Staff actions (hide · unhide · delete ·
 * restore). Under Trust & Safety next to the forum; the whole module needs moderation.decide, the atom of the crew Staff actions.
 */
export default defineModule({
    key: 'crews',
    nav: [
        {
            group: 'moderation',
            items: [
                {
                    route: 'admin.crews.index',
                    match: 'admin.crews.*',
                    label: 'crews.nav.title',
                    icon: PhUsersThree,
                    atom: 'moderation.decide',
                    order: 1.7,
                    testId: 'crews',
                    keywords: ['crews', 'crew', 'gruppen', 'groups', 'clans', 'clubs', 'ausblenden', 'hide'],
                },
            ],
        },
    ],
    palette: [
        { key: 'crews-hidden', label: 'crews.presets.hidden', route: 'admin.crews.index', params: { 'filter[status]': 'hidden' }, atom: 'moderation.decide', keywords: ['ausgeblendete crews', 'hidden crews'] },
    ],
});
