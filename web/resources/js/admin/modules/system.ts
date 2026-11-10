import { PhHeartbeat, PhPlugs, PhQueue } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** System (ADM-48…50, M3.6): health, jobs, integrations. Dashboard queues: failed jobs, the scheduler heartbeat and the queue backlog. */
export default defineModule({
    key: 'system',
    nav: [
        {
            group: 'system',
            items: [
                { route: 'admin.system.health', match: 'admin.system.health', label: 'system.nav.health', icon: PhHeartbeat, atom: 'system.view', order: 1, testId: 'system-health', keywords: ['health', 'zustand', 'status', 'prüfung'] },
                { route: 'admin.system.jobs', match: 'admin.system.jobs', label: 'system.nav.jobs', icon: PhQueue, atom: 'system.view', order: 2, testId: 'system-jobs', keywords: ['jobs', 'queue', 'warteschlange', 'failed'] },
                { route: 'admin.system.integrations', match: 'admin.system.integrations', label: 'system.nav.integrations', icon: PhPlugs, atom: 'integrations.view', order: 3, testId: 'system-integrations', keywords: ['integrationen', 'mail', 'pusher', 'push', 'ki', 'ai'] },
            ],
        },
    ],
    queues: [
        { key: 'failed_jobs', label: 'dashboard.queues.failed_jobs', empty: 'dashboard.queues.failed_jobs_empty', atom: 'system.view', route: 'admin.system.jobs', order: 50, testId: 'failed-jobs' },
        { key: 'scheduler', label: 'dashboard.queues.scheduler', empty: 'dashboard.queues.scheduler_empty', atom: 'system.view', route: 'admin.system.health', order: 60, testId: 'scheduler' },
        { key: 'queue', label: 'dashboard.queues.queue', empty: 'dashboard.queues.queue_empty', atom: 'system.view', route: 'admin.system.jobs', order: 70, testId: 'queue' },
    ],
});
