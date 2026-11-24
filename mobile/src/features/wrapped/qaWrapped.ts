/**
 * The bundled set of the non-production override `qaWrapped` (mobile/src/lib/qa.ts): the Season Wrapped reads answer from it until
 * lane B serves them, so the visual matrix can capture every card. Never shown to a member: `qa` has no overrides in production.
 * Own data only and cities only, as the server's payload (contract §3); the cars are the licensed seed photos
 * (design/seed-photos/CREDITS.md, Unsplash License, resized copies in mobile/assets/gallery) with a plate decision
 * (web/database/data/showcase/plates.json: the R34 blurred; the engine bay and the wheel close-ups declined), the numbers a plausible
 * season, and every card is badged "Beispiel" (`is_sample`).
 *
 * DQ-P5G-29: one sample season everywhere, `2026-saison` (1 March to 31 October 2026), released on 5 November 2026 at 10:00: the player,
 * the "noch nicht da" preview, the PROF-01 row and the Home countdown (three days ahead of the matrix's qaNow, 2 November 2026) all
 * name the same season.
 */
import { ApiError } from '@/api/client';
import { registerWrappedQaSource, type MyWrapped, type WrappedCountdown, type WrappedPayload } from '@/api/queries/wrapped';
import { SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import i18n from '@/i18n';
import { now } from '@/lib/clock';
import { qa } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { themes } from '@/theme';
import type { PhotoFields } from '@/ui/Photo';

export const QA_SEASON = '2026-saison';
/** When the sample season is released (after its end, ADR-514). */
export const QA_RELEASE = '2026-11-05T10:00:00+01:00';
/** QR colours are the same tokens in every theme (`qr.fg` black, `qr.bg` white), as on the server-drawn card. */
const QR = themes.carbon.color.qr;

/**
 * The QR of the sample share card: the flagship sample R34's public page on the production host (ADR-503)
 * `https://joinspeedclub.com/v/nissan-skyline-gt-r-r34-5tf974vj` (ADR-514: a shared card carries the page, never the sticker code). Path
 * drawn once by the backend's QrRenderer (`App\Services\Qr\QrRenderer::svg`, 49 modules with the quiet zone); `QA_PAGE_URL` is the same address.
 */
const QA_PAGE_QR_PATH =
  'M4 4h7v1h-7zM14 4h1v1h-1zM18 4h5v1h-5zM24 4h2v1h-2zM28 4h3v1h-3zM32 4h1v1h-1zM38 4h7v1h-7zM4 5h1v1h-1zM10 5h1v1h-1zM12 5h2v1h-2zM16 5h1v1h-1zM21 5h2v1h-2zM25 5h6v1h-6zM33 5h1v1h-1zM35 5h1v1h-1zM38 5h1v1h-1zM44 5h1v1h-1zM4 6h1v1h-1zM6 6h3v1h-3zM10 6h1v1h-1zM14 6h1v1h-1zM17 6h1v1h-1zM21 6h1v1h-1zM23 6h3v1h-3zM29 6h3v1h-3zM33 6h4v1h-4zM38 6h1v1h-1zM40 6h3v1h-3zM44 6h1v1h-1zM4 7h1v1h-1zM6 7h3v1h-3zM10 7h1v1h-1zM12 7h1v1h-1zM16 7h1v1h-1zM19 7h1v1h-1zM23 7h1v1h-1zM26 7h1v1h-1zM30 7h1v1h-1zM32 7h1v1h-1zM35 7h2v1h-2z M38 7h1v1h-1zM40 7h3v1h-3zM44 7h1v1h-1zM4 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h2v1h-2zM22 8h1v1h-1zM25 8h2v1h-2zM28 8h1v1h-1zM32 8h1v1h-1zM34 8h3v1h-3zM38 8h1v1h-1zM40 8h3v1h-3zM44 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM14 9h1v1h-1zM18 9h1v1h-1zM20 9h8v1h-8zM34 9h1v1h-1zM38 9h1v1h-1zM44 9h1v1h-1zM4 10h7v1h-7zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM28 10h1v1h-1zM30 10h1v1h-1zM32 10h1v1h-1zM34 10h1v1h-1zM36 10h1v1h-1zM38 10h7v1h-7z M12 11h1v1h-1zM15 11h1v1h-1zM18 11h1v1h-1zM20 11h2v1h-2zM25 11h1v1h-1zM28 11h4v1h-4zM34 11h1v1h-1zM5 12h1v1h-1zM7 12h4v1h-4zM12 12h4v1h-4zM17 12h2v1h-2zM20 12h1v1h-1zM23 12h1v1h-1zM25 12h3v1h-3zM30 12h2v1h-2zM33 12h1v1h-1zM35 12h1v1h-1zM37 12h2v1h-2zM40 12h2v1h-2zM43 12h1v1h-1zM4 13h2v1h-2zM8 13h1v1h-1zM11 13h3v1h-3zM15 13h1v1h-1zM18 13h3v1h-3zM22 13h1v1h-1zM25 13h1v1h-1zM28 13h1v1h-1zM30 13h2v1h-2zM33 13h3v1h-3zM40 13h1v1h-1zM43 13h1v1h-1zM5 14h2v1h-2zM10 14h2v1h-2zM15 14h1v1h-1zM17 14h2v1h-2zM20 14h1v1h-1zM23 14h6v1h-6zM30 14h3v1h-3zM38 14h1v1h-1z M40 14h1v1h-1zM42 14h2v1h-2zM6 15h1v1h-1zM9 15h1v1h-1zM13 15h5v1h-5zM21 15h4v1h-4zM26 15h2v1h-2zM30 15h4v1h-4zM35 15h2v1h-2zM40 15h2v1h-2zM43 15h1v1h-1zM4 16h1v1h-1zM6 16h5v1h-5zM12 16h1v1h-1zM14 16h4v1h-4zM21 16h2v1h-2zM25 16h2v1h-2zM31 16h2v1h-2zM39 16h1v1h-1zM44 16h1v1h-1zM4 17h1v1h-1zM7 17h3v1h-3zM12 17h2v1h-2zM16 17h1v1h-1zM19 17h1v1h-1zM22 17h1v1h-1zM25 17h2v1h-2zM28 17h1v1h-1zM30 17h1v1h-1zM32 17h1v1h-1zM34 17h3v1h-3zM39 17h2v1h-2zM42 17h1v1h-1zM44 17h1v1h-1zM8 18h1v1h-1zM10 18h2v1h-2zM15 18h1v1h-1zM20 18h4v1h-4zM25 18h1v1h-1zM29 18h2v1h-2z M32 18h8v1h-8zM44 18h1v1h-1zM5 19h1v1h-1zM8 19h1v1h-1zM13 19h3v1h-3zM18 19h2v1h-2zM24 19h2v1h-2zM28 19h1v1h-1zM31 19h1v1h-1zM34 19h1v1h-1zM36 19h2v1h-2zM40 19h5v1h-5zM10 20h1v1h-1zM12 20h3v1h-3zM17 20h1v1h-1zM20 20h2v1h-2zM23 20h1v1h-1zM25 20h1v1h-1zM27 20h1v1h-1zM29 20h2v1h-2zM32 20h1v1h-1zM34 20h1v1h-1zM36 20h2v1h-2zM43 20h2v1h-2zM6 21h2v1h-2zM9 21h1v1h-1zM12 21h2v1h-2zM15 21h2v1h-2zM18 21h1v1h-1zM21 21h1v1h-1zM23 21h2v1h-2zM26 21h1v1h-1zM28 21h8v1h-8zM37 21h1v1h-1zM40 21h4v1h-4zM4 22h1v1h-1zM6 22h6v1h-6zM14 22h1v1h-1zM17 22h4v1h-4zM24 22h1v1h-1z M27 22h2v1h-2zM31 22h1v1h-1zM33 22h4v1h-4zM39 22h4v1h-4zM44 22h1v1h-1zM4 23h1v1h-1zM6 23h1v1h-1zM9 23h1v1h-1zM11 23h1v1h-1zM14 23h2v1h-2zM17 23h1v1h-1zM19 23h1v1h-1zM22 23h1v1h-1zM24 23h1v1h-1zM27 23h1v1h-1zM30 23h2v1h-2zM35 23h1v1h-1zM37 23h2v1h-2zM40 23h1v1h-1zM42 23h1v1h-1zM5 24h8v1h-8zM15 24h2v1h-2zM18 24h2v1h-2zM22 24h1v1h-1zM24 24h1v1h-1zM26 24h1v1h-1zM28 24h4v1h-4zM34 24h3v1h-3zM38 24h1v1h-1zM40 24h3v1h-3zM4 25h2v1h-2zM12 25h3v1h-3zM19 25h1v1h-1zM22 25h1v1h-1zM26 25h2v1h-2zM30 25h2v1h-2zM33 25h1v1h-1zM35 25h1v1h-1zM40 25h3v1h-3zM4 26h1v1h-1z M10 26h2v1h-2zM14 26h2v1h-2zM17 26h1v1h-1zM19 26h1v1h-1zM21 26h1v1h-1zM25 26h1v1h-1zM27 26h1v1h-1zM31 26h2v1h-2zM38 26h2v1h-2zM42 26h1v1h-1zM8 27h2v1h-2zM11 27h1v1h-1zM14 27h1v1h-1zM16 27h1v1h-1zM18 27h1v1h-1zM25 27h2v1h-2zM28 27h1v1h-1zM30 27h4v1h-4zM35 27h5v1h-5zM41 27h1v1h-1zM44 27h1v1h-1zM6 28h1v1h-1zM8 28h3v1h-3zM14 28h1v1h-1zM18 28h1v1h-1zM22 28h1v1h-1zM27 28h2v1h-2zM31 28h1v1h-1zM36 28h1v1h-1zM38 28h2v1h-2zM11 29h1v1h-1zM13 29h1v1h-1zM15 29h1v1h-1zM17 29h1v1h-1zM21 29h1v1h-1zM24 29h4v1h-4zM30 29h5v1h-5zM36 29h1v1h-1zM38 29h3v1h-3zM42 29h3v1h-3z M6 30h3v1h-3zM10 30h3v1h-3zM14 30h1v1h-1zM17 30h3v1h-3zM21 30h2v1h-2zM24 30h3v1h-3zM28 30h1v1h-1zM30 30h4v1h-4zM35 30h4v1h-4zM41 30h1v1h-1zM43 30h2v1h-2zM4 31h1v1h-1zM7 31h2v1h-2zM11 31h2v1h-2zM15 31h4v1h-4zM21 31h1v1h-1zM23 31h1v1h-1zM26 31h1v1h-1zM30 31h2v1h-2zM34 31h2v1h-2zM37 31h3v1h-3zM41 31h4v1h-4zM4 32h1v1h-1zM6 32h8v1h-8zM15 32h1v1h-1zM19 32h1v1h-1zM22 32h1v1h-1zM25 32h1v1h-1zM27 32h4v1h-4zM32 32h1v1h-1zM35 32h3v1h-3zM39 32h1v1h-1zM41 32h1v1h-1zM43 32h2v1h-2zM4 33h1v1h-1zM7 33h1v1h-1zM16 33h4v1h-4zM21 33h1v1h-1zM24 33h2v1h-2zM27 33h1v1h-1z M32 33h1v1h-1zM34 33h1v1h-1zM36 33h3v1h-3zM40 33h1v1h-1zM43 33h1v1h-1zM4 34h8v1h-8zM13 34h2v1h-2zM16 34h2v1h-2zM19 34h1v1h-1zM21 34h1v1h-1zM25 34h2v1h-2zM28 34h2v1h-2zM31 34h1v1h-1zM33 34h1v1h-1zM36 34h2v1h-2zM39 34h1v1h-1zM41 34h1v1h-1zM44 34h1v1h-1zM4 35h4v1h-4zM12 35h1v1h-1zM14 35h5v1h-5zM20 35h3v1h-3zM26 35h2v1h-2zM29 35h1v1h-1zM38 35h2v1h-2zM41 35h4v1h-4zM4 36h3v1h-3zM8 36h3v1h-3zM12 36h3v1h-3zM16 36h2v1h-2zM19 36h4v1h-4zM27 36h2v1h-2zM30 36h2v1h-2zM33 36h1v1h-1zM36 36h8v1h-8zM12 37h1v1h-1zM14 37h7v1h-7zM22 37h1v1h-1zM24 37h4v1h-4zM31 37h3v1h-3z M35 37h2v1h-2zM40 37h1v1h-1zM4 38h7v1h-7zM19 38h3v1h-3zM23 38h2v1h-2zM26 38h3v1h-3zM30 38h2v1h-2zM35 38h2v1h-2zM38 38h1v1h-1zM40 38h3v1h-3zM4 39h1v1h-1zM10 39h1v1h-1zM12 39h5v1h-5zM18 39h2v1h-2zM24 39h4v1h-4zM30 39h3v1h-3zM34 39h3v1h-3zM40 39h2v1h-2zM43 39h1v1h-1zM4 40h1v1h-1zM6 40h3v1h-3zM10 40h1v1h-1zM12 40h1v1h-1zM15 40h1v1h-1zM17 40h2v1h-2zM20 40h6v1h-6zM27 40h1v1h-1zM29 40h3v1h-3zM33 40h1v1h-1zM35 40h7v1h-7zM43 40h2v1h-2zM4 41h1v1h-1zM6 41h3v1h-3zM10 41h1v1h-1zM12 41h4v1h-4zM18 41h1v1h-1zM21 41h1v1h-1zM27 41h1v1h-1zM29 41h1v1h-1zM31 41h4v1h-4z M39 41h1v1h-1zM42 41h3v1h-3zM4 42h1v1h-1zM6 42h3v1h-3zM10 42h1v1h-1zM15 42h1v1h-1zM17 42h2v1h-2zM23 42h1v1h-1zM25 42h1v1h-1zM29 42h3v1h-3zM34 42h1v1h-1zM37 42h1v1h-1zM39 42h6v1h-6zM4 43h1v1h-1zM10 43h1v1h-1zM12 43h6v1h-6zM20 43h2v1h-2zM26 43h1v1h-1zM32 43h1v1h-1zM37 43h1v1h-1zM40 43h3v1h-3zM44 43h1v1h-1zM4 44h7v1h-7zM15 44h4v1h-4zM20 44h1v1h-1zM23 44h3v1h-3zM28 44h2v1h-2zM36 44h1v1h-1zM40 44h1v1h-1z';
/** The address the sample QR encodes (shown under it on the share card). */
export const QA_PAGE_URL = 'https://joinspeedclub.com/v/nissan-skyline-gt-r-r34-5tf974vj';
export const QA_QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 49 49" shape-rendering="crispEdges"><rect width="49" height="49" fill="' +
  QR.bg +
  '"/><path fill="' +
  QR.fg +
  '" d="' +
  QA_PAGE_QR_PATH +
  '"/></svg>';

/** The sample R34's Work wheel (the season's top mod), a close-up without a plate. */
const WHEELS_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-wheels-01.jpg') as number,
  blurhash: 'LAAJ=-~p9]?cxvMxITogyX-;whI[',
  focal: { x: 0.35, y: 0.5 },
};

