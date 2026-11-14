import type { VehicleMedia } from '@/api/queries/vehicles';
import { completenessLine } from '@/features/garage/model';
import { businessHero, BUSINESS_STAGE } from '@/features/parts/model';
import { PROFILE_STAGE, profileCover } from '@/features/profile/components/ProfileHeader';
import { distinctCover, needsOtherCover } from '@/features/vehicle/distinctCover';
import { provenanceCaption } from '@/features/vehicle/model';
import { estimatedMiniSpecWidths, MINI_SPEC_GAP, miniSpecCellWidth, miniSpecColumns } from '@/ui/specStripLayout';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const media = (id: string) => ({ id }) as unknown as VehicleMedia;

describe('DQ-1216 mini spec fit (VehicleCard 2.0, ONB-01/02)', () => {
  const garage = [
    { value: '500', unit: 'PS', label: 'Leistung' },
    { value: '540', unit: 'Nm', label: 'Drehmoment' },
    { value: '2002', unit: null, label: 'Baujahr' },
  ];
  // GAR-01 at 393: the card's text column between the 20 gutters.
  const phone = 393 - 2 * 20;

  it('keeps three columns at 100 %', () => {
    expect(miniSpecColumns(garage, phone, 1, false)).toBe(3);
  });

  it('never puts three in a row at 200 %, and every line fits its column whole with space.12 between columns', () => {
    const columns = miniSpecColumns(garage, phone, 2, false);
    expect(columns).toBeLessThan(3);
    const cell = miniSpecCellWidth(phone, columns);
    for (const width of estimatedMiniSpecWidths(garage, 2, false)) expect(Math.ceil(width)).toBeLessThanOrEqual(cell);
    expect(MINI_SPEC_GAP).toBe(12);
  });

  it('falls back to one column when nothing else fits, and to one for an unknown width', () => {
    expect(miniSpecColumns(garage, 120, 2, false)).toBe(1);
    expect(miniSpecColumns(garage, 0, 1, false)).toBe(1);
  });
});

describe('DQ-1217 completeness line', () => {
  it('binds the figure to its percent sign', () => {
    expect(completenessLine('Build zu 100 % vollständig')).toBe('Build zu 100 % vollständig');
    expect(completenessLine('Build 70 % complete')).toBe('Build 70 % complete');
  });
});

describe('DQ-1160 / DQ-1215 no photo twice', () => {
  const card = { slug: 'r34', cover: media('a'), photo_count: 3 };

  it('keeps the cover unless the page above shows it', () => {
    expect(distinctCover(card, 'x', undefined)?.id).toBe('a');
    expect(needsOtherCover(card, 'x')).toBe(false);
  });

  it('takes the next gallery photo when the cover repeats the hero', () => {
    expect(needsOtherCover(card, 'a')).toBe(true);
    expect(distinctCover(card, 'a', [media('a'), media('b')])?.id).toBe('b');
    // Until the gallery is known, or for a one-photo build: the cover.
    expect(distinctCover(card, 'a', undefined)?.id).toBe('a');
    expect(needsOtherCover({ ...card, photo_count: 1 }, 'a')).toBe(false);
  });
});

describe('DQ-1234 profile cover without one of the member’s own', () => {
  const photos = (slug: string, count: number) => Array.from({ length: count }, (_, index) => media(`${slug}-${index + 1}`));
  /** What each garage card shows under `cover` (ProfileGarageCard → useDistinctCover with the build's gallery). */
  const shown = (cards: { slug: string; gallery: VehicleMedia[] }[], cover: VehicleMedia | null) =>
    cards.map((card) => distinctCover({ cover: card.gallery[0] ?? null }, cover?.id, card.gallery)?.id);
  const cardsOf = (cards: { slug: string; gallery: VehicleMedia[] }[]) =>
    cards.map((card) => ({ slug: card.slug, cover: card.gallery[0] ?? null, photo_count: card.gallery.length }));

  it('2 builds × 1 photo (PROF-02 jann.ptrs): no build photo, the brand stage', () => {
    const builds = [
      { slug: 'm4-g82', gallery: photos('m4', 1) },
      { slug: 'm2-f87', gallery: photos('m2', 1) },
    ];
    const cover = profileCover({ cover: null }, cardsOf(builds));
    expect(cover).toBeNull();
    // The stage is the empty-stage photo with no car in it, never one of the cards' photos.
    expect(PROFILE_STAGE.source).toBeDefined();
    expect(shown(builds, cover)).toEqual(['m4-1', 'm2-1']);
  });

  it('takes a build photo only when its card can show another one, so no card repeats the cover', () => {
    const builds = [
      { slug: 'm4-g82', gallery: photos('m4', 1) },
      { slug: 'm2-f87', gallery: photos('m2', 2) },
    ];
    const cover = profileCover({ cover: null }, cardsOf(builds));
    expect(cover?.id).toBe('m2-1');
    expect(shown(builds, cover)).toEqual(['m4-1', 'm2-2']);
    expect(shown(builds, cover)).not.toContain(cover?.id);
  });

  it('keeps the member’s own cover whatever the cards show', () => {
    const own = media('own');
    expect(profileCover({ cover: own }, cardsOf([{ slug: 'm4-g82', gallery: photos('m4', 1) }]))).toBe(own);
  });
});

describe('ADR-466 BIZ-01 hero', () => {
  it('uses the API cover, names the portfolio build, else the brand stage', () => {
    const build = { id: 'v1', cover: media('p1'), full_title: 'Nissan Silvia S15' } as unknown as Parameters<typeof businessHero>[1][number];
    expect(businessHero({ cover: media('own'), cover_source: 'business' }, [build], 400).source).toBe('own');
    const fromPortfolio = businessHero({ cover: media('p1'), cover_source: 'portfolio' }, [build], 400);
    expect(fromPortfolio.source).toBe('portfolio');
    expect(fromPortfolio.vehicle?.id).toBe('v1');
    // The app never picks a portfolio photo itself.
    expect(businessHero({ cover: null, cover_source: null }, [build], 400).photo).toBe(BUSINESS_STAGE);
  });
});

describe('DQ-1178 provenance words (ADR-431 c)', () => {
  const words = { factory: 'Herstellerangabe', claimed: 'Geschätzt', measured: 'Prüfstand' } as const;
  const source = (key: keyof typeof words) => words[key];

  it('speaks Prüfstand · Herstellerangabe · geschätzt', () => {
    expect(provenanceCaption('gemessen', source)).toBe('Prüfstand');
    expect(provenanceCaption('Besitzerangabe', source)).toBe('Geschätzt');
    expect(provenanceCaption('500 PS · gemessen', source)).toBe('500 PS · Prüfstand');
    expect(provenanceCaption('356 mm', source)).toBe('356 mm');
  });
});
