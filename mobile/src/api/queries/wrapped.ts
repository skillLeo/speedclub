/**
 * M5.9e Season Wrapped (contract docs/reports/phase-5/m5.9e-contract.md §3 and §5, ADR-508): the member's own seasons, the
 * countdown before a release, one season's payload, the "shared" counter and the server's card image (the member web shares that
 * PNG; the phone draws the card itself). Only the member's own data; the app shows what the server computed and never makes up a
 * card: a card without data is left out (contract §3), and the parser drops one that would still say 0.
 *
 * Through the generated client (`WrappedSeasonResource`, `WrappedResource`, handover m5.9e-api-handover.md): the list answers
 * `{data: Season[], meta: {countdown: {season_key, release_at} | null}}`; the payload `{data: Payload}` with untyped card objects
 * (each parsed here); a photo is a media object `{url | variants[], blurhash, thumbhash, focal_x, focal_y}` or a bare URL; `n` in
 * `cards/{n}.png` is the card's 1-based position in the payload's `cards`.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { qa } from '@/lib/qa';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

import { retryUnlessAnswered } from './vehicles';

/** `2027-saison` (1 Mar–31 Oct) or `2027-jahr` (the calendar year). */
export type WrappedSeasonKind = 'saison' | 'jahr';

/** Contract §5 `GET /me/wrapped`, one row. */
export type WrappedSeason = { season_key: string; released: boolean; generated_at: string | null; viewed_at: string | null };

/** Contract §5: only while the flag `wrapped.countdown` is on. */
export type WrappedCountdown = { season_key: string; release_at: string };

export type MyWrapped = { seasons: WrappedSeason[]; countdown: WrappedCountdown | null };

/** A photo as the cards need it: only the server's blurred variants ever arrive here (ADR-509). */
export type WrappedPhoto = {
  source: string | number;
  blurhash: string | null;
  thumbhash: string | null;
  focal: { x: number; y: number } | null;
};

export type WrappedRarity = 'street' | 'tuned' | 'rare' | 'legend' | 'ghost';

/**
 * ADR-516 a: the intro, score and Build Spirit cards carry a photo of the member's own car (`image`, the share card's shape); null or
 * absent (a Wrapped generated before it, no usable photo) keeps the card typographic. Spots and Treffen never carry one.
 */
export type WrappedIntroCard = { kind: 'intro'; title: string; subtitle: string | null; image: WrappedPhoto | null };
export type WrappedSpotsCard = {
  kind: 'spots';
  count: number;
  unique_cars: number;
  cities: string[];
  rarest: { dex_number: number | null; rarity: WrappedRarity; vehicle_name: string; make: string | null; generation: string | null } | null;
};
export type WrappedScansCard = { kind: 'scans'; sticker_scans: number; profile_or_vehicle_views: number | null; top_city: string | null };
export type WrappedScoreCard = {
  kind: 'score';
  from: number;
  to: number;
  stage_from: number;
  stage_to: number;
  vehicle_name: string;
  image: WrappedPhoto | null;
};
export type WrappedTopModCard = {
  kind: 'top_mod';
  name: string;
  brand: string | null;
  before_media: WrappedPhoto | null;
  after_media: WrappedPhoto | null;
  vehicle_name: string;
};
export type WrappedTreffenCard = { kind: 'treffen'; attended: number; names: string[] };
export type WrappedSpiritCard = { kind: 'build_spirit'; key: string; title: string; explanation: string; image: WrappedPhoto | null };
export type WrappedPercentileCard = { kind: 'percentile'; bundesland: string; percentile: string; metric: 'build_score' };
export type WrappedShareCard = {
  kind: 'share';
  vehicle_name: string;
  dex_number: number | null;
  score: number | null;
  stage: number | null;
  /** The car's public page `/v/{slug}` (ADR-514: never the sticker code); null while the car cannot be opened. */
  qr_url: string | null;
  /** The server's QR of `qr_url` as SVG markup; null without one. */
  qr_svg: string | null;
  image: WrappedPhoto | null;
};

export type WrappedCard =
  | WrappedIntroCard
  | WrappedSpotsCard
  | WrappedScansCard
  | WrappedScoreCard
  | WrappedTopModCard
  | WrappedTreffenCard
  | WrappedSpiritCard
  | WrappedPercentileCard
  | WrappedShareCard;

export type WrappedCardKind = WrappedCard['kind'];

/** The card with its 1-based position in the payload, which `cards/{n}.png` names. */
export type PlacedCard = { card: WrappedCard; n: number };

