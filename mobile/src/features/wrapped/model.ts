/**
 * WRP-01 Season Wrapped (contract m5.9e §6, spike §8): the player's fixed numbers, the 9:16 frame, season names and the Home
 * countdown rules. Pure functions, so the player and its tests share them.
 */
import type { TFunction } from 'i18next';
import { useSyncExternalStore } from 'react';

import { parseSeasonKey, type WrappedCountdown } from '@/api/queries/wrapped';
import { space } from '@/theme';

export const ROUTE = 'WRP-01';

/** How long a card stands before the next one (contract §6 "about 6 s"); paused while held, paused or a screen reader runs. */
export const STORY_CARD_MS = 6000;
/** A hold this long pauses (spike §8); a shorter touch is a tap. */
export const STORY_HOLD_MS = 180;
/** A tap is at most this long (spike §8). */
export const STORY_TAP_MAX_MS = 250;
/** The left 30 % of the card goes back, the rest goes on (spike §8). */
export const STORY_PREVIOUS_ZONE = 0.3;
/** The swipe down starts after 12 and fails after 20 sideways (spike §8). */
export const STORY_CLOSE_ACTIVE_Y = space[12];
export const STORY_CLOSE_FAIL_X: [number, number] = [-space[20], space[20]];

export type StoryKeyAction = 'next' | 'previous' | 'pause' | 'close';

/**
 * The member web's keys (spike §8): → next, ← previous, Space pause, Escape close. A focused button keeps its own Space (it presses
 * the button); every other key stays the page's.
 */
export function storyKeyAction(key: string, target: { tagName?: string; getAttribute?: (name: string) => string | null } | null): StoryKeyAction | null {
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'previous';
  if (key === 'Escape') return 'close';
  if (key === ' ') {
    const onControl = target?.tagName === 'BUTTON' || target?.getAttribute?.('role') === 'button';
    return onControl ? null : 'pause';
  }
  return null;
}

/** The card's shape: a story, 9:16 (`aspect.storyCard`). */
export const STORY_RATIO = 9 / 16;
/** The exported image (contract §5): 1080 × 1920 pixels. */
export const STORY_EXPORT = { width: 1080, height: 1920 } as const;

/** The largest 9:16 frame inside the room the player leaves for it (never below zero). */
export function storyFrame(availableWidth: number, availableHeight: number): { width: number; height: number } {
  const width = Math.max(0, Math.min(availableWidth, availableHeight * STORY_RATIO));
  return { width: Math.floor(width), height: Math.floor(width / STORY_RATIO) };
}

/** The card a link opens on: `?card=n` (1-based, clamped), else the first. */
export function initialCardIndex(param: unknown, total: number): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const n = typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(n, 1), Math.max(total, 1)) - 1;
}

/** "Saison 2027" / "Jahr 2027" ("2027 season" / "Your 2027"): the season as the copy names it. */
export function seasonName(t: TFunction, seasonKey: string): string {
  const parsed = parseSeasonKey(seasonKey);
  if (!parsed) return seasonKey;
  return t(`wrapped.season.${parsed.kind}`, { year: parsed.year });
}

/** "Dein Wrapped 2026" for the Home countdown banner (the PROF-01 row names the season on its own line, DQ-P5G-52). */
export function wrappedTitle(t: TFunction, seasonKey: string): string {
  const parsed = parseSeasonKey(seasonKey);
  if (!parsed) return t('wrapped.entry.titleFallback');
  return t(`wrapped.entry.title.${parsed.kind}`, { year: parsed.year });
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The banner shows in the last 7 days before a release (contract §1 `wrapped.countdown`). */
export const COUNTDOWN_DAYS = 7;

/** Whole days until the release, counted in local calendar days (0 = today); null when it has passed or is unreadable. */
export function countdownDays(releaseAt: string, now: Date): number | null {
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime()) || release.getTime() <= now.getTime()) return null;
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay(release) - startOfDay(now)) / DAY_MS);
}

/** Whether Home shows the countdown: the server sent one, it is ahead and at most 7 days away, and it was not dismissed. */
export function showsCountdown(countdown: WrappedCountdown | null | undefined, now: Date, dismissed: ReadonlySet<string>): countdown is WrappedCountdown {
  if (!countdown || dismissed.has(countdown.season_key)) return false;
  const days = countdownDays(countdown.release_at, now);
  return days !== null && days <= COUNTDOWN_DAYS;
}

// The banner's "dismiss for this session": in memory only, so the next app start shows it again (contract §6).
let dismissedSeasons: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function dismissCountdown(seasonKey: string): void {
  dismissedSeasons = new Set([...dismissedSeasons, seasonKey]);
  listeners.forEach((listener) => listener());
}

/** Tests only: a fresh session. */
export function __resetCountdownDismissals(): void {
  dismissedSeasons = new Set();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDismissedCountdowns(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => dismissedSeasons, () => dismissedSeasons);
}
