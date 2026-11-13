import { PhSealCheck, PhStorefront } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * Betriebe (ADM-55/56, M4.14 backend, M4.17 pages): the application SplitQueue and the business record. 09 §10.1 puts Betriebe in the
 * community group after Treffen; the decisions use the moderation atoms (ADR-455, as ADR-437 a for events).
 */
export default defineModule({
    key: 'businesses',
    nav: [
        {
            group: 'vehicles_media',
            items: [
                {
                    route: 'admin.businesses.queue',
                    match: 'admin.businesses.*',
                    label: 'businesses.nav.title',
                    icon: PhStorefront,
                    atom: 'moderation.view',
                    order: 4,
                    testId: 'businesses',
                    keywords: ['betriebe', 'werkstatt', 'tuner', 'businesses', 'anträge', 'applications', 'impressum', 'verifizieren'],
                },
            ],
        },
    ],
    palette: [
        { key: 'businesses-verified', label: 'businesses.tabs.verified', route: 'admin.businesses.queue', params: { tab: 'verified' }, atom: 'moderation.view', keywords: ['verifizierte betriebe', 'verified businesses'] },
    ],
    actions: [{ key: 'business-verify', label: 'shell.palette.actions.business_verify', kind: 'business', atom: 'moderation.decide', route: 'admin.businesses.queue', icon: PhSealCheck, keywords: ['verifizieren', 'verify', 'betrieb', 'business'] }],
    queues: [
        { key: 'business_applications', label: 'dashboard.queues.business_applications', empty: 'dashboard.queues.business_applications_empty', atom: 'moderation.view', route: 'admin.businesses.queue', order: 14, testId: 'business-applications' },
    ],
});
