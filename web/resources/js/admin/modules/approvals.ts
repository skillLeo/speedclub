import { PhSealCheck } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Team & Rollen: ADM-43 approvals queue (four-eyes, ADR-214). Every staff member sees their own requests; deciding needs approvals.decide. */
export default defineModule({
    key: 'approvals',
    nav: [
        {
            group: 'team',
            items: [{ route: 'admin.team.approvals', match: 'admin.team.approvals*', label: 'approvals.nav.title', icon: PhSealCheck, order: 5, badge: 'approvals_for_me', testId: 'approvals', keywords: ['freigaben', 'approvals', 'vier augen', 'four eyes'] }],
        },
    ],
});
