/**
 * SET-16's one list: "Meine Meldungen", then "Entscheidungen zu deinen Inhalten", each newest first and each with its own empty
 * row, so a member who has only one kind still sees what the other section is for. Each section is one FS-12 inset group
 * (DQ-421): a row knows whether it opens or closes its group's card, and the empty row is the whole card.
 */
import type { DecisionSummary, ReportStatus, ReportSummary } from './model';

export type ReportsSection = 'mine' | 'about';

export type ReportsItem =
  | { kind: 'header'; key: string; section: ReportsSection }
  | { kind: 'empty'; key: string; section: ReportsSection }
  | { kind: 'report'; key: string; report: ReportSummary; first: boolean; last: boolean }
  | { kind: 'decision'; key: string; decision: DecisionSummary; first: boolean; last: boolean }
  /** The section has another page: "Weitere laden" at its end. */
  | { kind: 'more'; key: string; section: ReportsSection };

function newestFirst<T>(rows: readonly T[], at: (row: T) => string): T[] {
  return [...rows].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
}

export function reportsItems(
  reports: readonly ReportSummary[],
  decisions: readonly DecisionSummary[],
  more: { mine: boolean; about: boolean } = { mine: false, about: false },
): ReportsItem[] {
  const items: ReportsItem[] = [{ kind: 'header', key: 'header.mine', section: 'mine' }];
  const mine = newestFirst(reports, (row) => row.createdAt);
  if (mine.length === 0) items.push({ kind: 'empty', key: 'empty.mine', section: 'mine' });
  mine.forEach((report, index) =>
    items.push({ kind: 'report', key: `report.${report.id}`, report, first: index === 0, last: index === mine.length - 1 }),
  );
  if (more.mine && mine.length > 0) items.push({ kind: 'more', key: 'more.mine', section: 'mine' });

  items.push({ kind: 'header', key: 'header.about', section: 'about' });
  const about = newestFirst(decisions, (row) => row.decidedAt);
  if (about.length === 0) items.push({ kind: 'empty', key: 'empty.about', section: 'about' });
  about.forEach((decision, index) =>
    items.push({ kind: 'decision', key: `decision.${decision.id}`, decision, first: index === 0, last: index === about.length - 1 }),
  );
  if (more.about && about.length > 0) items.push({ kind: 'more', key: 'more.about', section: 'about' });
  return items;
}

/** The pill of a report: a decided report without a decision row yet still says "Entschieden". */
export function reportStatus(report: ReportSummary): ReportStatus {
  return report.decision ? 'decided' : report.status;
}

/** The decision a row opens in SAFE-01, or null: a report still under review opens nothing. */
export function decisionOf(item: ReportsItem): string | null {
  if (item.kind === 'report') return item.report.decision?.id ?? null;
  if (item.kind === 'decision') return item.decision.id;
  return null;
}
