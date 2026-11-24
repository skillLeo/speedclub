/**
 * M5.9c Build Score reads (contract docs/reports/phase-5/m5.9c-contract.md §4, ADR-508): the score of one vehicle with its parts, ranks
 * and, for the owner, "Nächstes Upgrade"; the public formula for "So entsteht dein Build Score"; the `{total, stage}` the vehicle
 * resources carry for GAR-01 and the cards. Never a number for power, speed, sound or money: the score has none.
 *
 * Types from the generated `BuildScoreResource` / `BuildScoreFormulaResource` (handover m5.9c-api-handover.md); the parsers stay
 * tolerant of fields the server adds later and clamp what the gauge draws.
 *
 * QA (never in production): `qaScore` answers both reads from the bundled set in features/score/qaScore.ts, so the visual matrix can
 * capture the gauge before the server computes scores.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, ApiError } from '@/api/client';
import type { components } from '@/api/schema';
import { qa } from '@/lib/qa';

import { usePublicViewer } from './vehicles';

export const BUILD_SCORE_MAX = 1000;

export type BuildScorePartKey = 'completeness' | 'documentation' | 'community' | 'journey';
export const BUILD_SCORE_PARTS: readonly BuildScorePartKey[] = ['completeness', 'documentation', 'community', 'journey'];

type ScoreResource = components['schemas']['BuildScoreResource'];
type FormulaResource = components['schemas']['BuildScoreFormulaResource'];

/** Owner only: a visitor's score has no parts (the community part would hint at the private reaction count). */
export type BuildScorePart = NonNullable<ScoreResource['parts']>[BuildScorePartKey];

/** A rank line ("EK9", "NRW"); the API only lists groups of at least 3 public cars. Region "Deutschland" for a generation rank. */
export type BuildScoreRank = ScoreResource['ranks'][number];

/** One item of the owner's "Nächstes Upgrade" (owner only, sorted by points by the server; the app sorts again). */
export type NextUpgrade = NonNullable<ScoreResource['next_upgrades']>[number];

export type BuildScore = ScoreResource;

/** What the garage list, VEH-01 and the cards carry (no ranks). */
export type VehicleBuildScore = NonNullable<components['schemas']['VehicleCardResource']['build_score']>;

export type FormulaItem = Omit<FormulaResource['parts'][number]['items'][number], 'min_chars'> & { min_chars?: number | null };

export type FormulaPart = Omit<FormulaResource['parts'][number], 'items'> & { items: FormulaItem[] };

export type BuildScoreFormula = Omit<FormulaResource, 'parts'> & { parts: FormulaPart[] };

/**
 * The score answer; `pending` while the server has not computed one yet (`data: null`, or 404 `build_score_pending`); `unavailable` for
 * any other 404 (a vehicle without a score for this viewer, or a server before M5.9c): the page then shows no section at all.
 */
export type BuildScoreRead = { status: 'ready'; score: BuildScore } | { status: 'pending' } | { status: 'unavailable' };