/** Contract §3, version 1. */
export type WrappedPayload = {
  v: number;
  season_key: string;
  window: { from: string; to: string };
  member: { display_name: string | null; username: string | null };
  cards: PlacedCard[];
  /** Bundled QA sample (non-production only): badged "Beispiel" on every card. */
  is_sample?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing: tolerant of fields the server adds later, strict about what a card needs.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
const texts = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.map(text).filter((entry): entry is string => entry !== null).slice(0, max) : [];

const SEASON_KEY = /^(\d{4})-(saison|jahr)$/;

/** SVG markup the server drew, or null for anything that is not an `<svg …>` document. */
const svgMarkup = (value: unknown): string | null => {
  const markup = text(value);
  return markup !== null && /^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(markup) ? markup : null;
};
const RARITIES: readonly WrappedRarity[] = ['street', 'tuned', 'rare', 'legend', 'ghost'];

/** `{year, kind}` of a season key, or null for anything else (a route param is never trusted). */
export function parseSeasonKey(key: unknown): { year: number; kind: WrappedSeasonKind } | null {
  if (typeof key !== 'string') return null;
  const match = SEASON_KEY.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), kind: match[2] as WrappedSeasonKind };
}

/** A photo: a bare URL, or a media object (the smallest variant ≥ 1080 wide, else the largest). */
export function parseWrappedPhoto(value: unknown): WrappedPhoto | null {
  if (typeof value === 'number') return { source: value, blurhash: null, thumbhash: null, focal: null };
  const bare = text(value);
  if (bare) return { source: bare, blurhash: null, thumbhash: null, focal: null };
  if (!isRecord(value)) return null;
  const variants = Array.isArray(value.variants)
    ? value.variants
        .filter((variant): variant is { width: number; url: string } => isRecord(variant) && typeof variant.width === 'number' && typeof variant.url === 'string')
        .sort((a, b) => a.width - b.width)
    : [];
  const url = text(value.url) ?? (variants.find((variant) => variant.width >= 1080) ?? variants[variants.length - 1])?.url ?? null;
  if (!url) return null;
  const fx = value.focal_x;
  const fy = value.focal_y;
  return {
    source: url,
    blurhash: text(value.blurhash),
    thumbhash: text(value.thumbhash),
    focal: typeof fx === 'number' && typeof fy === 'number' ? { x: fx, y: fy } : null,
  };
}

/** One card, or null when it lacks what it needs or would show a 0 (contract §3: no card that shames). */
export function parseWrappedCard(value: unknown): WrappedCard | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'intro': {
      const title = text(value.title);
      return title ? { kind: 'intro', title, subtitle: text(value.subtitle), image: parseWrappedPhoto(value.image) } : null;
    }
    case 'spots': {
      const spots = count(value.count);
      if (!spots) return null;
      const rarest = isRecord(value.rarest) ? value.rarest : null;
      const rarestName = rarest ? text(rarest.vehicle_name) : null;
      return {
        kind: 'spots',
        count: spots,
        unique_cars: count(value.unique_cars) ?? 0,
        cities: texts(value.cities, 5),
        rarest:
          rarest && rarestName
            ? {
                dex_number: count(rarest.dex_number) || null,
                rarity: RARITIES.includes(rarest.rarity as WrappedRarity) ? (rarest.rarity as WrappedRarity) : 'street',
                vehicle_name: rarestName,
                make: text(rarest.make),
                generation: text(rarest.generation),
              }
            : null,
      };
    }
    case 'scans': {
      const scans = count(value.sticker_scans);
      const views = count(value.profile_or_vehicle_views);
      if (!scans && !views) return null;
      return { kind: 'scans', sticker_scans: scans ?? 0, profile_or_vehicle_views: views || null, top_city: text(value.top_city) };
    }
    case 'score': {
      const to = count(value.to);
      const name = text(value.vehicle_name);
      if (!to || !name) return null;
      const from = count(value.from) ?? 0;
      return {
        kind: 'score',
        from: Math.min(from, to),
        to,
        stage_from: count(value.stage_from) ?? 1,
        stage_to: count(value.stage_to) ?? 1,
        vehicle_name: name,
        image: parseWrappedPhoto(value.image),
      };
    }
    case 'top_mod': {
      const name = text(value.name);
      const vehicle = text(value.vehicle_name);
      if (!name || !vehicle) return null;
      return {
        kind: 'top_mod',
        name,
        brand: text(value.brand),
        before_media: parseWrappedPhoto(value.before_media),
        after_media: parseWrappedPhoto(value.after_media),
        vehicle_name: vehicle,
      };
    }
    case 'treffen': {
      const attended = count(value.attended);
      return attended ? { kind: 'treffen', attended, names: texts(value.names, 3) } : null;
    }
    case 'build_spirit': {
      const key = text(value.key);
      const title = text(value.title);
      const explanation = text(value.explanation);
      return key && title && explanation ? { kind: 'build_spirit', key, title, explanation, image: parseWrappedPhoto(value.image) } : null;
    }
    case 'percentile': {
      const bundesland = text(value.bundesland);
      const percentile = text(value.percentile);
      return bundesland && percentile ? { kind: 'percentile', bundesland, percentile, metric: 'build_score' } : null;
    }
    case 'share': {
      const name = text(value.vehicle_name);
      if (!name) return null;
      return {
        kind: 'share',
        vehicle_name: name,
        dex_number: count(value.dex_number) || null,
        score: count(value.score),
        stage: count(value.stage) || null,
        qr_url: text(value.qr_url),
        qr_svg: svgMarkup(value.qr_svg),
        image: parseWrappedPhoto(value.image),
      };
    }
    default:
      return null;
  }
}

