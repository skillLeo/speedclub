import { PhCalendarStar, PhMedal } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Gift admin (M5.9d): ADM-63 Abzeichen and ADM-64 Car of the Day under Marke & Inhalte; content.view reads, content.edit writes (ADR-513). */
export default defineModule({
    key: 'gift',
    nav: [
        {
            group: 'brand_content',
            items: [
                {
                    route: 'admin.car-of-the-day.index',
                    match: 'admin.car-of-the-day.*',
                    label: 'gift.cotd.nav.title',
                    icon: PhCalendarStar,
                    atom: 'content.view',
                    order: 2.2,
                    testId: 'car-of-the-day',
                    keywords: ['car of the day', 'auto des tages', 'startseite', 'home', 'aussetzen', 'skip'],
                },
                {
                    route: 'admin.badges.index',
                    match: 'admin.badges.*',
                    label: 'gift.badges.nav.title',
                    icon: PhMedal,
                    atom: 'content.view',
                    order: 2.3,
                    testId: 'badges',
                    keywords: ['abzeichen', 'badges', 'regeln', 'rules', 'xp'],
                },
            ],
        },
    ],
});
