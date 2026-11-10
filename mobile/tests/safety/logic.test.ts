// M2.6 pure rules: the report steps (sub-reason only for illegal), the request body, the block offer, the failure mapping, the
// appeal deadline in Berlin calendar months and SET-16's grouping.
import { ApiError } from '@/api/client';
import i18n from '@/i18n';
import { appealDeadline, appealOption, decisionDeadline } from '@/features/safety/appeal';
import { affectedOutcome, decisionSections, reporterOutcome, scopeLine } from '@/features/safety/decisionView';
import { targetLabel } from '@/features/safety/labels';
import type { DecisionDetail, DecisionSummary, ReportSummary, ReportTarget } from '@/features/safety/model';
import {
  blockOffer,
  buildReportInput,
  canSend,
  DETAILS_MAX_LENGTH,
  detailsProblem,
  INITIAL_FLOW,
  isRetryable,
  reportableAfterBlock,
  reportFailure,
  reportFlow,
  type ReportFlowEvent,
  type ReportFlowState,
} from '@/features/safety/reportFlow';
import { decisionOf, reportsItems, reportStatus } from '@/features/safety/reportsList';

const vehicle: ReportTarget = { type: 'vehicle', id: '01JVEH', label: 'BMW M3 (E46)', owner: 'paul.roadster' };
const message: ReportTarget = { type: 'message', id: '01JMSG', label: 'Nachricht von @max.e46', owner: 'max.e46' };

function run(...events: ReportFlowEvent[]): ReportFlowState {
  return events.reduce(reportFlow, INITIAL_FLOW);
}

function apiError(kind: ApiError['kind'], status: number, code: string = kind): ApiError {
  return new ApiError({ kind, status, code, message: 'Antwort des Servers' });
}