/** The payload (`data` of `GET me/wrapped/{season}`), or null without a usable one. The share card always closes the story. */
export function parseWrappedPayload(body: unknown): WrappedPayload | null {
  const data = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(data)) return null;
  const seasonKey = text(data.season_key);
  if (!seasonKey || !parseSeasonKey(seasonKey) || !Array.isArray(data.cards)) return null;
  const placed = data.cards
    .map((raw, index) => ({ card: parseWrappedCard(raw), n: index + 1 }))
    .filter((entry): entry is PlacedCard => entry.card !== null);
  const cards = [...placed.filter((entry) => entry.card.kind !== 'share'), ...placed.filter((entry) => entry.card.kind === 'share').slice(0, 1)];
  if (cards.length === 0) return null;
  const window = isRecord(data.window) ? data.window : {};
  const member = isRecord(data.member) ? data.member : {};
  return {
    v: count(data.v) ?? 1,
    season_key: seasonKey,
    window: { from: text(window.from) ?? '', to: text(window.to) ?? '' },
    member: { display_name: text(member.display_name), username: text(member.username) },
    cards,
    ...(data.is_sample === true ? { is_sample: true } : {}),
  };
}

/** The list (`GET me/wrapped`), with the countdown wherever the server puts it (`meta`, `data` or the top level). */
export function parseMyWrapped(body: unknown): MyWrapped {
  const root = isRecord(body) ? body : {};
  const rows = Array.isArray(root.data) ? root.data : isRecord(root.data) && Array.isArray(root.data.seasons) ? root.data.seasons : [];
  const seasons = rows.flatMap((row): WrappedSeason[] => {
    if (!isRecord(row) || !parseSeasonKey(row.season_key)) return [];
    return [{ season_key: row.season_key as string, released: row.released === true, generated_at: text(row.generated_at), viewed_at: text(row.viewed_at) }];
  });
  const raw = [isRecord(root.meta) ? root.meta.countdown : undefined, isRecord(root.data) ? root.data.countdown : undefined, root.countdown].find(isRecord);
  const countdown = raw && parseSeasonKey(raw.season_key) && text(raw.release_at) ? { season_key: raw.season_key as string, release_at: text(raw.release_at) as string } : null;
  return { seasons, countdown };
}

