/**
 * Brand pickup (M3.5 ADM-28, BL-4): the hero photos of app-config with their focal point. The server already refused a photo whose
 * scrim area fails 4.5:1 with the logo and the text (ADR-129/151/152, ADR-236 b), so the app only picks the variant and crops around
 * the focal point. Unset or unreadable: null, and the bundled photo stays.
 */
import type { AppConfig, BrandHero } from '@/api/queries/appConfig';
import type { CustomWordmark } from '@/ui';

export type HeroPick = { uri: string; blurhash: string | null; focal: { x: number; y: number } };

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);

/** The smallest variant at least `pixels` wide (variants come smallest first), else the largest, else the original. */
export function pickHeroVariant(hero: BrandHero, pixels: number): string | null {
  const variants = [...hero.variants].filter((variant) => variant.url).sort((a, b) => a.width - b.width);
  const fit = variants.find((variant) => variant.width >= pixels) ?? variants.at(-1);
  return fit?.url ?? hero.url ?? null;
}

/**
 * FS-1's photo: `heroes.welcome` with variants and focal point, else the plain `welcome_hero` URL of older servers (centred as the
 * bundled photo), else null.
 */
export function welcomeHero(branding: AppConfig['branding'], pixels: number, fallbackFocal: { x: number; y: number }): HeroPick | null {
  const hero = branding.heroes?.welcome ?? null;
  if (hero) {
    const uri = pickHeroVariant(hero, pixels);
    if (uri) return { uri, blurhash: hero.blurhash, focal: { x: clamp(hero.focal_x), y: clamp(hero.focal_y) } };
  }
  return branding.welcome_hero ? { uri: branding.welcome_hero, blurhash: null, focal: fallbackFocal } : null;
}

/** The server's addresses of the bundled wordmarks (AppConfig::BUNDLED_WORDMARKS): the app draws its own files for those. */
const BUNDLED_WORDMARK = /^(https?:\/\/[^/]+)?\/brand\/logo-wide-(white|black)-\d+\.webp$/;

/** An address the app can load: absolute http(s), or a root path on the API's origin. */
function loadable(uri: string, origin: string): string | null {
  if (/^https?:\/\//i.test(uri)) return uri;
  return uri.startsWith('/') && !uri.startsWith('//') && origin ? `${origin}${uri}` : null;
}

/**
 * M3.5 ADM-28: the published wide wordmark of one tone with its aspect ratio from `logo_sizes`, so it is drawn without distortion.
 * Null keeps the bundled file: nothing published (the server then names its bundled copy), no usable size, or no loadable address.
 */
export function customWordmark(branding: AppConfig['branding'], tone: 'white' | 'black', origin: string): CustomWordmark | null {
  const uri = branding.logos?.[`wordmark_${tone}`] ?? null;
  const size = branding.logo_sizes?.[`wordmark_${tone}`] ?? null;
  if (!uri || !size || BUNDLED_WORDMARK.test(uri)) return null;
  const ratio = size.width / size.height;
  const address = loadable(uri, origin);
  return address && Number.isFinite(ratio) && ratio > 0 ? { uri: address, ratio } : null;
}
