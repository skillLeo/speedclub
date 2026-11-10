/**
 * The narrow seam between the safety surfaces and the API (m2.6-api-handover). The report sheet, SAFE-01 and SET-16 read and write
 * only through a `SafetyAdapter`. `api/queries/safety.ts` implements it with TanStack Query and is the context's default, so no
 * provider is needed; tests hand in a fake, and `unavailableSafety` (every read "not available", `available` false, so no entry point
 * offers "Melden") stays for a build without the API.
 */
import { createContext, use } from 'react';

import { ApiError } from '@/api/client';
import { safetyAdapter } from '@/api/queries/safety';

import type { DecisionDetail, DecisionSummary, ReportInput, ReportStatus, ReportSummary } from './model';

export type Loadable<T> = {
  data: T | undefined;
  /** The first load, nothing to show yet. */
  isPending: boolean;
  /** Paused for the connection with nothing cached: the offline state. */
  isPaused: boolean;
  error: ApiError | null;
  isFetching: boolean;
  refetch: () => void;
};

export type PagedList<T> = Loadable<readonly T[]> & {
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
};

export type ReportReceipt = { id: string; status: ReportStatus };

/** Writes. Each resolves once the server answered, and rejects with an `ApiError`. */
export type SafetyActions = {
  /** `POST reports`. The key belongs to one report intent: a retry of the same report sends it again. */
  report: (input: ReportInput, idempotencyKey: string) => Promise<ReportReceipt>;
  /** `POST decisions/{id}/appeal`. */
  appeal: (decisionId: string, text: string, idempotencyKey: string) => Promise<void>;
};

export type SafetyAdapter = {
  /** False until the API exists: the entry points leave "Melden" out. */
  available: boolean;
  /** SET-16, "Meine Meldungen". */
  useMyReports: () => PagedList<ReportSummary>;
  /** SET-16, "Entscheidungen zu deinen Inhalten". */
  useMyDecisions: () => PagedList<DecisionSummary>;
  /** SAFE-01. */
  useDecision: (decisionId: string | undefined) => Loadable<DecisionDetail>;
  useActions: () => SafetyActions;
};

export function unavailableError(): ApiError {
  return new ApiError({ kind: 'not_found', status: 404, code: 'safety_unavailable', message: '' });
}

export function isUnavailable(error: ApiError | null): boolean {
  return error?.code === 'safety_unavailable';
}

function unavailable<T>(): Loadable<T> {
  return { data: undefined, isPending: false, isPaused: false, error: unavailableError(), isFetching: false, refetch: () => undefined };
}

function unavailableList<T>(): PagedList<T> {
  return { ...unavailable<readonly T[]>(), hasMore: false, isLoadingMore: false, loadMore: () => undefined };
}

const reject = () => Promise.reject(unavailableError());
const NO_ACTIONS: SafetyActions = { report: reject, appeal: reject };

export const unavailableSafety: SafetyAdapter = {
  available: false,
  useMyReports: () => unavailableList<ReportSummary>(),
  useMyDecisions: () => unavailableList<DecisionSummary>(),
  useDecision: () => unavailable<DecisionDetail>(),
  useActions: () => NO_ACTIONS,
};

export const SafetyContext = createContext<SafetyAdapter>(safetyAdapter);

export function useSafety(): SafetyAdapter {
  return use(SafetyContext);
}
