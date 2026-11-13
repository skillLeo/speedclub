/**
 * SM12 message send (09 §4.7): where a text left the composer, by the outbox client id, so its bubble can start there. An origin
 * lives only for the moment of sending: a bubble drawn later (scrolled back, a restored outbox) settles in place.
 */
import type { Rect } from '@/ui/motion/math';

/** Long enough for the list to draw the new bubble, short enough that a re-render later never replays the morph. */
export const SEND_ORIGIN_TTL_MS = 1_500;

const origins = new Map<string, { rect: Rect; at: number }>();

export function rememberSendOrigin(clientId: string, rect: Rect | null, at: number = Date.now()): void {
  for (const [key, entry] of origins) if (at - entry.at > SEND_ORIGIN_TTL_MS) origins.delete(key);
  if (rect) origins.set(clientId, { rect, at });
}

export function sendOriginFor(clientId: string | null, at: number = Date.now()): Rect | null {
  if (!clientId) return null;
  const entry = origins.get(clientId);
  if (!entry) return null;
  if (at - entry.at > SEND_ORIGIN_TTL_MS) {
    origins.delete(clientId);
    return null;
  }
  return entry.rect;
}

export function __resetSendOriginsForTests(): void {
  origins.clear();
}
