/**
 * Safety on the M2.6 API (docs/reports/phase-2/m2.6-api-handover.md): the `SafetyAdapter` the report sheet, SAFE-01 and SET-16 read
 * through (features/safety/data.ts). Resources are mapped onto the view models of features/safety/model.ts here, and nowhere else.
 *
 * - Every query belongs to the member signed in (its key carries the member id), so a shared device never shows one member's
 *   reports to the next. They persist like the rest of the cache, so SAFE-01 stays readable offline.
 * - Writes take the idempotency key of their intent (one per report or appeal, kept across retries) and refresh the lists after.
 */
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api, apiData, ApiError, networkError, withIdempotency } from '@/api/client';
import type { components } from '@/api/schema';
import type { Loadable, PagedList, SafetyActions, SafetyAdapter } from '@/features/safety/data';
import type { DecisionDetail, DecisionSummary, ReportInput, ReportSummary } from '@/features/safety/model';
import { useSessionStore } from '@/state/session';

type ReportSummaryData = components['schemas']['ReportSummaryResource'];
type DecisionSummaryData = components['schemas']['DecisionSummaryResource'];
type DecisionData = components['schemas']['DecisionResource'];
type StoreReportBody = components['schemas']['StoreReportRequest'];

export const SAFETY_PAGE_SIZE = 30;

export const safetyKeys = {
  all: (member: string) => ['safety', member] as const,
  reports: (member: string) => ['safety', member, 'reports'] as const,
  decisions: (member: string) => ['safety', member, 'decisions'] as const,
  decision: (member: string, id: string) => ['safety', member, 'decision', id] as const,
};

// -- Mapping

export function toReportSummary(row: ReportSummaryData): ReportSummary {
  return {
    id: row.id,
    target: { type: row.target.type, label: row.target.label },
    reason: row.reason,
    status: row.status,
    decision: row.decision
      ? { id: row.decision.id, outcome: row.decision.outcome, decidedAt: row.decision.decided_at, appealStatus: row.decision.appeal_status }
      : null,
    createdAt: row.created_at,
  };
}

export function toDecisionSummary(row: DecisionSummaryData): DecisionSummary {
  return {
    id: row.id,
    target: { type: row.target.type, label: row.target.label },
    action: row.action,
    restriction: row.restriction ? { kind: row.restriction.type, until: row.restriction.until } : null,
    decidedAt: row.decided_at,
    appealStatus: row.appeal_status,
  };
}

export function toDecision(row: DecisionData): DecisionDetail {
  return {
    id: row.id,
    viewer: row.viewer,
    action: row.action,
    outcome: row.outcome,
    origin: row.origin === 'staff' ? 'staff' : 'report',
    reversesDecisionId: row.reverses_decision_id ?? null,
    restriction: row.restriction ? { kind: row.restriction.type, until: row.restriction.until } : null,
    scope: row.scope ? { appliesTo: row.scope.applies_to, until: row.scope.until } : null,
    target: { type: row.target.type, label: row.target.label },
    decidedAt: row.decided_at,
    notifiedAt: row.notified_at,
    appealUntil: row.appeal_until,
    automatedDetection: row.automated_detection,
    automatedDecision: row.automated_decision,
    redress: row.redress,
    disputeSettlementUrl: row.dispute_settlement_url || null,
    // `law` has no document to link to.
    groundDocument: row.ground_document === 'community' || row.ground_document === 'terms' ? row.ground_document : null,
    groundSection: row.ground_section,
    statement: row.statement ? { facts: row.statement.facts, ground: row.statement.ground } : null,
    appeal: row.appeal ? { status: row.appeal.status, createdAt: row.appeal.created_at, decidedAt: row.appeal.decided_at } : null,
    canAppeal: row.can_appeal,
  };
}

/** The body of `POST reports`; `message_context` and `good_faith` are strict booleans on the server (handover §1). */
export function reportBody(input: ReportInput): StoreReportBody {
  return {
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    ...(input.subReason ? { sub_reason: input.subReason } : {}),
    ...(input.details ? { details: input.details } : {}),
    ...(input.goodFaith ? { good_faith: true } : {}),
    ...(input.messageContext ? { message_context: true } : {}),
  };
}

// -- Reads