/** The sample R34's engine bay (one of its seed photos, demo.json `nissan-r34`): the Build Score card's picture. */
const ENGINE_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-engine-03.jpg') as number,
  blurhash: 'L6A^L2Or?utQOY-:x]-;k=~p?u?a',
  focal: { x: 0.45, y: 0.45 },
};

/** The stance shot of the Build Spirit card: tyre, fender gap and wheel low on the asphalt (generic-wheels-02, no plate). */
const STANCE_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-wheels-02.jpg') as number,
  blurhash: 'LED]9w0L?GxC-;?GxZWBM|_2IBt6',
  focal: { x: 0.42, y: 0.55 },
};

const photo = (fields: PhotoFields, focal = fields.focal) => ({
  source: fields.source as number,
  blurhash: fields.blurhash ?? null,
  thumbhash: null,
  focal: focal ?? null,
});

const en = () => i18n.language.startsWith('en');

/** Whether this session answers the Wrapped reads from the QA set. */
export function qaWrappedActive(): boolean {
  return qa.wrapped !== undefined;
}

/**
 * The countdown sample: a season released three days after now (`qaNow` in the matrix), at 10:00, after the Saisonende of that year,
 * so the banner and WRP-01's "noch nicht da" name a season and a date that belong together.
 */
export function qaCountdown(): WrappedCountdown {
  const release = new Date(now().getTime() + 3 * 24 * 60 * 60 * 1000);
  release.setHours(10, 0, 0, 0);
  return { season_key: `${release.getFullYear()}-saison`, release_at: release.toISOString() };
}

