import { PhCar } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Fahrzeuge & Medien: ADM-11/12 vehicles (M3.2). The media review queue is modules/media.ts. */
export default defineModule({
    key: 'vehicles',
    nav: [
        {
            group: 'vehicles_media',
            items: [{ route: 'admin.vehicles.index', match: 'admin.vehicles.*', label: 'vehicles.nav.title', icon: PhCar, atom: 'vehicles.view', order: 1, testId: 'vehicles', keywords: ['fahrzeuge', 'vehicles', 'autos', 'garage'] }],
        },
    ],
    palette: [
        { key: 'vehicles-hidden', label: 'vehicles.presets.hidden', route: 'admin.vehicles.index', params: { 'filter[moderation]': 'hidden' }, atom: 'vehicles.view', keywords: ['ausgeblendet', 'hidden'] },
    ],
});
