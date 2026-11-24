import { PhChatsTeardrop, PhTreeStructure } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/**
 * Forum (M5.8, 10 §7.3, m5.8-contract §6): ADM-68 Forum-Moderation, the SplitQueue of the forum (Vormoderation · Gemeldet · Themen ·
 * Entfernt) next to the Meldungen-Queue, and ADM-69 Forum-Kategorien (moderation.rules). Both entries show only once their route is
 * registered (Ziggy) and the staff member holds the atom.
 */
export default defineModule({
    key: 'forum',
    nav: [
        {
            group: 'moderation',
            items: [
                {
                    route: 'admin.forum.queue',
                    match: 'admin.forum.queue',
                    label: 'forum.nav.queue',
                    icon: PhChatsTeardrop,
                    atom: 'moderation.view',
                    order: 1.5,
                    testId: 'forum',
                    keywords: ['forum', 'themen', 'threads', 'vormoderation', 'pre-moderation', 'beiträge', 'posts', 'antworten'],
                },
                {
                    route: 'admin.forum.categories.index',
                    match: 'admin.forum.categories.*',
                    label: 'forum.nav.categories',
                    icon: PhTreeStructure,
                    atom: 'moderation.rules',
                    order: 3.5,
                    testId: 'forum-categories',
                    keywords: ['forum', 'kategorien', 'categories', 'marken', 'bundesländer', 'regionen'],
                },
            ],
        },
    ],
    palette: [
        { key: 'forum-threads', label: 'forum.palette.threads', route: 'admin.forum.queue', params: { tab: 'threads' }, atom: 'moderation.view', keywords: ['forum themen', 'forum threads'] },
        { key: 'forum-reported', label: 'forum.palette.reported', route: 'admin.forum.queue', params: { tab: 'reported' }, atom: 'moderation.view', keywords: ['gemeldete beiträge', 'reported posts'] },
    ],
    queues: [
        { key: 'forum_pending', label: 'forum.queue_tile.label', empty: 'forum.queue_tile.empty', atom: 'moderation.view', route: 'admin.forum.queue', order: 13, testId: 'forum-pending' },
    ],
});
