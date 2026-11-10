import { PhUserCircle } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Einstellungen: ADM-51 my staff account (every staff member; also in the staff menu). */
export default defineModule({
    key: 'account',
    nav: [{ group: 'settings', items: [{ route: 'admin.account', match: 'admin.account', label: 'account.title', icon: PhUserCircle, order: 1, testId: 'account', keywords: ['konto', 'account', 'passwort', 'zwei-faktor', '2fa', 'sitzungen'] }] }],
});
