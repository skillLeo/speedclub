/**
 * The report flow of SAFE (04_SCREEN_REGISTER, overlays): reason → sub-reason (only for `illegal`) → details → sent. Pure, so the
 * step rules are tested without the sheet.
 */
import { ApiError } from '@/api/client';

import type { IllegalSubReason, ReportInput, ReportReason, ReportTarget } from './model';

/** Contract §1: `details` ≤ 1000. */
export const DETAILS_MAX_LENGTH = 1000;
/** Art. 16(2)(a) DSA: a notice of illegal content explains why, in at least this many characters (handover §11.5). */
export const DETAILS_MIN_ILLEGAL = 10;
/** Contract §1: `appeals.text` ≤ 2000. */
export const APPEAL_MAX_LENGTH = 2000;
/** Contract §2: the server keeps the reported message and up to this many before and after it. */
export const MESSAGE_CONTEXT_SIZE = 5;

export type ReportStep = 'reason' | 'subReason' | 'details' | 'sent' | 'duplicate';

export type ReportFlowState = {
  step: ReportStep;
  reason: ReportReason | null;
  subReason: IllegalSubReason | null;
};

export const INITIAL_FLOW: ReportFlowState = { step: 'reason', reason: null, subReason: null };

export type ReportFlowEvent =
  | { type: 'chooseReason'; reason: ReportReason }
  | { type: 'chooseSubReason'; subReason: IllegalSubReason }
  | { type: 'back' }
  | { type: 'sent' }
  | { type: 'duplicate' }
  | { type: 'reset' };

/** Only illegal content asks which law it breaks. */
export function needsSubReason(reason: ReportReason | null): boolean {
  return reason === 'illegal';
}

export function reportFlow(state: ReportFlowState, event: ReportFlowEvent): ReportFlowState {
  switch (event.type) {
    case 'chooseReason':
      return { step: needsSubReason(event.reason) ? 'subReason' : 'details', reason: event.reason, subReason: null };
    case 'chooseSubReason':
      return state.reason === 'illegal' ? { ...state, step: 'details', subReason: event.subReason } : state;
    case 'back':
      if (state.step === 'details') return { ...state, step: needsSubReason(state.reason) ? 'subReason' : 'reason' };
      if (state.step === 'subReason') return { ...state, step: 'reason', subReason: null };
      return state;
    case 'sent':
      return state.step === 'details' ? { ...state, step: 'sent' } : state;
    case 'duplicate':
      return state.step === 'details' ? { ...state, step: 'duplicate' } : state;
    case 'reset':
      return INITIAL_FLOW;
  }
}

/** Whether the details step may send: a reason, and the sub-reason when it needs one. */
export function canSend(state: ReportFlowState): boolean {
  if (state.step !== 'details' || state.reason === null) return false;
  return !needsSubReason(state.reason) || state.subReason !== null;
}

/**
 * The body of `POST reports`. Empty details stay out; `sub_reason` and the good-faith statement (Art. 16(2)(d) DSA, shown above the
 * send button) only for illegal content; `message_context` only for a message.
 */
export function buildReportInput(target: ReportTarget, state: ReportFlowState, details: string): ReportInput | null {
  if (!canSend(state) || state.reason === null) return null;
  const text = details.trim();
  if (detailsProblem(state.reason, details) !== null) return null;
  return {
    targetType: target.type,
    targetId: target.id,
    reason: state.reason,
    ...(state.reason === 'illegal' && state.subReason ? { subReason: state.subReason, goodFaith: true as const } : {}),
    ...(text ? { details: text } : {}),
    ...(target.type === 'message' ? { messageContext: true as const } : {}),
  };
}

/** What is wrong with the details for this reason: required (illegal, under 10 characters), too long, or nothing. */
export function detailsProblem(reason: ReportReason | null, details: string): 'required' | 'tooLong' | null {
  if (details.length > DETAILS_MAX_LENGTH) return 'tooLong';
  if (reason === 'illegal' && details.trim().length < DETAILS_MIN_ILLEGAL) return 'required';
  return null;
}

/**
 * Whether a target can still be reported after a block. Only messages can (handover §1: a participant may report across a block); a
 * member, a build and its content answer 404 to a blocked viewer, so "Blockieren und melden" reports those first.
 */
export function reportableAfterBlock(target: Pick<ReportTarget, 'type'>): boolean {
  return target.type === 'message';
}

/** The member to offer "Auch blockieren?" for: the target's member, unless it is the viewer or already blocked in this flow. */
export function blockOffer(target: ReportTarget, viewerUsername: string | null, alreadyBlocked: boolean): string | null {
  if (alreadyBlocked || !target.owner) return null;
  if (viewerUsername && target.owner.toLowerCase() === viewerUsername.toLowerCase()) return null;
  return target.owner;
}

export type ReportFailure = 'duplicate' | 'rate_limited' | 'offline' | 'gone' | 'own' | 'invalid' | 'server';

/**
 * What a failed `POST reports` means for the sheet (m2.6-api-handover §1). A duplicate (409 `already_reported`) is no failure to the
 * member: it ends in its own calm step, and so does `idempotency_key_reused`.
 */
export function reportFailure(error: unknown): ReportFailure {
  if (!(error instanceof ApiError)) return 'offline';
  // `idempotency_key_reused`: a report went in under this key already, so the member sees that state (the adapter refreshes).
  if (error.code === 'already_reported' || error.code === 'idempotency_key_reused') return 'duplicate';
  if (error.kind === 'rate_limited') return 'rate_limited';
  if (error.kind === 'network') return 'offline';
  if (error.kind === 'not_found') return 'gone';
  if (error.code === 'own_content') return 'own';
  if (error.kind === 'validation') return 'invalid';
  return 'server';
}

/** Whether pressing send again can help. */
export function isRetryable(failure: ReportFailure): boolean {
  return failure === 'offline' || failure === 'server' || failure === 'invalid';
}
