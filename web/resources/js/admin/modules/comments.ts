import { PhChatCircleText } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Kommentare (ADM-60, M4.17): the comment overview under Trust & Safety (09 §10.1, flag `build_comments`). */
export default defineModule({
    key: 'comments',
    nav: [
        {
            group: 'moderation',
            items: [
                {
                    route: 'admin.comments.index',
                    match: 'admin.comments.*',
                    label: 'comments.nav.title',
                    icon: PhChatCircleText,
                    atom: 'moderation.view',
                    order: 6,
                    testId: 'comments',
                    keywords: ['kommentare', 'comments', 'build-updates', 'antworten'],
                },
            ],
        },
    ],
});
