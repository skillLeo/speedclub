import { PhChatsCircle, PhFlag, PhNotepad, PhSlidersHorizontal } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * Moderation, DSA (ADM-20…24, M3.4): the queue, message safety (moderation.messages), rules (moderation.rules) and the statement-of-reasons
 * templates; the dashboard queues of M3.1 now link here.
 */
export default defineModule({
    key: 'moderation',
    nav: [
        {
            group: 'moderation',
            items: [
                { route: 'admin.moderation.reports', match: 'admin.moderation.(reports|cases.*)', label: 'moderation.nav.reports', icon: PhFlag, atom: 'moderation.view', order: 1, testId: 'moderation-reports', keywords: ['meldungen', 'reports', 'dsa', 'fälle', 'einsprüche', 'appeals'] },
                { route: 'admin.moderation.messages', match: 'admin.moderation.messages', label: 'moderation.nav.messages', icon: PhChatsCircle, atom: 'moderation.messages', order: 2, testId: 'moderation-messages', keywords: ['nachrichten', 'messages', 'chat'] },
                { route: 'admin.moderation.rules', match: 'admin.moderation.rules', label: 'moderation.nav.rules', icon: PhSlidersHorizontal, atom: 'moderation.rules', order: 3, testId: 'moderation-rules', keywords: ['schlagwörter', 'keywords', 'limits', 'rate limit'] },
                { route: 'admin.moderation.templates', match: 'admin.moderation.templates', label: 'moderation.nav.templates', icon: PhNotepad, atom: 'moderation.view', order: 4, testId: 'moderation-templates', keywords: ['vorlagen', 'templates', 'begründung', 'statement of reasons'] },
            ],
        },
    ],
    palette: [
        { key: 'moderation-appeals', label: 'moderation.reports.tabs.appeals', route: 'admin.moderation.reports', params: { tab: 'appeals' }, atom: 'moderation.view', keywords: ['einspruch', 'appeal'] },
        { key: 'moderation-mine', label: 'moderation.reports.tabs.in_review', route: 'admin.moderation.reports', params: { tab: 'in_review', 'filter[assigned]': 'me' }, atom: 'moderation.view', keywords: ['meine fälle', 'my cases'] },
    ],
    queues: [
        { key: 'reports', label: 'dashboard.queues.reports', empty: 'dashboard.queues.reports_empty', atom: 'moderation.view', route: 'admin.moderation.reports', order: 10, testId: 'reports' },
        { key: 'appeals', label: 'dashboard.queues.appeals', empty: 'dashboard.queues.appeals_empty', atom: 'moderation.appeals', route: 'admin.moderation.reports', params: { tab: 'appeals' }, order: 20, testId: 'appeals' },
    ],
});
