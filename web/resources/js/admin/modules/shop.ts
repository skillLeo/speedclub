import { PhFlagBanner, PhShoppingBag } from '@phosphor-icons/vue';
import { defineModule } from './registry';

/** Shop (M5.5, m5.5-contract §5): ADM-66 Shop-Produkte and ADM-67 Shop-Banner under Marke & Inhalte; shop.manage reads and writes. */
export default defineModule({
    key: 'shop',
    nav: [
        {
            group: 'brand_content',
            items: [
                {
                    route: 'admin.shop.products.index',
                    match: 'admin.shop.products.*',
                    label: 'shop.nav.products',
                    icon: PhShoppingBag,
                    atom: 'shop.manage',
                    order: 9,
                    testId: 'shop-products',
                    keywords: ['shop', 'produkte', 'products', 'sticker', 'bekleidung', 'accessoires', 'preis', 'shopify'],
                },
                {
                    route: 'admin.shop.banners.index',
                    match: 'admin.shop.banners.*',
                    label: 'shop.nav.banners',
                    icon: PhFlagBanner,
                    atom: 'shop.manage',
                    order: 9.1,
                    testId: 'shop-banners',
                    keywords: ['shop', 'banner', 'hero', 'startbild'],
                },
            ],
        },
    ],
    palette: [
        { key: 'shop-product-new', label: 'shop.palette.new_product', route: 'admin.shop.products.create', atom: 'shop.manage', icon: PhShoppingBag, keywords: ['neues produkt', 'new product', 'shop'] },
        { key: 'shop-products-hidden', label: 'shop.palette.hidden', route: 'admin.shop.products.index', params: { 'filter[visible]': '0' }, atom: 'shop.manage', icon: PhShoppingBag, keywords: ['ausgeblendet', 'hidden', 'shop'] },
    ],
});
