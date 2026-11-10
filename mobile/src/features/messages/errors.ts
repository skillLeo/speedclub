import { ApiError, isConsentRequired } from '@/api/client';

import type { DeliveryFailure } from './model';

/**
 * Maps the API layer's errors onto the reasons the outbox and the bubbles know (m2.4-api-handover §1): 403 `cannot_message`,
 * 409 `request_pending`, 409 `idempotency_key_reused` (the same client id with another payload: never sent again as it is),
 * 422, 429, and no answer at all. 403 `consent_required` (ADR-245) is no closed conversation: the message waits for the accept
 * (code review phase-3-final SF-2).
 */
export function classifyError(error: unknown, fallback: string): DeliveryFailure {
  if (!(error instanceof ApiError)) return { reason: 'network', message: fallback };
  const message = error.message || fallback;
  if (error.kind === 'network') return { reason: 'network', message };
  if (error.kind === 'rate_limited') return { reason: 'rate_limited', message, retryAfter: error.retryAfter };
  if (error.code === 'request_pending') return { reason: 'request_pending', message };
  if (isConsentRequired(error)) return { reason: 'consent_required', message };
  if (error.code === 'cannot_message' || error.kind === 'forbidden' || error.kind === 'restricted' || error.kind === 'not_found') {
    return { reason: 'cannot_message', message };
  }
  if (error.kind === 'validation' || error.kind === 'conflict') return { reason: 'invalid', message };
  return { reason: 'server', message, retryAfter: error.retryAfter };
}
