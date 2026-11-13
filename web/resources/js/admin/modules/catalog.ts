import { PhCarProfile, PhFileArrowUp, PhListChecks, PhPackage, PhTag } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Katalog: ADM-14 Fahrzeugkatalog (+ Anfragen), ADM-15 Mod-Kategorien, ADM-16 Teilemarken, ADM-57 Teile & Produkte (M4.14/M4.17), ADM-17 CSV-Import (M3.3). */
export default defineModule({
    key: 'catalog',
    nav: [
        {
            group: 'catalog',
            items: [
                {
                    route: 'admin.catalog.vehicles.makes',
                    match: 'admin.catalog.vehicles.*',
                    label: 'catalog.nav.vehicles',
                    icon: PhCarProfile,
                    atom: 'catalog.view',
                    order: 1,
                    testId: 'catalog-vehicles',
                    keywords: ['marken', 'modelle', 'generationen', 'makes', 'models', 'anfragen', 'requests'],
                },
                { route: 'admin.catalog.categories', match: 'admin.catalog.categories*', label: 'catalog.nav.categories', icon: PhListChecks, atom: 'catalog.view', order: 2, testId: 'catalog-categories', keywords: ['felder', 'fields', 'schema', 'modifikationen'] },
                { route: 'admin.catalog.brands', match: 'admin.catalog.brands', label: 'catalog.nav.brands', icon: PhTag, atom: 'catalog.view', order: 3, testId: 'catalog-brands', keywords: ['teilemarken', 'brands', 'aliase', 'hersteller'] },
                { route: 'admin.catalog.products.index', match: 'admin.catalog.products.*', label: 'catalog.nav.products', icon: PhPackage, atom: 'catalog.view', order: 4, testId: 'catalog-products', keywords: ['teile', 'produkte', 'parts', 'products', 'fahrwerk', 'felgen', 'affiliate'] },
                { route: 'admin.catalog.import', match: 'admin.catalog.import*', label: 'catalog.nav.import', icon: PhFileArrowUp, atom: 'catalog.import', order: 5, testId: 'catalog-import', keywords: ['csv', 'import', 'upload'] },
            ],
        },
    ],
    palette: [
        { key: 'catalog-requests', label: 'catalog.palette.requests', route: 'admin.catalog.vehicles.requests', atom: 'catalog.view', keywords: ['anfragen', 'nicht gefunden', 'requests'] },
        { key: 'catalog-normalise', label: 'catalog.palette.normalise', route: 'admin.catalog.brands', params: { normalise: '1' }, atom: 'catalog.manage', keywords: ['normalisieren', 'duplikate', 'normalise'] },
    ],
});
