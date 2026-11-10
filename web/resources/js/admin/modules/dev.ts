import { PhSquaresFour } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Component gallery for design QA; its route exists in local and testing only, so the entry is hidden elsewhere. */
export default defineModule({
    key: 'dev',
    nav: [{ group: 'system', items: [{ route: 'admin.dev.gallery', label: 'shell.nav.gallery', icon: PhSquaresFour, order: 99, testId: 'gallery', keywords: ['gallery', 'galerie', 'komponenten'] }] }],
});
