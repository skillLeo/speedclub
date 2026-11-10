import { PhBell, PhGauge, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Overview (ADM-06…08). */
export default defineModule({
    key: 'overview',
    nav: [
        {
            group: 'overview',
            items: [
                { route: 'admin.dashboard', label: 'shell.nav.dashboard', icon: PhGauge, order: 1, testId: 'dashboard', keywords: ['dashboard', 'übersicht', 'start'] },
                { route: 'admin.search', label: 'shell.nav.search', icon: PhMagnifyingGlass, order: 2, testId: 'search', keywords: ['suche', 'search', 'finden'] },
                { route: 'admin.alerts', label: 'shell.nav.alerts', icon: PhBell, order: 3, badge: 'alerts', testId: 'alerts', keywords: ['hinweise', 'alerts', 'freigaben'] },
            ],
        },
    ],
});
