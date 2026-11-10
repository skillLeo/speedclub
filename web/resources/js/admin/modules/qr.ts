import { PhQrCode } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** QR (ADM-18/19, M3.2): registry and detail. */
export default defineModule({
    key: 'qr',
    nav: [
        {
            group: 'qr',
            items: [{ route: 'admin.qr.index', match: 'admin.qr.*', label: 'qr.nav.title', icon: PhQrCode, atom: 'qr.view', order: 1, testId: 'qr', keywords: ['qr', 'sticker', 'codes', 'scans'] }],
        },
    ],
});
