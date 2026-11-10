import { PhCloudArrowDown, PhPackage, PhToggleRight } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Konfiguration: ADM-36 Feature-Flags, ADM-37 Remote-Konfiguration, ADM-38 Release-Register (M3.5). */
export default defineModule({
    key: 'config',
    nav: [
        {
            group: 'configuration',
            items: [
                { route: 'admin.config.flags', match: 'admin.config.flags*', label: 'config.nav.flags', icon: PhToggleRight, atom: 'flags.manage', order: 1, testId: 'config-flags', keywords: ['flags', 'schalter', 'rollout'] },
                { route: 'admin.config.remote', match: 'admin.config.remote*', label: 'config.nav.remote', icon: PhCloudArrowDown, atom: 'remote_config.manage', order: 2, testId: 'config-remote', keywords: ['wartung', 'maintenance', 'force update', 'mindestversion'] },
                { route: 'admin.config.releases', match: 'admin.config.releases*', label: 'config.nav.releases', icon: PhPackage, atom: 'releases.manage', order: 3, testId: 'config-releases', keywords: ['apk', 'builds', 'releases', 'sha'] },
            ],
        },
    ],
});
