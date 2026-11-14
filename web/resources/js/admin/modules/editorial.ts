import { PhImages } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Editorial & Beispiele (ADM-58, M4.17): sample content per environment and per item (09 §8.19, §10.1 Plattform). */
export default defineModule({
    key: 'editorial',
    nav: [
        {
            group: 'brand_content',
            items: [
                {
                    route: 'admin.editorial.index',
                    match: 'admin.editorial.*',
                    label: 'editorial.nav.title',
                    icon: PhImages,
                    atom: 'content.view',
                    order: 2.5,
                    testId: 'editorial',
                    keywords: ['beispiele', 'samples', 'editorial', 'showcase', 'beispiel-builds'],
                },
            ],
        },
    ],
});
