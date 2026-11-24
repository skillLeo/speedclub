/**
 * The bundled Build Score set of the non-production override `qaScore` (mobile/src/lib/qa.ts): VEH-01's section, the formula sheet and
 * GAR-01's compact score answer from it until lane B serves the reads, so the visual matrix can capture them. Never shown to a
 * member: `qa` has no overrides in production. The formula is the owner-approved default (owner-gift-detail M5.9c), the score a
 * plausible stage 4 build; no rank group is under 3 cars.
 */
import {
  registerBuildScoreQaSource,
  type BuildScore,
  type BuildScoreFormula,
  type BuildScoreRead,
  type VehicleBuildScore,
} from '@/api/queries/buildScore';
import { qa } from '@/lib/qa';
import { stageOf } from '@/ui/buildScoreGaugeMath';

export const QA_FORMULA: BuildScoreFormula = {
  max: 1000,
  stages: [
    { stage: 1, min: 0 },
    { stage: 2, min: 200 },
    { stage: 3, min: 400 },
    { stage: 4, min: 600 },
    { stage: 5, min: 800 },
  ],
  parts: [
    {
      key: 'completeness',
      max: 300,
      items: [
        { key: 'photos', points: 20, limit: 6, max: 120 },
        { key: 'key_specs', points: 10, limit: 10, max: 100 },
        { key: 'description', points: 50, limit: null, max: 50, min_chars: 200 },
        { key: 'cover_focal', points: 30, limit: null, max: 30 },
      ],
    },
    {
      key: 'documentation',
      max: 300,
      items: [
        { key: 'documented_mods', points: 25, limit: 10, max: 250 },
        { key: 'registered_mods', points: 5, limit: 10, max: 50 },
      ],
    },
    {
      key: 'community',
      max: 250,
      items: [
        { key: 'reactors', points: 2, limit: 50, max: 100 },
        { key: 'spotters', points: 1, limit: 100, max: 100 },
        { key: 'followers', points: 1, limit: 50, max: 50 },
      ],
    },
    {
      key: 'journey',
      max: 150,
      items: [
        { key: 'timeline', points: 10, limit: 8, max: 80 },
        { key: 'before_after', points: 15, limit: 3, max: 45 },
        { key: 'history_span', points: 1, limit: 25, max: 25 },
      ],
    },
  ],
  formula_version: 'qa-1',
};

const SAMPLE_TOTAL = 642;

/** The sample score; a number from `qaScore` sets the total (the parts scale with it, the stage follows). */
export function qaBuildScore(owner: boolean, total: number = SAMPLE_TOTAL): BuildScore {
  const share = total / 1000;
  const part = (max: number) => ({ points: Math.round(max * share), max });
  return {
    total,
    stage: stageOf(total),
    parts: { completeness: part(300), documentation: part(300), community: part(250), journey: part(150) },
    ranks: [
      { scope: 'generation', label: 'R34', rank: 4, group_size: 61, region: 'Deutschland' }, // i18n-ignore: a chassis code and a country
      { scope: 'bundesland', label: 'NRW', rank: 2, group_size: 14, region: null }, // i18n-ignore: a Bundesland abbreviation
    ],
    computed_at: '2026-11-14T08:30:00Z',
    previous_total: Math.max(0, total - 25),
    ...(owner
      ? {
          next_upgrades: [
            { key: 'description', label_key: 'description', points: 50, progress: { have: 120, need: 200 } },
            { key: 'photos', label_key: 'photos', points: 80, progress: { have: 2, need: 6 } },
            { key: 'planned_mods', label_key: 'planned_mods', points: 25, progress: { have: 0, need: 1 } },
            { key: 'before_after', label_key: 'before_after', points: 15, progress: { have: 0, need: 1 } },
            // Not an item: the app leaves community points out of the checklist.
            { key: 'reactors', label_key: 'reactors', points: 40, progress: { have: 30, need: 50 } },
          ],
        }
      : {}),
    formula_version: 'qa-1',
  };
}

/** What `qaScore` answers for one vehicle's page. */
export function qaScoreRead(owner: boolean): BuildScoreRead {
  const value = qa.score;
  if (value === 'pending') return { status: 'pending' };
  return { status: 'ready', score: qaBuildScore(owner, typeof value === 'number' ? value : SAMPLE_TOTAL) };
}

/** GAR-01: a score for a card that carries none yet, spread from the id so the cards differ. */
export function qaCardScore(vehicleId: string): VehicleBuildScore | null {
  const value = qa.score;
  if (value === undefined || value === 'pending' || value === 'error') return null;
  if (typeof value === 'number') return { total: value, stage: stageOf(value) };
  let hash = 0;
  for (const char of vehicleId) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const total = 180 + (hash % 700);
  return { total, stage: stageOf(total) };
}

/** Installs the QA set as the source of the Build Score reads while `qaScore` is set (never in production). */
export function installQaScore(): void {
  if (qa.score === undefined) return;
  registerBuildScoreQaSource({
    score: (_vehicleId, owner) =>
      qa.score === 'error' ? Promise.reject(new Error('qaScore=error')) : Promise.resolve(qaScoreRead(owner)),
    formula: () => Promise.resolve(QA_FORMULA),
  });
}

installQaScore();
