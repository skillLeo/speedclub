import { PhCalendarDots } from '@phosphor-icons/vue';
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
    palette: [
        { key: 'events-published', label: 'events.tabs.published', route: 'admin.events.queue', params: { tab: 'published' }, atom: 'moderation.view', keywords: ['veröffentlichte treffen', 'published meets'] },
    ],
});
