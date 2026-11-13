/**
 * The shapes the safety surfaces draw (docs/reports/phase-2/m2.6-contract.md §1, §2). They are view models, not API responses:
 * `api/queries/safety.ts` maps the report and decision resources onto them once the OpenAPI export has them, so the sheet, SAFE-01
 * and SET-16 never depend on a response shape.
 */

/** What can be reported (contract §1 `target_type`). */
export type ReportTargetType = 'member' | 'vehicle' | 'photo' | 'message' | 'build_update' | 'modification' | 'comment' | 'event';

export type ReportTarget = {
  type: ReportTargetType;
  id: string;
  /** What the member sees in the sheet: "@paul.roadster", "BMW M3 (E46)", "Foto von BMW M3 (E46)". */
  label: string;
  /**
   * The member behind the target, without the @: the member themselves, or whoever owns the vehicle, photo, message or mod. The sent
   * step offers "Auch blockieren?" only when it is set and is not the viewer.
   */
  owner?: string;
};

/** Contract §1. Keys are stable; the labels live in `safety.json`. */
export const REPORT_REASONS = ['illegal', 'harassment', 'nudity', 'spam', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Asked only for `illegal`. */
export const ILLEGAL_SUB_REASONS = ['street_racing', 'hate_speech', 'privacy', 'copyright', 'other_illegal'] as const;
export type IllegalSubReason = (typeof ILLEGAL_SUB_REASONS)[number];

/** `POST reports`. `messageContext` only for a message: the server then keeps it and up to 5 messages before and after it. */
export type ReportInput = {
  targetType: ReportTargetType;
  /** The username for a member (no API exposes member ids), the ULID otherwise. */
  targetId: string;
  reason: ReportReason;
  subReason?: IllegalSubReason;
  details?: string;
  /** The statement of Art. 16(2)(d) DSA: required, and true, for illegal content. */
  goodFaith?: true;
  messageContext?: true;
};

export type ReportStatus = 'received' | 'in_review' | 'decided';

/** `reverse` (M3.2): lifts an earlier measure (staff, or an upheld appeal); it has no appeal of its own. */
export type DecisionAction = 'no_action' | 'remove_content' | 'restrict' | 'suspend' | 'reverse';

/** What came of a decision, for both viewers; a reporter never learns more than this (restrict and suspend are both `measures`). */
export type DecisionOutcome = 'no_action' | 'remove_content' | 'measures' | 'reversed';

export type AppealStatus = 'open' | 'upheld' | 'reversed';

export type SafetyTargetRef = {
  type: ReportTargetType;
  /**
   * Language-free, taken when it was reported: "@paul.roadster" for a member and for the sender of a message, the build's title for a
   * build and its photos, mods and updates; empty when the name is gone. `targetLabel()` words it ("Foto von …").
   */
  label: string;
};

/** One row of "Meine Meldungen" (`GET me/reports`). */
export type ReportSummary = {
  id: string;
  target: SafetyTargetRef;
  reason: ReportReason;
  status: ReportStatus;
  decision: { id: string; outcome: DecisionOutcome; decidedAt: string; appealStatus: AppealStatus | null } | null;
  createdAt: string;
};

/** One row of "Entscheidungen zu deinen Inhalten" (`GET me/decisions`). */
export type DecisionSummary = {
  id: string;
  target: SafetyTargetRef;
  action: DecisionAction;
  restriction: DecisionRestriction | null;
  decidedAt: string;
  appealStatus: AppealStatus | null;
};

export type RestrictionKind = 'messaging' | 'publishing' | 'suspension';

export type DecisionRestriction = { kind: RestrictionKind; until: string | null };

/** Art. 17(3)(f) DSA, in the order SAFE-01 lists them. */
export type RedressOption = 'internal_complaint' | 'out_of_court' | 'court';

/** Art. 17(3) DSA, the decider's own words. Only the affected member gets them; a reporter sees the outcome alone. */
export type StatementOfReasons = {
  /** What happened, in plain words. */
  facts: string;
  /** "Community-Richtlinien §4 (Deine Inhalte)", or a law. */
  ground: string;
};

export type DecisionAppeal = { status: AppealStatus; createdAt: string; decidedAt: string | null };

/** SAFE-01 (`GET decisions/{id}`). */
export type DecisionDetail = {
  id: string;
  /** `affected`: the member whose content or account it is about. `reporter`: someone who reported it, outcome only. */
  viewer: 'affected' | 'reporter';
  /** The affected member only; null for a reporter, who gets `outcome`. */
  action: DecisionAction | null;
  outcome: DecisionOutcome;
  /** ADR-224: `staff` when we acted on our own initiative and nobody reported it; then no copy may say "gemeldet". */
  origin: 'report' | 'staff';
  /** Affected member only: for `reverse`, the decision it lifted (SAFE-01 links to it). */
  reversesDecisionId: string | null;
  /** Affected member only, for restrict and suspend. */
  restriction: DecisionRestriction | null;
  /** Art. 17(3)(a) DSA, affected member only: what it applies to and until when (null: no end date). Null for no_action. */
  scope: { appliesTo: 'content' | 'account'; until: string | null } | null;
  target: SafetyTargetRef;
  decidedAt: string;
  /** When the members were told; the appeal period runs from here. Null until then. */
  notifiedAt: string | null;
  /** The last second of the appeal period (Europe/Berlin), from the server; when missing the app counts 6 months from `notifiedAt`. */
  appealUntil: string | null;
  /** Art. 17(3)(c) DSA: automated means found the content. Both viewers get it (Art. 16(6)). */
  automatedDetection: boolean;
  /** Art. 17(3)(c) DSA: automated means took the decision. */
  automatedDecision: boolean;
  redress: readonly RedressOption[];
  /** Art. 21 DSA: the European Commission's list of certified out-of-court dispute settlement bodies. */
  disputeSettlementUrl: string | null;
  /** The legal text the ground points to, for the link into SET-18; null for a ground in law only, and for a reporter. */
  groundDocument: 'community' | 'terms' | null;
  /** The section of that text ("4"). */
  groundSection: string | null;
  statement: StatementOfReasons | null;
  /** The viewer's own appeal: the affected member's, or a reporter's (Art. 20(1) DSA). */
  appeal: DecisionAppeal | null;
  /** The server's answer: false once the viewer appealed or the period is over. */
  canAppeal: boolean;
};
