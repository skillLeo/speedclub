import { PhPrinter } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Sticker-Designs (ADM-65, M5.4, m5.4-contract §8): the design versions and the audited print files, next to the Sticker-Register. */
export default defineModule({
    key: 'stickers',
    nav: [
        {
            group: 'qr',
            items: [
                {
                    route: 'admin.stickers.designs.index',
                    match: 'admin.stickers.designs.*',
                    label: 'stickers.nav.title',
                    icon: PhPrinter,
                    atom: 'stickers.print',
                    order: 2,
                    testId: 'sticker-designs',
                    keywords: ['sticker', 'design', 'druck', 'print', 'pdf', 'svg', 'sd'],
                },
            ],
        },
    ],
    palette: [
        { key: 'sticker-designs-ordered', label: 'stickers.designs.presets.ordered', route: 'admin.stickers.designs.index', params: { 'filter[state]': 'ordered' }, atom: 'stickers.print', icon: PhPrinter, keywords: ['sticker', 'bestellung', 'order'] },
    ],
});
