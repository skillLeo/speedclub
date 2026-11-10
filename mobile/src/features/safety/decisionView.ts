/**
 * What SAFE-01 says, by viewer (contract §2): the affected member gets the full statement of reasons of Art. 17(3) DSA; a reporter
 * gets the outcome only, never facts about the other member, and restrict and suspend both read as "Maßnahmen ergriffen".
 */
import type { DecisionDetail } from './model';

export type DecisionSection = 'decided' | 'content' | 'facts' | 'ground' | 'automated' | 'redress';

export function decisionSections(decision: DecisionDetail): readonly DecisionSection[] {
  // Art. 16(6) DSA tells the notifier about automated means too.
  if (decision.viewer === 'reporter') return ['decided', 'automated', 'redress'];
  // ADR-224: a reversal lifts a measure, so there is nothing to appeal and no redress to list.
  const redress: readonly DecisionSection[] = decision.action === 'reverse' ? [] : ['redress'];
  return decision.statement
    ? ['decided', 'content', 'facts', 'ground', 'automated', ...redress]
    : ['decided', 'content', 'automated', ...redress];
}

/** Whether a decision lifted an earlier one (ADR-224): its own title, what came back, a link to the original, no appeal. */
export function isReversal(decision: Pick<DecisionDetail, 'action'>): boolean {
  return decision.action === 'reverse';
}

/**
 * The `decision.*` keys of the "automated means" section. ADR-224: when staff acted on their own initiative nobody reported the
 * content, so the line says we looked ourselves instead of "zum Beispiel durch eine Meldung".
 */
export function automatedKeys(decision: Pick<DecisionDetail, 'automatedDetection' | 'automatedDecision' | 'origin'>): [string, string] {
  const detection = decision.automatedDetection
    ? 'decision.detectionYes'
    : decision.origin === 'staff'
      ? 'decision.detectionStaff'
      : 'decision.detectionNo';
  return [detection, decision.automatedDecision ? 'decision.decisionAutomated' : 'decision.decisionHuman'];
}

/** The `decision.outcome.*` key and its until date for the affected member. */
export function affectedOutcome(decision: DecisionDetail): { key: string; until: string | null } {
  // The affected member always has `action`; without it, the outcome says as much as a reporter would learn.
  if (decision.action === null) {
    return { key: decision.outcome === 'measures' ? 'decision.outcome.restrict' : `decision.outcome.${decision.outcome}`, until: null };
  }
  switch (decision.action) {
    case 'no_action':
      return { key: 'decision.outcome.no_action', until: null };
    case 'remove_content':
      return { key: 'decision.outcome.remove_content', until: null };
    case 'restrict': {
      const kind = decision.restriction?.kind === 'publishing' ? 'Publishing' : 'Messaging';
      // A restriction without its kind says what it does in general.
      if (!decision.restriction) return { key: 'decision.outcome.restrict', until: null };
      const until = decision.restriction?.until ?? null;
      return { key: `decision.outcome.restrict${kind}${until ? 'Until' : ''}`, until };
    }
    case 'suspend': {
      const until = decision.restriction?.until ?? null;
      return { key: until ? 'decision.outcome.suspendUntil' : 'decision.outcome.suspend', until };
    }
    case 'reverse':
      // What came back: the account's use, or the content, visible again.
      if (decision.target.type === 'member') return { key: 'decision.outcome.reverseAccount', until: null };
      return { key: decision.target.label ? 'decision.outcome.reverseContent' : 'decision.outcome.reverse', until: null };
  }
}

/** The `decision.reporterOutcome.*` key: what a reporter may learn, from the server's `outcome` (handover §11.2). */
export function reporterOutcome(decision: Pick<DecisionDetail, 'outcome'>): string {
  return `decision.reporterOutcome.${decision.outcome}`;
}

/** The `decision.scope.*` key and date of Art. 17(3)(a): what it applies to and until when. Null without a scope. */
export function scopeLine(decision: Pick<DecisionDetail, 'scope'>): { key: string; until: string | null } | null {
  const scope = decision.scope;
  if (!scope) return null;
  return { key: `decision.scope.${scope.appliesTo}${scope.until ? 'Until' : 'Open'}`, until: scope.until };
}
