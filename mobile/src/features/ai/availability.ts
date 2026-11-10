/**
 * When an [AI] surface shows (M3.7 §2, ADR-242): its flag is on in app-config, a member is signed in (every endpoint is `member`),
 * it is no view-as tab (read-only, and no member content leaves for a provider on the team's behalf), and for the suggestion features
 * the member's "KI-Vorschläge" opt-in is on. Translation runs on an explicit tap and needs no opt-in.
 */
import type { TFunction } from 'i18next';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { AI_FLAGS, type AiFlag } from '@/api/queries/ai';
import { useMemberSettings } from '@/api/queries/settings';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { now } from '@/lib/clock';
import { qaForcesFlag } from '@/lib/qa';
import { useSessionStore } from '@/state/session';

/** The suggestion flags SET-07's "KI-Vorschläge" switch governs. */
export const SUGGESTION_FLAGS: readonly AiFlag[] = [AI_FLAGS.search, AI_FLAGS.mods, AI_FLAGS.photos, AI_FLAGS.description];

export function useAiAvailable(flag: AiFlag): boolean {
  const on = useFlag(flag);
  const member = useSessionStore((state) => state.status === 'member');
  const viewAs = useViewAsReadOnly();
  const settings = useMemberSettings();
  if (!on || !member || viewAs) return false;
  // Non-production visual QA (`qaFlags`): the surface shows without the opt-in, as the matrix member may not have one.
  if (flag === AI_FLAGS.translate || qaForcesFlag(flag)) return true;
  return settings.data?.ai_suggestions === true;
}

/** Whether any suggestion feature is switched on, so SET-07 offers the opt-in. */
export function useAnySuggestionFlag(): boolean {
  const search = useFlag(AI_FLAGS.search);
  const mods = useFlag(AI_FLAGS.mods);
  const photos = useFlag(AI_FLAGS.photos);
  const description = useFlag(AI_FLAGS.description);
  return search || mods || photos || description;
}

/** An answer after which the surface goes away: the flag went off on the server, or the opt-in is gone. */
export function hidesAiSurface(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'feature_disabled' || error.code === 'ai_opt_in_required');
}

/** 403 `email_not_verified` (ADR-252): the note under the surface offers the way to verify the address. */
export function needsEmailVerification(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'email_not_verified';
}

/** What an AI surface says under itself after a request: the sentence, and whether the way to verify the address goes with it. */
export type AiNoteState = { text: string; verify: boolean };

export function aiNoteFor(t: TFunction, error: unknown): AiNoteState {
  return { text: aiErrorMessage(t, error), verify: needsEmailVerification(error) };
}

// -- Code review phase-3-final SF-6: 429 `ai_daily_limit` (the member's share, ADR-252) and 503 `ai_budget_exhausted` (the feature's
// budget) hold until the next day. Every further tap would fail the same way, so from then on the feature's surfaces show the limit
// sentence only, without "Erneut versuchen" or the action, for that member and day. Kept in memory: a new start may ask once more.

type AiDayEnd = 'ai_daily_limit' | 'ai_budget_exhausted';
type AiBlock = { member: string; day: string; code: AiDayEnd };

const blocks = new Map<AiFlag, AiBlock>();
const blockListeners = new Set<() => void>();

function today(): string {
  return now().toDateString();
}

function memberKey(): string | null {
  const { status, member } = useSessionStore.getState();
  return status === 'member' ? (member?.id ?? '') : null;
}

function dayEndCode(error: unknown): AiDayEnd | null {
  if (!(error instanceof ApiError)) return null;
  return error.code === 'ai_daily_limit' || error.code === 'ai_budget_exhausted' ? error.code : null;
}

/** Whether the answer ends the feature for today. */
export function endsAiForToday(error: unknown): boolean {
  return dayEndCode(error) !== null;
}

/** Call with every failed request of a feature: an answer that ends it for today is remembered for the member signed in. */
export function recordAiFailure(flag: AiFlag, error: unknown): void {
  const code = dayEndCode(error);
  const member = memberKey();
  if (code === null || member === null) return;
  blocks.set(flag, { member, day: today(), code });
  blockListeners.forEach((listener) => listener());
}

function subscribeBlocks(listener: () => void): () => void {
  blockListeners.add(listener);
  return () => {
    blockListeners.delete(listener);
  };
}

/** The limit's sentence while the feature is used up today for the member signed in, else null. */
export function useAiDayEnd(flag: AiFlag): AiNoteState | null {
  const { t } = useTranslation('common');
  const member = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? '') : null));
  const block = useSyncExternalStore(subscribeBlocks, () => blocks.get(flag), () => undefined);
  if (!block || member === null || block.member !== member || block.day !== today()) return null;
  return { text: block.code === 'ai_daily_limit' ? t('ai.errors.dailyLimit') : t('ai.errors.budget'), verify: false };
}

/** Tests only. */
export function resetAiDayEndsForTests(): void {
  blocks.clear();
  blockListeners.forEach((listener) => listener());
}

/** The sentence for a failed AI request; never a raw code. */
export function aiErrorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t('ai.errors.failed');
  switch (error.code) {
    case 'ai_refused':
      return t('ai.errors.refused');
    case 'ai_unverifiable':
      return t('ai.errors.unverifiable');
    case 'ai_unavailable':
      return t('ai.errors.unavailable');
    case 'ai_budget_exhausted':
      return t('ai.errors.budget');
    case 'ai_opt_in_required':
      return t('ai.errors.optIn');
    case 'feature_disabled':
      return t('ai.errors.disabled');
    // ADR-252 (SEC-P3-19): AI needs a verified address, and each member has a share of a feature's daily budget.
    case 'email_not_verified':
      return t('ai.errors.emailNotVerified');
    case 'ai_daily_limit':
      return t('ai.errors.dailyLimit');
    default:
      break;
  }
  if (error.kind === 'rate_limited') return t('ai.errors.rateLimited');
  if (error.kind === 'network') return t('ai.errors.network');
  if (error.kind === 'conflict') return t('ai.errors.processing');
  return t('ai.errors.failed');
}

/** `aiErrorMessage` with the common namespace bound. */
export function useAiErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('common');
  return (error) => aiErrorMessage(t, error);
}
