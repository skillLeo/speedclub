import { PhLifebuoy, PhTextbox } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Support (ADM-25…27, M3.4): tickets from SET-15 and WEB-10, and the reply macros. Dashboard queue: open and waiting tickets. */
export default defineModule({
    key: 'support',
    nav: [
        {
            group: 'support',
            items: [
                { route: 'admin.support.tickets', match: 'admin.support.tickets*', label: 'support.nav.tickets', icon: PhLifebuoy, atom: 'support.view', order: 1, testId: 'support-tickets', keywords: ['support', 'tickets', 'anfragen', 'kontakt'] },
                { route: 'admin.support.macros', match: 'admin.support.macros', label: 'support.nav.macros', icon: PhTextbox, atom: 'support.view', order: 2, testId: 'support-macros', keywords: ['textbausteine', 'macros', 'vorlagen'] },
            ],
        },
    ],
    palette: [{ key: 'support-mine', label: 'support.tickets.presets.mine', route: 'admin.support.tickets', params: { 'filter[assigned]': 'me', 'filter[status]': 'active' }, atom: 'support.view', keywords: ['meine tickets'] }],
    queues: [{ key: 'support_tickets', label: 'dashboard.queues.support_tickets', empty: 'dashboard.queues.support_tickets_empty', atom: 'support.view', route: 'admin.support.tickets', order: 40, testId: 'support-tickets' }],
});
