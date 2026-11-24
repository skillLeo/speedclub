/**
 * M5.9d XP and levels (contract docs/reports/phase-5/m5.9d-contract.md §1, ADR-508): the member's own level with progress and the
 * XP of today against the daily cap, and the quiet `{level, title}` that profile resources carry. Fixed rules only: XP for real
 * actions, nothing for likes, posting volume or logging in. The title is always the server's; the app never names a level.
 *
 * Calls through the generated client (`MyLevelResource`, `LevelSummaryResource`); the parsers stay tolerant of fields the server
 * adds later (handover m5.9d-api-handover.md).
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData } from '@/api/client';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

import { fromGiftQa, giftQa } from './giftQa';
import { retryUnlessAnswered } from './vehicles';

/** One fixed XP rule as the level sheet explains it. `daily_max`: a per-type cap per day ("Hilfreich" 20), null for none. */
export type XpRule = { type: string; points: number; daily_max: number | null };

/** One rung of the level ladder: the level, its title (the server's, request language) and the XP where it starts. */
export type LevelStep = { level: number; title: string; from_xp: number };

/** Contract §1 `GET /api/v1/me/level`. `next_level_xp` is null on the top level (assumed; the contract names no top case). */
export type MyLevel = {
  level: number;
  title: string;
  xp: number;
  next_level_xp: number | null;
  /** 0–1 on the way to the next level. */
  progress: number;
  today: { earned: number; cap: number };
  /** Optional (beyond the contract): the server's own rule list; the app then shows these points instead of the defaults. */
  rules?: XpRule[];
  /** Client round 2: every level with its title and start XP, ascending (empty from a server before the ladder). */
  ladder: LevelStep[];
};

/** Contract §1: public profile resources carry `level: {level, title}`. */
export type PublicLevel = { level: number; title: string };

/** Contract §1 defaults (`config/speedclub.php` `xp.*`), the list "Wie du XP sammelst" falls back to. */
export const DEFAULT_XP_RULES: readonly XpRule[] = [
  { type: 'first_vehicle', points: 50, daily_max: null },
  { type: 'documented_mod', points: 20, daily_max: null },
  { type: 'build_update', points: 15, daily_max: null },
  { type: 'new_spot', points: 10, daily_max: null },
  { type: 'set_completed', points: 100, daily_max: null },
  { type: 'event_checkin', points: 40, daily_max: null },
  { type: 'forum_solution', points: 30, daily_max: null },
  { type: 'helpful_received', points: 2, daily_max: 20 },
];

/** Contract §1: the daily cap. */
export const XP_DAILY_CAP = 200;


const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export const levelKeys = {
  all: ['level'] as const,
  mine: (language: string) => ['level', 'me', language] as const,
};

/** `{level, title}` of a profile resource, or null while it carries none (a server before M5.9d, or no level yet). */
export function publicLevelOf(resource: unknown): PublicLevel | null {
  if (!isRecord(resource) || !isRecord(resource.level)) return null;
  const { level, title } = resource.level;
  if (typeof level !== 'number' || level < 1 || typeof title !== 'string' || title.trim() === '') return null;
  return { level: Math.round(level), title: title.trim() };
}

/** "Founding Member" with its four-digit number: `founding_number` of a profile resource (1–1000), or null. */
export function foundingNumberOf(resource: unknown): number | null {
  if (!isRecord(resource)) return null;
  const value = resource.founding_number;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : null;
}

/** The founding number as printed: four digits ("0042"). */
export function foundingNumberText(value: number): string {
  return String(value).padStart(4, '0');
}

function parseRule(value: unknown): XpRule | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const points = numberOr(value.points, 0);
  if (points <= 0) return null;
  return { type: value.type, points, daily_max: typeof value.daily_max === 'number' ? value.daily_max : null };
}

function parseStep(value: unknown): LevelStep | null {
  if (!isRecord(value)) return null;
  const level = publicLevelOf({ level: value });
  if (!level || typeof value.from_xp !== 'number' || !Number.isFinite(value.from_xp)) return null;
  return { ...level, from_xp: Math.max(0, Math.round(value.from_xp)) };
}

/** The ladder as the sheet shows it: valid rungs only, one per level, ascending. */
export function parseLadder(value: unknown): LevelStep[] {
  if (!Array.isArray(value)) return [];
  const steps = new Map<number, LevelStep>();
  for (const step of value.map(parseStep)) {
    if (step && !steps.has(step.level)) steps.set(step.level, step);
  }
  return [...steps.values()].sort((a, b) => a.level - b.level);
}

/** The rung after `level`, or null on the top level or without a ladder. */
export function nextStep(ladder: readonly LevelStep[], level: number): LevelStep | null {
  return ladder.find((step) => step.level === level + 1) ?? null;
}

/** The `data` of `GET me/level`, tolerant of fields the server adds later; null without a usable level. */
export function parseMyLevel(data: unknown): MyLevel | null {
  if (!isRecord(data)) return null;
  const level = publicLevelOf({ level: data });
  if (!level) return null;
  const today = isRecord(data.today) ? data.today : {};
  const next = typeof data.next_level_xp === 'number' ? data.next_level_xp : null;
  return {
    ...level,
    xp: Math.max(0, numberOr(data.xp, 0)),
    next_level_xp: next,
    progress: Math.min(1, Math.max(0, numberOr(data.progress, next === null ? 1 : 0))),
    today: { earned: Math.max(0, numberOr(today.earned, 0)), cap: Math.max(0, numberOr(today.cap, XP_DAILY_CAP)) },
    ladder: parseLadder(data.ladder),
    ...(Array.isArray(data.rules) ? { rules: data.rules.map(parseRule).filter((rule): rule is XpRule => rule !== null) } : {}),
  };
}

async function getMyLevel(signal?: AbortSignal): Promise<MyLevel | null> {
  const body = await apiData(api.GET('/me/level', { signal }));
  return parseMyLevel(isRecord(body) && 'data' in body ? body.data : body);
}

/** The signed-in member's level (PROF-01 line and the level sheet). Per language: the title is the server's DE or EN. */
export function useMyLevel(enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const { i18n } = useTranslation();
  const sample = giftQa() !== null;
  return useQuery({
    queryKey: [...levelKeys.mine(i18n.language), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample ? fromGiftQa((source) => source.level()) : getMyLevel(signal)),
    enabled: signedIn && enabled,
    retry: sample ? false : retryUnlessAnswered,
    staleTime: 60_000,
  });
}
