import { PhCrownSimple, PhTicket } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * ADM-F1/F2 memberships scaffold, behind `premium.enabled`. While the flag is off the routes answer 404 and the server leaves
 * memberships.manage out of `staff.permissions` (HandleInertiaRequests), so these entries stay hidden.
 */
export default defineModule({
    key: 'memberships',
    nav: [
        {
            group: 'settings',
            items: [
                { route: 'admin.memberships.plans', match: 'admin.memberships.plans', label: 'memberships.nav.plans', icon: PhCrownSimple, atom: 'memberships.manage', order: 5, testId: 'memberships-plans', keywords: ['premium', 'mitgliedschaft', 'plan'] },
                { route: 'admin.memberships.entitlements', match: 'admin.memberships.entitlements', label: 'memberships.nav.entitlements', icon: PhTicket, atom: 'memberships.manage', order: 6, testId: 'memberships-entitlements', keywords: ['premium', 'freischaltung', 'entitlement'] },
            ],
        },
    ],
});
