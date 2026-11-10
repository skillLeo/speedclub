import { PhClockCountdown, PhShieldCheck } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Audit & Datenschutz (ADM-45…47, M3.6): GDPR requests and retention. Dashboard queue: GDPR requests due within 7 days → ADM-45. */
export default defineModule({
    key: 'privacy',
    nav: [
        {
            group: 'audit_privacy',
            items: [
                { route: 'admin.privacy.requests', match: 'admin.privacy.requests*', label: 'privacy.nav.requests', icon: PhShieldCheck, atom: 'privacy.view', order: 2, testId: 'privacy-requests', keywords: ['dsgvo', 'gdpr', 'auskunft', 'löschung', 'datenschutz'] },
                { route: 'admin.privacy.retention', match: 'admin.privacy.retention', label: 'privacy.nav.retention', icon: PhClockCountdown, atom: 'privacy.view', order: 3, testId: 'privacy-retention', keywords: ['aufbewahrung', 'retention', 'fristen', 'löschfristen'] },
            ],
        },
    ],
    palette: [{ key: 'privacy-overdue', label: 'privacy.requests.presets.overdue', route: 'admin.privacy.requests', params: { 'filter[due]': 'overdue' }, atom: 'privacy.view', keywords: ['überfällig', 'overdue', 'dsgvo'] }],
    queues: [{ key: 'privacy_due', label: 'dashboard.queues.privacy_due', empty: 'dashboard.queues.privacy_due_empty', atom: 'privacy.view', route: 'admin.privacy.requests', params: { 'filter[due]': 'soon' }, order: 30, testId: 'privacy-due' }],
});
