import { PhImages } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Fahrzeuge & Medien: ADM-13 media review queue (M3.2). */
export default defineModule({
    key: 'media',
    nav: [
        {
            group: 'vehicles_media',
            items: [{ route: 'admin.media.index', match: 'admin.media.*', label: 'media.nav.title', icon: PhImages, atom: 'media.review', order: 2, testId: 'media', keywords: ['fotos', 'medien', 'media', 'prüfung', 'review'] }],
        },
    ],
    palette: [
        { key: 'media-reported', label: 'media.tabs.reported', route: 'admin.media.index', params: { tab: 'reported' }, atom: 'media.review', keywords: ['gemeldete fotos', 'reported photos'] },
    ],
});
