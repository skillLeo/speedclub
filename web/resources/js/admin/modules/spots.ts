import { PhBinoculars } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Spots (ADM-62, M5.9b): STREET DEX spots with abuse signals under Trust & Safety; removal uses the moderation atoms (ADR-437 a). */
export default defineModule({
    key: 'spots',
    nav: [
        {
            group: 'moderation',
            items: [
                {
                    route: 'admin.spots.index',
                    match: 'admin.spots.*',
                    label: 'spots.nav.title',
                    icon: PhBinoculars,
                    atom: 'moderation.view',
                    order: 7,
                    testId: 'spots',
                    keywords: ['spots', 'street dex', 'dex', 'scans', 'serie', 'burst', 'städtesprung', 'city hop'],
                },
            ],
        },
    ],
    palette: [{ key: 'spots-signals', label: 'spots.presets.signals', route: 'admin.spots.index', params: { 'filter[signal]': 'any' }, atom: 'moderation.view', keywords: ['auffälligkeiten', 'signals', 'missbrauch', 'abuse'] }],
});
