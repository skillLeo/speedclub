import type { AppConfig } from '@/api/queries/appConfig';
import { customWordmark, pickHeroVariant, welcomeHero } from '@/features/auth/brand';

const FALLBACK = { x: 0.5, y: 0.4 };
const HERO = {
  url: 'https://speedclub.test/brand/hero.jpg',
  variants: [
    { width: 640, url: 'https://speedclub.test/brand/hero-640.webp' },
    { width: 1280, url: 'https://speedclub.test/brand/hero-1280.webp' },
    { width: 2048, url: 'https://speedclub.test/brand/hero-2048.webp' },
  ],
  width: 4000,
  height: 3000,
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  focal_x: 0.3,
  focal_y: 0.7,
};

function branding(overrides: Partial<AppConfig['branding']>): AppConfig['branding'] {
  return { logo: null, splash_image: null, welcome_hero: null, accent_set: 'signalRed', default_theme: 'system', ...overrides };
}

describe('FS-1 brand pickup (ADM-28, BL-4)', () => {
  it('takes the smallest variant that covers the screen, else the largest', () => {
    expect(pickHeroVariant(HERO, 1170)).toBe('https://speedclub.test/brand/hero-1280.webp');
    expect(pickHeroVariant(HERO, 3000)).toBe('https://speedclub.test/brand/hero-2048.webp');
    expect(pickHeroVariant({ ...HERO, variants: [] }, 640)).toBe(HERO.url);
  });

  it('crops around the published focal point with its blurhash', () => {
    expect(welcomeHero(branding({ heroes: { welcome: HERO, landing: null, splash: null } }), 640, FALLBACK)).toEqual({
      uri: 'https://speedclub.test/brand/hero-640.webp',
      blurhash: HERO.blurhash,
      focal: { x: 0.3, y: 0.7 },
    });
  });

  it('keeps the bundled photo when nothing is published, and reads the plain URL of an older server', () => {
    expect(welcomeHero(branding({}), 640, FALLBACK)).toBeNull();
    expect(welcomeHero(branding({ welcome_hero: 'https://speedclub.test/old.jpg' }), 640, FALLBACK)).toEqual({
      uri: 'https://speedclub.test/old.jpg',
      blurhash: null,
      focal: FALLBACK,
    });
  });
});

describe('published wordmark (ADM-28 logo_sizes)', () => {
  const ORIGIN = 'https://speedclub.test';
  const sizes = (width: number, height: number) => ({
    wordmark_white: { width, height },
    wordmark_black: { width, height },
    square: null,
    app_mark: null,
  });
  const logos = (white: string | null) => ({ wordmark_white: white, wordmark_black: '/brand/logo-wide-black-640.webp', square: null, app_mark: null });

  it('takes a custom wordmark with the ratio of its intrinsic size, on the API origin', () => {
    expect(customWordmark(branding({ logos: logos('/storage/brand/01abc-640.webp'), logo_sizes: sizes(800, 200) }), 'white', ORIGIN)).toEqual({
      uri: 'https://speedclub.test/storage/brand/01abc-640.webp',
      ratio: 4,
    });
    expect(customWordmark(branding({ logos: logos('https://cdn.example/w.webp'), logo_sizes: sizes(600, 300) }), 'white', ORIGIN)?.ratio).toBe(2);
  });

  it('keeps the bundled file for the server\'s bundled copy, without a size or without a loadable address', () => {
    expect(customWordmark(branding({ logos: logos('/storage/brand/01abc-640.webp'), logo_sizes: sizes(800, 200) }), 'black', ORIGIN)).toBeNull();
    expect(customWordmark(branding({ logos: logos('/storage/brand/01abc-640.webp') }), 'white', ORIGIN)).toBeNull();
    expect(customWordmark(branding({ logos: logos('/storage/brand/01abc-640.webp'), logo_sizes: sizes(800, 200) }), 'white', '')).toBeNull();
    expect(customWordmark(branding({ logos: logos('javascript:alert(1)'), logo_sizes: sizes(800, 200) }), 'white', ORIGIN)).toBeNull();
    expect(customWordmark(branding({ logos: logos('//evil.example/w.webp'), logo_sizes: sizes(800, 200) }), 'white', ORIGIN)).toBeNull();
    expect(customWordmark(branding({}), 'white', ORIGIN)).toBeNull();
  });
});
