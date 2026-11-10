import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useRequireAuth, useSessionStore } from '@/state/session';

import { BlockDialog } from './BlockDialog';
import { useSafety } from './data';
import type { ReportTarget } from './model';
import { reportableAfterBlock } from './reportFlow';
import { ReportSheet } from './ReportSheet';

export type UseReportOptions = {
  /** After a block from this flow, once the sheets are closed: leave the page of the blocked member. */
  onBlocked?: (username: string) => void;
  /** `<ROUTE-ID>`: the sheet is `<ROUTE-ID>.report`, the dialog `<ROUTE-ID>.reportBlock`. */
  routeId: string;
};

export type ReportFlowHandle = {
  /** False without the M2.6 API (`unavailableSafety`): leave "Melden" out of the menu. */
  available: boolean;
  /** "Melden", for the menu row. */
  label: string;
  /** "Blockieren und melden", for the combined control. */
  blockAndReportLabel: string;
  /** "Melden" for the hook's target: the report sheet; a guest gets the auth sheet on native and the sign-in step with the web form on the web. */
  open: () => void;
  /** "Melden" for another target, as a message in a thread. */
  openFor: (target: ReportTarget) => void;
  /** "Blockieren & melden" (MSG-04): the block dialog first, then the report sheet for the same target. Needs `target.owner`. */
  openBlockAndReport: () => void;
  openBlockAndReportFor: (target: ReportTarget) => void;
  /** Render it once in the screen's overlays. */
  element: ReactNode;
};

type Phase =
  | { kind: 'idle' }
  /** `blocked`: the block came first. `blockAfter`: "Blockieren und melden" for a target a block would hide, so the block follows. */
  | { kind: 'report'; blocked: boolean; blockAfter?: string }
  | { kind: 'block'; username: string; then: 'leave' | 'report' };


const NO_TARGET: ReportTarget = { type: 'member', id: '', label: '' };

/**
 * The entry points' one hook (contract §5): PROF-02, VEH-01, VEH-05, MSG-02, MSG-04 and MSG-05 call `open` (or `openFor`) from their
 * menus and render `element`. The block that follows a report, or precedes it in "Blockieren & melden", waits until the sheet is
 * closed before `onBlocked` leaves the page, so nothing is unmounted under the member's hands. "Blockieren & melden" blocks first
 * only for a message, which stays reportable across a block; any other target is reported first and blocked after.
 */
export function useReport(target: ReportTarget | null, { onBlocked, routeId }: UseReportOptions): ReportFlowHandle {
  const { t } = useTranslation('safety');
  // View-as (m3.2-contract §3): a report or a block would be a write in the member's name, so the menus leave them out.
  const readOnly = useViewAsReadOnly();
  const available = useSafety().available && !readOnly;
  const requireAuth = useRequireAuth();
  const pathname = usePathname();
  const status = useSessionStore((state) => state.status);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // The target of the flow under way; the hook's own until another is opened.
  const [chosen, setChosen] = useState<ReportTarget | null>(null);
  const current = chosen ?? target ?? NO_TARGET;

  const openFor = useCallback(
    (next: ReportTarget) => {
      if (!available || !next.id) return;
      const start = () => {
        setChosen(next);
        setPhase({ kind: 'report', blocked: false });
      };
      // The web shows its own guest step, with the report form that needs no account.
      if (isWeb && status === 'guest') start();
      else requireAuth(start, { returnTo: pathname });
    },
    [available, pathname, requireAuth, status],
  );

  // QA only (qaOpen=report, compiled out of production with the other overrides): the sheet opens once the target is there.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (qa.open !== 'report' || autoOpened.current || !available || !target?.id) return;
    autoOpened.current = true;
    openFor(target);
  }, [available, openFor, target]);

  const openBlockAndReportFor = useCallback(
    (next: ReportTarget) => {
      const username = next.owner;
      if (!available || !next.id || !username) return;
      requireAuth(
        () => {
          setChosen(next);
          setPhase(reportableAfterBlock(next) ? { kind: 'block', username, then: 'report' } : { kind: 'report', blocked: false, blockAfter: username });
        },
        { returnTo: pathname },
      );
    },
    [available, pathname, requireAuth],
  );

  const closeReport = () => {
    const blocked = phase.kind === 'report' && phase.blocked;
    const blockAfter = phase.kind === 'report' ? phase.blockAfter : undefined;
    // The member asked to block as well: the dialog follows the sheet, whether or not the report went in.
    if (blockAfter) {
      setPhase({ kind: 'block', username: blockAfter, then: 'leave' });
      return;
    }
    setPhase({ kind: 'idle' });
    if (blocked && current.owner) onBlocked?.(current.owner);
  };

  const element = (
    <>
      <ReportSheet
        visible={phase.kind === 'report'}
        target={current}
        blocked={phase.kind === 'report' && (phase.blocked || Boolean(phase.blockAfter))}
        onClose={closeReport}
        onBlock={(username) => setPhase({ kind: 'block', username, then: 'leave' })}
        testID={`${routeId}.report`}
      />
      <BlockDialog
        username={phase.kind === 'block' ? phase.username : null}
        variant={phase.kind === 'block' && phase.then === 'report' ? 'blockAndReport' : 'block'}
        onClose={() => setPhase({ kind: 'idle' })}
        onBlocked={(username) => {
          if (phase.kind === 'block' && phase.then === 'report') {
            setPhase({ kind: 'report', blocked: true });
            return;
          }
          setPhase({ kind: 'idle' });
          onBlocked?.(username);
        }}
        testID={`${routeId}.reportBlock`}
      />
    </>
  );

  return {
    available,
    label: t('report.label'),
    blockAndReportLabel: t('block.reportConfirm'),
    open: () => target && openFor(target),
    openFor,
    openBlockAndReport: () => target && openBlockAndReportFor(target),
    openBlockAndReportFor,
    element,
  };
}
