import { getActiveLanguage } from 'laravel-vue-i18n';
import { routeOr } from '../../lib/routes';

/**
 * ADM-66 Shop-Produkte and ADM-67 Shop-Banner (10 §3, m5.5-contract §5): the prop shapes of App\Http\Controllers\Admin\Shop\* and the
 * URLs of the `admin.shop.*` routes.
 */
export type ShopCategory = 'sticker' | 'apparel' | 'accessories';
export type PurchaseMode = 'shopify' | 'sticker_designer';
export type BuyState = 'designer' | 'external' | 'not_configured';
export type MissingItem = 'image' | 'shopify_url';

export interface Option {
    value: string;
    label: string;
}

export interface StoreInfo {
    configured: boolean;
    host: string | null;
    extra_hosts: string[];
    driver: string;
    storefront: 'configured' | 'not_configured';
}

export interface ProductRow {
    id: string;
    slug: string;
    title: string;
    category: ShopCategory;
    price_cents: number;
    price: string;
    visible: boolean;
    is_sample: boolean;
    purchase_mode: PurchaseMode;
    buy_state: BuyState;
    image: { url: string; blurhash: string | null } | null;
    images_count: number;
    variants_count: number;
    sort: number;
    deleted_at: string | null;
    updated_at: string | null;
    updated_by: string | null;
}

export interface Variant {
    id: string | null;
    label: string;
    shopify_variant_id: string | null;
}

export interface ProductImage {
    id: string;
    sort: number;
    alt: string | null;
    width: number;
    height: number;
    focal_x: number;
    focal_y: number;
    blurhash: string | null;
    url: string;
    original_width: number | null;
    original_height: number | null;
}

export interface ProductRecord {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    category: ShopCategory;
    price_cents: number;
    currency: 'EUR';
    variant_kind: string;
    variants: Variant[];
    purchase_mode: PurchaseMode;
    shopify_url: string | null;
    visible: boolean;
    is_sample: boolean;
    sort: number;
    deleted_at: string | null;
    purge_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    images: ProductImage[];
    missing: MissingItem[];
}

/** ShopImage of the member API (contract §3.4). */
export interface MemberImage {
    id: string;
    width: number;
    height: number;
    aspect: string;
    blurhash: string | null;
    focal_x: number;
    focal_y: number;
    alt: string | null;
    variants: { width: number; height: number; url: string }[];
}

export interface MemberBuy {
    available: boolean;
    kind: 'external' | 'designer' | null;
    url: string | null;
    path: string | null;
    reason: string | null;
    message: string | null;
}

export interface MemberCard {
    id: string;
    slug: string;
    title: string;
    category: { key: string; label: string };
    price: { amount_cents: number; currency: string; formatted: string; vat_included: boolean };
    image: MemberImage | null;
    purchase_mode: PurchaseMode;
    is_sample: boolean;
}

export interface MemberDetail extends MemberCard {
    description: string | null;
    images: MemberImage[];
    variant_kind: { key: string; label: string };
    variants: { id: string; label: string; buy: MemberBuy }[];
    buy: MemberBuy;
    store: { configured: boolean; host: string | null; shipping_url: string | null };
}

export interface Preview {
    card: MemberCard;
    detail: MemberDetail;
}

export interface Limits {
    max_images: number;
    max_variants: number;
    title_max: number;
    description_max: number;
    min_crop: { width: number; height: number };
    max_upload_kb: number;
}

export interface BannerRow {
    id: string;
    title: string;
    subtitle: string | null;
    active: boolean;
    is_sample: boolean;
    link: { kind: 'product' | 'category'; category: ShopCategory | null; product: { id: string; title: string; visible: boolean } | null };
    link_ok: boolean;
    image: { url: string | null; width: number; height: number; focal_x: number; focal_y: number; blurhash: string | null; alt: string | null };
    updated_at: string | null;
    updated_by: string | null;
}

// ---- routes -----------------------------------------------------------------------------------------------------------------
const P = '/admin/shop/products';
export const productsIndexHref = (): string => routeOr('admin.shop.products.index', P);
export const productCreateHref = (): string => routeOr('admin.shop.products.create', `${P}/new`);
export const productStoreUrl = (): string => routeOr('admin.shop.products.store', P);
export const productReorderUrl = (): string => routeOr('admin.shop.products.reorder', `${P}/reorder`);
export const productHref = (id: string): string => routeOr('admin.shop.products.edit', `${P}/${id}`, { product: id });
export const productUrl = (name: 'update' | 'destroy', id: string): string => routeOr(`admin.shop.products.${name}`, `${P}/${id}`, { product: id });
export const productActionUrl = (name: 'visibility' | 'restore', id: string): string => routeOr(`admin.shop.products.${name}`, `${P}/${id}/${name}`, { product: id });
export const imagesStoreUrl = (product: string): string => routeOr('admin.shop.products.images.store', `${P}/${product}/images`, { product });
export const imagesReorderUrl = (product: string): string => routeOr('admin.shop.products.images.reorder', `${P}/${product}/images/reorder`, { product });
export const imageUrl = (name: 'update' | 'destroy', product: string, image: string): string =>
    routeOr(`admin.shop.products.images.${name}`, `${P}/${product}/images/${image}`, { product, image });