function useMember(): string | null {
  return useSessionStore((state) => (state.status === 'member' && !state.memberChanged ? (state.member?.id ?? null) : null));
}

/** A 4xx is an answer, not an outage: retrying cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

function asApiError(error: unknown): ApiError | null {
  if (!error) return null;
  return error instanceof ApiError ? error : networkError();
}

function toLoadable<T>(query: UseQueryResult<T, unknown>): Loadable<T> {
  return {
    data: query.data,
    isPending: query.isPending,
    isPaused: query.fetchStatus === 'paused' && query.data === undefined,
    error: asApiError(query.error),
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

type Page<T> = { rows: T[]; next: string | null };

function usePaged<T>(key: readonly unknown[], member: string | null, fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>): PagedList<T> {
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: member !== null,
    retry: retryUnlessAnswered,
    // SEC-P2-12: SET-16's lists (target labels, reasons, outcomes, decisions about the member) stay off the disk, like SAFE-01.
    meta: { persist: false },
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows), [query.data]);
  return {
    data: rows,
    isPending: query.isPending,
    isPaused: query.fetchStatus === 'paused' && rows === undefined,
    error: asApiError(query.error),
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
    },
  };
}

const pageQuery = (cursor: string | null) => ({ per_page: SAFETY_PAGE_SIZE, ...(cursor ? { cursor } : {}) });

function useMyReports(): PagedList<ReportSummary> {
  const member = useMember();
  return usePaged(safetyKeys.reports(member ?? ''), member, async (cursor, signal) => {
    const page = await apiData(api.GET('/me/reports', { params: { query: pageQuery(cursor) }, signal }));
    return { rows: page.data.map(toReportSummary), next: page.meta.next_cursor };
  });
}

function useMyDecisions(): PagedList<DecisionSummary> {
  const member = useMember();
  return usePaged(safetyKeys.decisions(member ?? ''), member, async (cursor, signal) => {
    const page = await apiData(api.GET('/me/decisions', { params: { query: pageQuery(cursor) }, signal }));
    return { rows: page.data.map(toDecisionSummary), next: page.meta.next_cursor };
  });
}

function useDecision(decisionId: string | undefined): Loadable<DecisionDetail> {
  const member = useMember();
  const query = useQuery({
    queryKey: safetyKeys.decision(member ?? '', decisionId ?? ''),
    queryFn: async ({ signal }) => {
      const { data } = await apiData(api.GET('/decisions/{decision}', { params: { path: { decision: decisionId ?? '' } }, signal }));
      return toDecision(data);
    },
    enabled: member !== null && Boolean(decisionId),
    retry: retryUnlessAnswered,
    // ADR-202: a statement of reasons stays in memory only, never in the persisted cache of a shared device.
    meta: { persist: false },
  });
  return toLoadable(query);
}

// -- Writes

export function createSafetyActions(client: QueryClient, member: string | null): SafetyActions {
  const refresh = (decisionId?: string) => {
    if (!member) return;
    void client.invalidateQueries({ queryKey: safetyKeys.reports(member) });
    void client.invalidateQueries({ queryKey: safetyKeys.decisions(member) });
    if (decisionId) void client.invalidateQueries({ queryKey: safetyKeys.decision(member, decisionId) });
  };
  return {
    report: async (input, idempotencyKey) => {
      try {
        const { data } = await apiData(api.POST('/reports', { body: reportBody(input), ...withIdempotency(idempotencyKey) }));
        return { id: data.id, status: data.status };
      } finally {
        // Also after `already_reported` or `idempotency_key_reused`: SET-16 shows what the server has.
        refresh();
      }
    },
    appeal: async (decisionId, text, idempotencyKey) => {
      try {
        await apiData(
          api.POST('/decisions/{decision}/appeal', { params: { path: { decision: decisionId } }, body: { text }, ...withIdempotency(idempotencyKey) }),
        );
      } finally {
        // Also after `appeal_exists` or `appeal_period_over`: SAFE-01 shows the state the server has.
        refresh(decisionId);
      }
    },
  };
}

function useActions(): SafetyActions {
  const client = useQueryClient();
  const member = useMember();
  return useMemo(() => createSafetyActions(client, member), [client, member]);
}

export const safetyAdapter: SafetyAdapter = {
  available: true,
  useMyReports,
  useMyDecisions,
  useDecision,
  useActions,
};
