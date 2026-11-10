import { PhClockCounterClockwise, PhDevices, PhEnvelopeSimple, PhHouseLine, PhLifebuoy, PhMegaphone, PhScales } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Marke & Inhalte: ADM-29 Startseite, ADM-30 Ankündigungen, ADM-31 Rechtstexte, ADM-32 Hilfe, ADM-33 Vorlagen, ADM-34 Vorschau, ADM-35 Versionen (M3.5). */
export default defineModule({
    key: 'content',
    nav: [
        {
            group: 'brand_content',
            items: [
                { route: 'admin.content.home', match: 'admin.content.home*', label: 'content.nav.home', icon: PhHouseLine, atom: 'content.view', order: 2, testId: 'content-home', keywords: ['featured', 'sammlungen', 'collections', 'kuratieren'] },
                { route: 'admin.content.announcements', match: 'admin.content.announcements*', label: 'content.nav.announcements', icon: PhMegaphone, atom: 'content.view', order: 3, testId: 'content-announcements', keywords: ['banner', 'hinweise', 'announcements'] },
                { route: 'admin.content.legal', match: 'admin.content.legal*', label: 'content.nav.legal', icon: PhScales, atom: 'content.view', order: 4, testId: 'content-legal', keywords: ['agb', 'datenschutz', 'impressum', 'terms', 'privacy'] },
                { route: 'admin.content.help', match: 'admin.content.help*', label: 'content.nav.help', icon: PhLifebuoy, atom: 'content.view', order: 5, testId: 'content-help', keywords: ['hilfe', 'faq', 'help'] },
                { route: 'admin.content.templates', match: 'admin.content.templates*', label: 'content.nav.templates', icon: PhEnvelopeSimple, atom: 'content.view', order: 6, testId: 'content-templates', keywords: ['e-mail', 'push', 'vorlagen', 'templates'] },
                { route: 'admin.content.preview', match: 'admin.content.preview', label: 'content.nav.preview', icon: PhDevices, atom: 'content.view', order: 7, testId: 'content-preview', keywords: ['vorschau', 'preview', 'entwurf'] },
                { route: 'admin.content.versions', match: 'admin.content.versions', label: 'content.nav.versions', icon: PhClockCounterClockwise, atom: 'content.view', order: 8, testId: 'content-versions', keywords: ['versionen', 'rollback', 'verlauf', 'history'] },
            ],
        },
    ],
});
