import { PhScroll } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Audit & Datenschutz: ADM-44 audit log (M3.1). ADM-45…47 (privacy) bring their own module file. */
export default defineModule({
    key: 'audit',
    nav: [
        {
            group: 'audit_privacy',
            items: [{ route: 'admin.audit.index', match: 'admin.audit.*', label: 'shell.nav.audit', icon: PhScroll, atom: 'audit.view', order: 1, testId: 'audit', keywords: ['audit', 'protokoll', 'log'] }],
        },
    ],
});