describe('report steps', () => {
  it('asks for the sub-reason only for illegal content', () => {
    expect(run({ type: 'chooseReason', reason: 'illegal' }).step).toBe('subReason');
    for (const reason of ['harassment', 'nudity', 'spam', 'impersonation', 'other'] as const) {
      expect(run({ type: 'chooseReason', reason }).step).toBe('details');
    }
    const illegal = run({ type: 'chooseReason', reason: 'illegal' }, { type: 'chooseSubReason', subReason: 'street_racing' });
    expect(illegal).toEqual({ step: 'details', reason: 'illegal', subReason: 'street_racing' });
  });

  it('ignores a sub-reason for any other reason', () => {
    const spam = run({ type: 'chooseReason', reason: 'spam' }, { type: 'chooseSubReason', subReason: 'copyright' });
    expect(spam.subReason).toBeNull();
  });

  it('goes back the way it came', () => {
    const illegal = run({ type: 'chooseReason', reason: 'illegal' }, { type: 'chooseSubReason', subReason: 'privacy' }, { type: 'back' });
    expect(illegal.step).toBe('subReason');
    expect(reportFlow(illegal, { type: 'back' })).toEqual({ step: 'reason', reason: 'illegal', subReason: null });
    expect(run({ type: 'chooseReason', reason: 'harassment' }, { type: 'back' }).step).toBe('reason');
  });

  it('sends only from the details step with a complete reason', () => {
    expect(canSend(run({ type: 'chooseReason', reason: 'spam' }))).toBe(true);
    expect(canSend(run({ type: 'chooseReason', reason: 'illegal' }))).toBe(false);
    expect(canSend(INITIAL_FLOW)).toBe(false);
    expect(reportFlow(INITIAL_FLOW, { type: 'sent' })).toBe(INITIAL_FLOW);
    expect(run({ type: 'chooseReason', reason: 'spam' }, { type: 'sent' }).step).toBe('sent');
    expect(run({ type: 'chooseReason', reason: 'spam' }, { type: 'duplicate' }).step).toBe('duplicate');
  });

  it('builds the body: trimmed details, sub_reason only for illegal, message_context only for a message', () => {
    const spam = run({ type: 'chooseReason', reason: 'spam' });
    expect(buildReportInput(vehicle, spam, '   ')).toEqual({ targetType: 'vehicle', targetId: '01JVEH', reason: 'spam' });
    expect(buildReportInput(vehicle, spam, '  Verkauft Fake-Felgen.  ')).toEqual({
      targetType: 'vehicle',
      targetId: '01JVEH',
      reason: 'spam',
      details: 'Verkauft Fake-Felgen.',
    });
    const illegal = run({ type: 'chooseReason', reason: 'illegal' }, { type: 'chooseSubReason', subReason: 'street_racing' });
    expect(buildReportInput(message, illegal, ' Ruft zum Rennen auf der B27 auf. ')).toEqual({
      targetType: 'message',
      targetId: '01JMSG',
      reason: 'illegal',
      subReason: 'street_racing',
      details: 'Ruft zum Rennen auf der B27 auf.',
      goodFaith: true,
      messageContext: true,
    });
    expect(buildReportInput(vehicle, INITIAL_FLOW, 'x')).toBeNull();
  });

  it('keeps the details limit of the contract, and requires 10 characters for illegal content', () => {
    expect(DETAILS_MAX_LENGTH).toBe(1000);
    expect(detailsProblem('illegal', '   kurz   ')).toBe('required');
    expect(detailsProblem('illegal', 'Gestohlenes Foto')).toBeNull();
    expect(detailsProblem('spam', '')).toBeNull();
    expect(detailsProblem('spam', 'x'.repeat(1001))).toBe('tooLong');
    const illegal = run({ type: 'chooseReason', reason: 'illegal' }, { type: 'chooseSubReason', subReason: 'copyright' });
    expect(buildReportInput(vehicle, illegal, 'zu kurz')).toBeNull();
  });

  it('blocks first only for a message in "Blockieren und melden"', () => {
    expect(reportableAfterBlock({ type: 'message' })).toBe(true);
    for (const type of ['member', 'vehicle', 'photo', 'build_update', 'modification'] as const) expect(reportableAfterBlock({ type })).toBe(false);
  });

  it('offers the block for the member behind the target, never for yourself or twice', () => {
    expect(blockOffer(vehicle, 'lukas.sc', false)).toBe('paul.roadster');
    expect(blockOffer(vehicle, 'Paul.Roadster', false)).toBeNull();
    expect(blockOffer(vehicle, 'lukas.sc', true)).toBeNull();
    expect(blockOffer({ type: 'photo', id: 'p1', label: 'Foto' }, 'lukas.sc', false)).toBeNull();
  });

  it('maps failures: duplicate, 429, offline, gone, own content, 422, server', () => {
    expect(reportFailure(apiError('conflict', 409, 'already_reported'))).toBe('duplicate');
    // A key used before: a report went in under it, so the member sees that state.
    expect(reportFailure(apiError('conflict', 409, 'idempotency_key_reused'))).toBe('duplicate');
    expect(reportFailure(apiError('conflict', 409, 'something_else'))).toBe('server');
    expect(reportFailure(apiError('rate_limited', 429))).toBe('rate_limited');
    expect(reportFailure(apiError('network', 0))).toBe('offline');
    expect(reportFailure(new Error('boom'))).toBe('offline');
    expect(reportFailure(apiError('not_found', 404))).toBe('gone');
    expect(reportFailure(apiError('validation', 422, 'own_content'))).toBe('own');
    expect(reportFailure(apiError('validation', 422))).toBe('invalid');
    expect(reportFailure(apiError('server', 500))).toBe('server');
    expect(isRetryable('server')).toBe(true);
    expect(isRetryable('rate_limited')).toBe(false);
    expect(isRetryable('own')).toBe(false);
  });
});

function decision(overrides: Partial<DecisionDetail> = {}): DecisionDetail {
  return {
    id: '01JDEC',
    viewer: 'affected',
    action: 'remove_content',
    outcome: 'remove_content',
    origin: 'report',
    reversesDecisionId: null,
    restriction: null,
    scope: { appliesTo: 'content', until: null },
    target: { type: 'photo', label: 'Foto von VW Golf II GTI' },
    decidedAt: '2026-11-02T09:00:00Z',
    notifiedAt: '2026-11-02T09:05:00Z',
    appealUntil: null,
    automatedDetection: false,
    automatedDecision: false,
    redress: ['internal_complaint', 'out_of_court', 'court'],
    disputeSettlementUrl: 'https://ec.europa.eu/digital-services-act/out-of-court-dispute-settlement',
    groundDocument: 'community',
    groundSection: '4',
    statement: { facts: 'Das Foto zeigt ein fremdes Kennzeichen.', ground: 'Community-Richtlinien §4' },
    appeal: null,
    canAppeal: true,
    ...overrides,
  };
}