export function qaMyWrapped(): MyWrapped {
  if (qa.wrapped === 'empty') return { seasons: [], countdown: null };
  if (qa.wrapped === 'countdown') {
    const countdown = qaCountdown();
    return { seasons: [{ season_key: countdown.season_key, released: false, generated_at: null, viewed_at: null }], countdown };
  }
  return { seasons: [{ season_key: QA_SEASON, released: true, generated_at: QA_RELEASE, viewed_at: null }], countdown: null };
}

/** The sample season of the signed-in member: nine cards, as the server sends them (texts in the app's language). */
export function qaWrappedPayload(): WrappedPayload {
  const member = useSessionStore.getState().member;
  const de = !en();
  // ADR-516 a: the member's own car on the intro, score, Build Spirit and share cards, a different picture on each (DQ-P5G-58, as
  // the server picks distinct photos where a car has them): the cover opens (full-bleed) and closes (the share card), the engine bay
  // stands for the Build Score, a stance close-up for the Build Spirit its suspension and wheels decide, and the top mod shows its
  // "Nachher" alone (no same-angle pair in the seed set, DQ-P5G-31). Spots and Treffen never carry a photo (other members' cars
  // and covers).
  const r34 = photo(SAMPLE_CARD_PHOTO);
  const engineBay = photo(ENGINE_PHOTO);
  const stance = photo(STANCE_PHOTO);
  // The server's own words (intro, Build Spirit, the Bundesland and the percentile line), German and English.
  return {
    v: 1,
    season_key: QA_SEASON,
    window: { from: '2026-03-01', to: '2026-10-31' },
    member: { display_name: member?.displayName ?? null, username: member?.username ?? null },
    is_sample: true,
    cards: [
      {
        n: 1,
        card: {
          kind: 'intro',
          title: de ? 'Deine Saison 2026' : 'Your 2026 season',
          subtitle: de ? 'Vom ersten Treffen im März bis zum Saisonende im Oktober.' : 'From the first meet in March to the end of the season in October.',
          image: r34,
        },
      },
      {
        n: 2,
        card: {
          kind: 'spots',
          count: 47,
          unique_cars: 31,
          cities: ['Düsseldorf', 'Köln', 'Essen', 'Duisburg', 'Neuss'],
          rarest: { dex_number: 412, rarity: 'legend', vehicle_name: 'Honda NSX NA1', make: 'Honda', generation: 'NA1' }, // i18n-ignore: a car name
        },
      },
      { n: 3, card: { kind: 'scans', sticker_scans: 128, profile_or_vehicle_views: 1940, top_city: 'Düsseldorf' } },
      { n: 4, card: { kind: 'score', from: 412, to: 642, stage_from: 3, stage_to: 4, vehicle_name: 'Nissan Skyline GT-R R34', image: engineBay } }, // i18n-ignore
      { n: 5, card: { kind: 'top_mod', name: 'Meister S1 3P', brand: 'Work', before_media: null, after_media: photo(WHEELS_PHOTO), vehicle_name: 'Nissan Skyline GT-R R34' } }, // i18n-ignore
      { n: 6, card: { kind: 'treffen', attended: 6, names: ['Cars & Coffee Düsseldorf', 'JDM Sonntag am Rhein', 'Saisonabschluss Ruhrpott'] } }, // i18n-ignore: public meet titles
      {
        n: 7,
        card: {
          kind: 'build_spirit',
          key: 'shakotan_artist',
          title: 'Shakotan Artist', // i18n-ignore: the server's title
          explanation: de
            ? 'Fahrwerk, Felgen und Stance machen mehr als die Hälfte deiner dokumentierten Mods aus.'
            : 'Suspension, wheels and stance make up more than half of your documented mods.',
          image: stance,
        },
      },
      { n: 8, card: { kind: 'percentile', bundesland: 'NRW', percentile: de ? 'Top 12 %' : 'Top 12%', metric: 'build_score' } },
      {
        n: 9,
        card: { kind: 'share', vehicle_name: 'Nissan Skyline GT-R R34', dex_number: 34, score: 642, stage: 4, qr_url: QA_PAGE_URL, qr_svg: null, image: r34 }, // i18n-ignore
      },
    ],
  };
}

function qaPayload(seasonKey: string): WrappedPayload | ApiError {
  if (qa.wrapped === 'countdown') return new ApiError({ kind: 'forbidden', status: 403, code: 'wrapped_not_released', message: 'Not released' });
  if (qa.wrapped === 'empty' || seasonKey !== QA_SEASON) return new ApiError({ kind: 'not_found', status: 404, code: 'not_found', message: 'No Wrapped' });
  return qaWrappedPayload();
}

/** Installs the QA set as the source of the Wrapped reads while `qaWrapped` is set (never in production). */
export function installQaWrapped(): void {
  if (qa.wrapped === undefined) return;
  registerWrappedQaSource({ list: qaMyWrapped, payload: qaPayload });
}

installQaWrapped();