/** The newest released season the member has, or null. Keys sort by year, then `jahr` (December) after `saison` (November). */
export function latestReleased(seasons: readonly WrappedSeason[]): WrappedSeason | null {
  const rank = (key: string) => {
    const parsed = parseSeasonKey(key);
    return parsed ? parsed.year * 2 + (parsed.kind === 'jahr' ? 1 : 0) : -1;
  };
  return [...seasons].filter((season) => season.released).sort((a, b) => rank(b.season_key) - rank(a.season_key))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// QA source (non-production `qaWrapped`, mobile/src/lib/qa.ts): the bundled set lives in features/wrapped/qaWrapped.ts.

export type WrappedQaSource = {
  list: () => MyWrapped;
  /** The payload, or the ApiError the server would answer (403 before the release, 404 without a Wrapped). */
  payload: (seasonKey: string) => WrappedPayload | ApiError;
};

let source: WrappedQaSource | null = null;

export function registerWrappedQaSource(next: WrappedQaSource | null): void {
  source = next;
}

/** The QA source while `qaWrapped` is set and the set is installed; null otherwise (the live API answers). */
export function wrappedQa(): WrappedQaSource | null {
  return qa.wrapped !== undefined ? source : null;
}

function fromWrappedQa<T>(read: (qaSource: WrappedQaSource) => T | ApiError): Promise<T> {
  const qaSource = wrappedQa();
  if (!qaSource) return Promise.reject(new Error('qaWrapped is not active'));
  if (qa.wrapped === 'error') return Promise.reject(new ApiError({ kind: 'server', status: 500, code: 'server_error', message: 'qaWrapped=error' }));
  const value = read(qaSource);
  return value instanceof ApiError ? Promise.reject(value) : Promise.resolve(value);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Requests


export const wrappedKeys = {
  all: ['wrapped'] as const,
  mine: () => ['wrapped', 'me'] as const,
  season: (seasonKey: string, language: string) => ['wrapped', 'season', seasonKey, language] as const,
};

/**
 * `GET me/wrapped`: the member's seasons and the countdown. Nothing for a guest, and nothing at all while the app-config flag
 * `wrapped` is off (client round 6, L2: Home asked every member and logged a 404 in production). The bundled sample of `qaWrapped`
 * reads no server and needs no flag.
 */
export function useMyWrapped(enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const featureOn = useFlag('wrapped');
  const sample = wrappedQa() !== null;
  return useQuery({
    queryKey: [...wrappedKeys.mine(), sample ? 'qa' : 'live'],
    queryFn: async ({ signal }) => (sample ? fromWrappedQa((qaSource) => qaSource.list()) : parseMyWrapped(await apiData(api.GET('/me/wrapped', { signal })))),
    enabled: signedIn && enabled && (featureOn || sample),
    retry: sample ? false : retryUnlessAnswered,
    staleTime: 5 * 60_000,
  });
}

/**
 * `GET me/wrapped/{season}`: one season's payload (it marks `viewed_at` on the server). 403 before the release, 404 without a
 * Wrapped; both are answers, so they are not retried. Per language: the intro's and the Build Spirit's words are the server's.
 */
export function useWrapped(seasonKey: string | null) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const { i18n } = useTranslation();
  const sample = wrappedQa() !== null;
  const key = seasonKey ?? '';
  return useQuery({
    queryKey: [...wrappedKeys.season(key, i18n.language), sample ? 'qa' : 'live'],
    queryFn: async ({ signal }) => {
      if (sample) return fromWrappedQa((qaSource) => qaSource.payload(key));
      const payload = parseWrappedPayload(await apiData(api.GET('/me/wrapped/{season_key}', { params: { path: { season_key: key } }, signal })));
      if (!payload) throw new ApiError({ kind: 'not_found', status: 404, code: 'not_found', message: 'No Wrapped' });
      return payload;
    },
    enabled: signedIn && seasonKey !== null,
    retry: sample ? false : retryUnlessAnswered,
    staleTime: 30 * 60_000,
  });
}

/** `POST me/wrapped/{season}/shared` after a share: `shared_count + 1` on the server. Fire and forget; nothing is sent in QA. */
export function useMarkWrappedShared(seasonKey: string | null) {
  return useMutation({
    mutationFn: async () => {
      if (!seasonKey || wrappedQa() !== null) return;
      await apiData(api.POST('/me/wrapped/{season_key}/shared', { params: { path: { season_key: seasonKey } }, ...withIdempotency() }));
    },
  });
}

/** `GET me/wrapped/{season}/cards/{n}.png`: the server's 1080 × 1920 card (the member web's download). */
export async function fetchWrappedCardImage(seasonKey: string, n: number): Promise<Blob> {
  const result = await api.GET('/me/wrapped/{season_key}/cards/{n}.png', { params: { path: { season_key: seasonKey, n: String(n) } }, parseAs: 'blob' });
  // The schema has no body type for an image answer; `parseAs: 'blob'` makes it a Blob.
  const image: unknown = result.data;
  if (!result.response.ok || !(image instanceof Blob)) throw new ApiError({ kind: 'not_found', status: result.response.status, code: 'not_found', message: 'No card image' });
  return image;
}

/** The file name of a downloaded card: `speedclub-wrapped-2027-saison-3.png`. */
export function wrappedCardFileName(seasonKey: string, n: number): string {
  return `speedclub-wrapped-${seasonKey}-${n}.png`;
}