const B = '/admin/shop/banners';
export const bannersIndexHref = (): string => routeOr('admin.shop.banners.index', B);
export const bannerStoreUrl = (): string => routeOr('admin.shop.banners.store', B);
export const bannerUrl = (name: 'update' | 'destroy', id: string): string => routeOr(`admin.shop.banners.${name}`, `${B}/${id}`, { banner: id });
export const bannerActionUrl = (name: 'activate' | 'deactivate', id: string): string => routeOr(`admin.shop.banners.${name}`, `${B}/${id}/${name}`, { banner: id });

// ---- prices (gross cents incl. MwSt., EUR only) ------------------------------------------------------------------------------
const decimal = (): ',' | '.' => (getActiveLanguage() === 'en' ? '.' : ',');

/** 1490 → "14,90" (de) / "14.90" (en): the editable amount, without the currency sign. */
export function centsToInput(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '';
    const euros = Math.floor(cents / 100);
    const rest = String(cents % 100).padStart(2, '0');
    return `${euros}${decimal()}${rest}`;
}

/**
 * "14,90", "14.90", "14", "1.490,00" (de thousands) → 1490; null for anything else. Up to two decimals; the last `,` or `.` followed
 * by one or two digits is the decimal separator, every other separator is a thousands mark.
 */
export function inputToCents(value: string): number | null {
    const text = value.replace(/\s| |€/g, '');
    if (text === '') return null;
    const match = /^(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(text);
    if (match === null) return null;
    const whole = Number.parseInt(match[1]!.replace(/[.,]/g, ''), 10);
    const fraction = match[2] === undefined ? 0 : Number.parseInt(match[2].padEnd(2, '0'), 10);
    const cents = whole * 100 + fraction;
    return Number.isSafeInteger(cents) ? cents : null;
}

/** 1490 → "14,90 €" (de, no-break space) / "€14.90" (en), as ShopPrice formats it on the server. */
export function formatPrice(cents: number): string {
    const amount = centsToInput(cents);
    return getActiveLanguage() === 'en' ? `€${amount}` : `${amount} €`;
}

// ---- photos -----------------------------------------------------------------------------------------------------------------
/** The member variant closest to `width` (or the largest), for an <img> in the preview. */
export function variantSrc(image: MemberImage | null | undefined, width: number): string | null {
    if (!image || image.variants.length === 0) return null;
    const sorted = [...image.variants].sort((a, b) => a.width - b.width);
    return (sorted.find((v) => v.width >= width) ?? sorted[sorted.length - 1])!.url;
}

export function srcset(image: MemberImage | null | undefined): string | undefined {
    if (!image || image.variants.length === 0) return undefined;
    return image.variants.map((v) => `${v.url} ${v.width}w`).join(', ');
}

/**
 * Where the 4:5 crop sits inside the uncropped original for a focal point (as ShopImages crops on the server: the largest 4:5 box,
 * centred on the point, kept inside the photo). Percentages of the original's width/height.
 */
export function cropWindow(width: number, height: number, focalX: number, focalY: number): { left: number; top: number; width: number; height: number; full: boolean } {
    const ratio = 4 / 5;
    let cropWidth = width;
    let cropHeight = height;
    if (width / height > ratio) cropWidth = height * ratio;
    else cropHeight = width / ratio;
    const left = Math.min(Math.max(focalX * width - cropWidth / 2, 0), width - cropWidth);
    const top = Math.min(Math.max(focalY * height - cropHeight / 2, 0), height - cropHeight);
    const full = Math.abs(cropWidth - width) < 1 && Math.abs(cropHeight - height) < 1;
    return { left: (left / width) * 100, top: (top / height) * 100, width: (cropWidth / width) * 100, height: (cropHeight / height) * 100, full };
}

export function clampUnit(value: number): number {
    return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** Arrow-key step for a focal point (2 %, Shift 10 %), or null for other keys. */
export function focalStep(event: KeyboardEvent): [number, number] | null {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    return moves[event.key] ?? null;
}

/** A local image file's pixel size (before upload, to say "too small" without a round trip). Null when the browser cannot read it. */
export function imageSize(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            resolve(null);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    });
}

export const ACCEPT = 'image/jpeg,image/png,image/webp';

/** First message of an Inertia error bag. */
export function firstMessage(errors: Record<string, string>): string | null {
    return Object.values(errors)[0] ?? null;
}
