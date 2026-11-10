import { PhPaintBrush } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Marke & Inhalte: ADM-28 Marke & Theme (M3.5). */
export default defineModule({
    key: 'brand',
    nav: [
        {
            group: 'brand_content',
            items: [
                { route: 'admin.brand.index', match: 'admin.brand.*', label: 'brand.nav.title', icon: PhPaintBrush, atom: 'brand.manage', order: 1, testId: 'brand', keywords: ['logo', 'theme', 'akzent', 'accent', 'startbild', 'hero', 'og'] },
            ],
        },
    ],
});