export const buildScoreKeys = {
  all: ['build-score'] as const,
  vehicle: (vehicleId: string, viewer: string) => ['build-score', vehicleId, viewer] as const,
  formula: (language: string) => ['build-score', 'formula', language] as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parsePart(value: unknown): BuildScorePart {
  const record = isRecord(value) ? value : {};
  return { points: Math.max(0, numberOr(record.points, 0)), max: Math.max(0, numberOr(record.max, 0)) };
}

function parseRank(value: unknown): BuildScoreRank | null {
  if (!isRecord(value)) return null;
  const scope = value.scope;
  if (scope !== 'generation' && scope !== 'bundesland') return null;
  if (typeof value.label !== 'string' || value.label.trim() === '') return null;
  const rank = numberOr(value.rank, 0);
  const groupSize = numberOr(value.group_size, 0);
  // The ≥ 3 rule is the server's; the app also never shows a rank outside its group.
  if (rank < 1 || groupSize < 3 || rank > groupSize) return null;
  return { scope, label: value.label, rank, group_size: groupSize, region: typeof value.region === 'string' ? value.region : null };
}

function parseUpgrade(value: unknown): NextUpgrade | null {
  if (!isRecord(value) || typeof value.key !== 'string') return null;
  const points = numberOr(value.points, 0);
  if (points <= 0) return null;
  const progress = isRecord(value.progress) ? value.progress : {};
  return {
    key: value.key,
    label_key: typeof value.label_key === 'string' ? value.label_key : value.key,
    points,
    progress: { have: Math.max(0, numberOr(progress.have, 0)), need: Math.max(0, numberOr(progress.need, 0)) },
  };
}

/** The `data` of `GET vehicles/{id}/build-score`, tolerant of fields the server adds later. Null: no score yet. */
export function parseBuildScore(data: unknown): BuildScore | null {
  if (!isRecord(data) || typeof data.total !== 'number') return null;
  const total = Math.min(BUILD_SCORE_MAX, Math.max(0, Math.round(data.total)));
  const parts = isRecord(data.parts) ? data.parts : {};
  const previous = typeof data.previous_total === 'number' ? Math.min(BUILD_SCORE_MAX, Math.max(0, Math.round(data.previous_total))) : null;
  return {
    total,
    stage: numberOr(data.stage, 0),
    parts: {
      completeness: parsePart(parts.completeness),
      documentation: parsePart(parts.documentation),
      community: parsePart(parts.community),
      journey: parsePart(parts.journey),
    },
    ranks: (Array.isArray(data.ranks) ? data.ranks : []).map(parseRank).filter((rank): rank is BuildScoreRank => rank !== null),
    computed_at: typeof data.computed_at === 'string' ? data.computed_at : null,
    previous_total: previous,
    ...(Array.isArray(data.next_upgrades)
      ? { next_upgrades: data.next_upgrades.map(parseUpgrade).filter((item): item is NextUpgrade => item !== null) }
      : {}),
    formula_version: typeof data.formula_version === 'string' ? data.formula_version : '',
  };
}

function parseFormula(data: unknown): BuildScoreFormula {
  const record = isRecord(data) ? data : {};
  const parts = Array.isArray(record.parts) ? record.parts : [];
  return {
    max: numberOr(record.max, BUILD_SCORE_MAX),
    stages: (Array.isArray(record.stages) ? record.stages : [])
      .filter(isRecord)
      .map((stage) => ({ stage: numberOr(stage.stage, 0), min: numberOr(stage.min, 0) })),
    parts: parts.filter(isRecord).flatMap((part) => {
      const key = part.key;
      if (key !== 'completeness' && key !== 'documentation' && key !== 'community' && key !== 'journey') return [];
      const items = (Array.isArray(part.items) ? part.items : []).filter(isRecord).flatMap((item) =>
        typeof item.key === 'string'
          ? [{
              key: item.key,
              points: numberOr(item.points, 0),
              limit: typeof item.limit === 'number' ? item.limit : null,
              max: numberOr(item.max, 0),
              min_chars: typeof item.min_chars === 'number' ? item.min_chars : null,
            }]
          : [],
      );
      return [{ key, max: numberOr(part.max, 0), items }];
    }),
    formula_version: typeof record.formula_version === 'string' ? record.formula_version : '',
  };
}

/** The `build_score: {total, stage}` of a vehicle resource (garage list, VEH-01, cards), or null while it has none. */
export function vehicleBuildScoreOf(resource: unknown): VehicleBuildScore | null {
  if (!isRecord(resource) || !isRecord(resource.build_score)) return null;
  const { total, stage } = resource.build_score;
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  return { total: Math.min(BUILD_SCORE_MAX, Math.max(0, Math.round(total))), stage: typeof stage === 'number' ? stage : 0 };
}

export async function getBuildScore(vehicleId: string, signal?: AbortSignal): Promise<BuildScoreRead> {
  try {
    const body = await apiData(api.GET('/vehicles/{vehicle}/build-score', { params: { path: { vehicle: vehicleId } }, signal }));
    // `{data: null}` (NoBuildScoreResource) while the server cannot compute one yet.
    const score = parseBuildScore('data' in body ? body.data : null);
    return score ? { status: 'ready', score } : { status: 'pending' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return error.code === 'build_score_pending' ? { status: 'pending' } : { status: 'unavailable' };
    throw error;
  }
}

export async function getBuildScoreFormula(signal?: AbortSignal): Promise<BuildScoreFormula> {
  const body = await apiData(api.GET('/build-score/formula', { signal }));
  return parseFormula(body.data);
}

/** A 4xx is an answer; a retry cannot change it. */
const retryReads = (failures: number, error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/** Hands the QA set in (features/score/qaScore.ts registers it), so this module stays free of the feature's sample data. */
type QaSource = {
  score: (vehicleId: string, owner: boolean) => Promise<BuildScoreRead>;
  formula: () => Promise<BuildScoreFormula>;
};
let qaSource: QaSource | null = null;
export function registerBuildScoreQaSource(source: QaSource | null): void {
  qaSource = source;
}

function qaActive(): boolean {
  return qa.score !== undefined && qaSource !== null;
}

/**
 * The score of one vehicle, for its page (public for public vehicles; the owner's answer has `next_upgrades`). `owner` only steers the
 * QA set: the server decides what the viewer gets. An empty `vehicleId` asks nothing.
 */
export function useBuildScore(vehicleId: string, { owner = false, enabled = true }: { owner?: boolean; enabled?: boolean } = {}) {
  const viewer = usePublicViewer();
  const sample = qaActive();
  return useQuery({
    queryKey: [...buildScoreKeys.vehicle(vehicleId, viewer), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample && qaSource ? qaSource.score(vehicleId, owner) : getBuildScore(vehicleId, signal)),
    enabled: enabled && vehicleId !== '',
    retry: sample ? false : retryReads,
  });
}

/** "So entsteht dein Build Score" (public): asked when the sheet opens, kept for the session. */
export function useBuildScoreFormula(enabled: boolean) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const sample = qaActive();
  return useQuery({
    queryKey: [...buildScoreKeys.formula(language), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample && qaSource ? qaSource.formula() : getBuildScoreFormula(signal)),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: sample ? false : retryReads,
  });
}
