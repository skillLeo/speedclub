/** Shapes of ADM-28 (App\Http\Controllers\Admin\Brand\BrandController, App\Services\Config\Schemas\BrandingSchema). */
export const LOGO_SLOTS = ['wordmark_white', 'wordmark_black', 'square', 'app_mark'] as const;
export const HERO_SLOTS = ['welcome', 'landing', 'splash'] as const;

export type LogoSlot = (typeof LOGO_SLOTS)[number];
export type HeroSlotKey = (typeof HERO_SLOTS)[number];
export type AssetKind = LogoSlot | 'hero' | 'og';

export interface HeroValue {
    asset_id: string;
    focal_x: number;
    focal_y: number;
}

export interface Branding {
    logos: Record<LogoSlot, string | null>;
    heroes: Record<HeroSlotKey, HeroValue | null>;
    og_default: string | null;
    accent_set: string;
    default_theme: string;
}

export interface BrandAsset {
    id: string;
    kind: AssetKind;
    url: string | null;
    thumb: string | null;
    width: number;
    height: number;
    bytes: number;
    uploaded_at: string | null;
    uploaded_by: string | null;
}

export interface Contrast {
    passes: boolean;
    logo_ratio: number;
    text_ratio: number;
    frame: string;
    minimum: number;
}

/** The slot an asset of a kind goes into. */
export function kindOf(slot: LogoSlot | HeroSlotKey | 'og'): AssetKind {
    if (slot === 'og') return 'og';
    return (HERO_SLOTS as readonly string[]).includes(slot) ? 'hero' : (slot as LogoSlot);
}

/** "5,2:1" / "5.2:1". */
export function ratioText(value: number, locale: string): string {
    return `${new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}:1`;
}
