import { PhChartLine } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Insights overview (ADM-70, M5.7, m5.7-contract §9): platform totals of views, scans, recaps and build reminders; content.view reads. */
export default defineModule({
    key: 'insights',
    nav: [
        {
            group: 'overview',
            items: [
                {
                    route: 'admin.insights.overview',
                    match: 'admin.insights.*',
                    label: 'insights.nav.title',
                    icon: PhChartLine,
                    atom: 'content.view',
                    order: 4,
                    testId: 'insights',
                    keywords: ['insights', 'statistik', 'aufrufe', 'views', 'wochenrückblick', 'recap', 'scans'],
                },
            ],
        },
    ],
    palette: [{ key: 'insights-week', label: 'insights.palette.week', route: 'admin.insights.overview', params: { days: '7' }, atom: 'content.view', icon: PhChartLine, keywords: ['insights', 'woche', 'week'] }],
});