describe('appeal deadline (6 months, Europe/Berlin, §§ 187, 188 BGB)', () => {
  it('ends with the day of the same number 6 months later', () => {
    const { endsAt, lastDay } = appealDeadline(new Date('2026-05-15T10:00:00Z'));
    // 16.11.2026 00:00 CET
    expect(endsAt.toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(lastDay.toISOString()).toBe('2026-11-15T22:59:59.999Z');
  });

  it('ends at the end of the month that has no such day', () => {
    expect(appealDeadline(new Date('2026-08-31T12:00:00Z')).endsAt.toISOString()).toBe('2027-02-28T23:00:00.000Z');
    expect(appealDeadline(new Date('2027-08-31T12:00:00Z')).endsAt.toISOString()).toBe('2028-02-29T23:00:00.000Z');
  });

  it('counts the Berlin day of the notice, not the UTC day, across the DST change', () => {
    // 01.04.2026 00:30 CEST is still 31 March in UTC; the deadline is the end of 01.10.2026 (CEST).
    expect(appealDeadline(new Date('2026-03-31T22:30:00Z')).endsAt.toISOString()).toBe('2026-10-01T22:00:00.000Z');
    // 30.11.2026 → 30.05.2027, summer time.
    expect(appealDeadline(new Date('2026-11-30T08:00:00Z')).endsAt.toISOString()).toBe('2027-05-30T22:00:00.000Z');
  });

  it('takes the server value as the last second of the last day, and waits for the notice', () => {
    const deadline = decisionDeadline(decision({ appealUntil: '2027-05-02T23:59:59+02:00' }));
    expect(deadline?.lastDay.toISOString()).toBe('2027-05-02T21:59:59.000Z');
    expect(deadline?.endsAt.toISOString()).toBe('2027-05-02T22:00:00.000Z');
    expect(decisionDeadline(decision({ notifiedAt: null }))).toBeNull();
    // The app's own count agrees with the server's for the same notice.
    expect(appealDeadline(new Date('2026-11-02T09:05:00Z')).endsAt.toISOString()).toBe('2027-05-02T22:00:00.000Z');
  });

  it('follows the server: can_appeal, the viewer’s own appeal, the deadline, and the redress it lists', () => {
    const inside = new Date('2027-05-02T21:59:00Z');
    const after = new Date('2027-05-02T22:00:00Z'); // 03.05.2027 00:00 CEST
    expect(appealOption(decision(), inside)).toBe('open');
    expect(appealOption(decision({ canAppeal: false }), after)).toBe('expired');
    // A reporter may appeal too (Art. 20(1) DSA), whenever the server says so.
    expect(appealOption(decision({ viewer: 'reporter', statement: null, action: 'no_action' }), inside)).toBe('open');
    expect(appealOption(decision({ redress: ['out_of_court', 'court'] }), inside)).toBe('none');
    expect(appealOption(decision({ notifiedAt: null, canAppeal: false }), inside)).toBe('waiting');
    expect(appealOption(decision({ appeal: { status: 'open', createdAt: '2026-11-03T10:00:00Z', decidedAt: null } }), inside)).toBe('pending');
    expect(appealOption(decision({ appeal: { status: 'reversed', createdAt: '2026-11-03T10:00:00Z', decidedAt: '2026-11-05T10:00:00Z' } }), inside)).toBe(
      'reversed',
    );
  });
});

describe('SAFE-01 views', () => {
  it('gives the affected member the full statement of reasons and the reporter the outcome only', () => {
    expect(decisionSections(decision())).toEqual(['decided', 'content', 'facts', 'ground', 'automated', 'redress']);
    expect(decisionSections(decision({ viewer: 'reporter', statement: null }))).toEqual(['decided', 'automated', 'redress']);
  });

  it('never tells a reporter which measure hit the other member', () => {
    // The server already collapses restrict and suspend into `measures` for a reporter (handover §11.2).
    expect(reporterOutcome(decision({ viewer: 'reporter', action: null, outcome: 'measures' }))).toBe('decision.reporterOutcome.measures');
    expect(reporterOutcome(decision({ viewer: 'reporter', action: null, outcome: 'no_action' }))).toBe('decision.reporterOutcome.no_action');
    expect(reporterOutcome(decision({ viewer: 'reporter', action: null, outcome: 'remove_content' }))).toBe('decision.reporterOutcome.remove_content');
  });

  it('words the scope and duration of Art. 17(3)(a)', () => {
    expect(scopeLine(decision())).toEqual({ key: 'decision.scope.contentOpen', until: null });
    expect(scopeLine(decision({ scope: { appliesTo: 'account', until: '2026-11-20T10:00:00+01:00' } }))).toEqual({
      key: 'decision.scope.accountUntil',
      until: '2026-11-20T10:00:00+01:00',
    });
    expect(scopeLine(decision({ scope: null }))).toBeNull();
  });

  it('words a restriction by its kind and end', () => {
    expect(affectedOutcome(decision({ action: 'restrict', restriction: { kind: 'messaging', until: '2026-11-16T09:00:00Z' } }))).toEqual({
      key: 'decision.outcome.restrictMessagingUntil',
      until: '2026-11-16T09:00:00Z',
    });
    expect(affectedOutcome(decision({ action: 'restrict', restriction: { kind: 'publishing', until: null } })).key).toBe(
      'decision.outcome.restrictPublishing',
    );
  });
});

describe('target labels', () => {
  const t = i18n.getFixedT('de', 'safety');
  it('words the language-free label by its type', () => {
    expect(targetLabel(t, { type: 'photo', label: 'Audi RS6 Avant C8' })).toBe('Foto von Audi RS6 Avant C8');
    expect(targetLabel(t, { type: 'message', label: '@paul.roadster' })).toBe('Nachricht von @paul.roadster');
    expect(targetLabel(t, { type: 'member', label: '@paul.roadster' })).toBe('@paul.roadster');
    expect(targetLabel(t, { type: 'vehicle', label: '' })).toBe('Nicht mehr verfügbar');
  });
});

describe('SET-16 grouping', () => {
  const report = (id: string, createdAt: string, extra: Partial<ReportSummary> = {}): ReportSummary => ({
    id,
    target: { type: 'vehicle', label: 'Audi RS2 Avant' },
    reason: 'spam',
    status: 'received',
    decision: null,
    createdAt,
    ...extra,
  });
  const about = (id: string, decidedAt: string): DecisionSummary => ({
    id,
    target: { type: 'photo', label: 'Foto von VW Golf II GTI' },
    action: 'remove_content',
    restriction: null,
    decidedAt,
    appealStatus: null,
  });

  it('puts both sections in order, newest first, with an empty row where a section has nothing', () => {
    const items = reportsItems([report('r1', '2026-11-01T10:00:00Z'), report('r2', '2026-11-05T10:00:00Z')], []);
    expect(items.map((item) => item.key)).toEqual(['header.mine', 'report.r2', 'report.r1', 'header.about', 'empty.about']);
    const paged = reportsItems([report('r1', '2026-11-01T10:00:00Z')], [], { mine: true, about: true });
    expect(paged.map((item) => item.key)).toEqual(['header.mine', 'report.r1', 'more.mine', 'header.about', 'empty.about']);
    expect(reportsItems([], [about('d1', '2026-11-02T09:00:00Z')]).map((item) => item.key)).toEqual([
      'header.mine',
      'empty.mine',
      'header.about',
      'decision.d1',
    ]);
  });

  it('opens SAFE-01 only where a decision exists', () => {
    const decided = report('r3', '2026-11-03T10:00:00Z', { status: 'decided', decision: { id: 'd9', outcome: 'no_action', decidedAt: '2026-11-04T10:00:00Z', appealStatus: null } });
    const [, first, second] = reportsItems([decided, report('r4', '2026-11-01T10:00:00Z', { status: 'in_review' })], []);
    expect(first && decisionOf(first)).toBe('d9');
    expect(second && decisionOf(second)).toBeNull();
    expect(reportStatus(decided)).toBe('decided');
    expect(decisionOf(reportsItems([], [about('d1', '2026-11-02T09:00:00Z')])[3]!)).toBe('d1');
  });
});
