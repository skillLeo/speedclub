import { PhBuildings } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Einstellungen: ADM-52 org settings (staff.manage reads, an Owner changes). */
export default defineModule({
    key: 'settings',
    nav: [{ group: 'settings', items: [{ route: 'admin.settings', match: 'admin.settings', label: 'settings.title', icon: PhBuildings, atom: 'staff.manage', order: 2, testId: 'settings', keywords: ['organisation', 'impressum', 'firma', 'company', 'einstellungen'] }] }],
});
