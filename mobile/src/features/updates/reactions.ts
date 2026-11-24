/**
 * Client round 4 (11 R4-2.2): the one-tap heart "Gefällt mir" before the four car reactions (Stark · Sauber · Tief · Laut). Pure, so
 * Jest covers it directly. Counts stay with the owner (ADR-413): nothing here knows one.
 */
import type { ReactionKey } from '@/api/queries/social2';

/** A tap gives this reaction; a second tap takes any reaction back. */
export const LIKE = 'like' as const satisfies ReactionKey;

/** The picker's order: the heart first, then the car reactions (also the order of the owner's summary). */
export const LIKE_REACTION_ORDER: readonly ReactionKey[] = ['like', 'strong', 'clean', 'low', 'loud'];

export function isLikeReactionKey(value: string | null | undefined): value is ReactionKey {
  return typeof value === 'string' && (LIKE_REACTION_ORDER as readonly string[]).includes(value);
}

/**
 * The trigger's accessible name: "Gefällt mir" while nothing or the heart is chosen (the picker adds nothing to its own name),
 * "Reagieren" with a car reaction, to which the picker adds the reaction ("Reagieren: Stark").
 */
export function reactionTriggerLabel(mine: string | null | undefined, labels: { like: string; react: string }): string {
  return mine && mine !== LIKE ? labels.react : labels.like;
}
