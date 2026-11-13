import { PhCalendarCheck, PhCalendarDots } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * Treffen (ADM-53/54, M4.12 backend, M4.17 pages): the pre-moderation queue and the event record. 09 §10.1 puts Treffen in the
 * community group next to Fahrzeuge and Medien; the decisions use the moderation atoms (ADR-437 a).
 */
export default defineModule({
    key: 'events',
    nav: [
        {
            group: 'vehicles_media',
            items: [
                {
                    route: 'admin.events.queue',
                    match: 'admin.events.*',
                    label: 'events.nav.title',
                    icon: PhCalendarDots,
                    atom: 'moderation.view',
                    order: 3,
                    testId: 'events',
                    keywords: ['treffen', 'meets', 'events', 'ausfahrt', 'cruise', 'trackday', 'prüfung', 'review'],
                },
            ],
        },
    ],
    actions: [{ key: 'event-approve', label: 'shell.palette.actions.event_approve', kind: 'event', atom: 'moderation.decide', route: 'admin.events.queue', icon: PhCalendarCheck, keywords: ['freigeben', 'approve', 'treffen', 'meet'] }],
    queues: [
        { key: 'events_review', label: 'dashboard.queues.events_review', empty: 'dashboard.queues.events_review_empty', atom: 'moderation.view', route: 'admin.events.queue', order: 12, testId: 'events-review' },
    ],
    palette: [
        { key: 'events-published', label: 'events.tabs.published', route: 'admin.events.queue', params: { tab: 'published' }, atom: 'moderation.view', keywords: ['veröffentlichte treffen', 'published meets'] },
    ],
});
