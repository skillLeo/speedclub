// Axe on the M2.6 safety screens: SAFE-01 with the seeded decision (tobi.quattro affected, nico.sti reporter; m2.6-api-handover.md
// §7), SET-16 (lukas.sc's open report, tobi.quattro's decision), WEB-09 /melden and its confirmation, every forced state, and the
// overlays a tap opens: the report sheet from PROF-02 and from a message, the "Blockieren und melden" dialog of a request, and the
// appeal sheet. Read only: nothing is reported, blocked or appealed (every overlay closes again first).
import { axeOverlays, axeScreens, axeStates } from '../support/axe-cases';
import type { BrowserContext } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { buildVehicle, createGarageMember, demoIds, expectStatus } from '../support/garage.mjs';

/**
 * SET-16 "Meine Meldungen" as a member of this cell's own, with one open report on another test member's build: lukas.sc is
 * shared by every axe cell of the run, and their reads together exhaust his per-member `browse` limit (a 429 in round 2). The
 * report's case has a test subject, so the teardown removes it.
 */
async function reporterWithReport(context: BrowserContext): Promise<void> {
  const [reporter, owner] = [await createGarageMember('axereporter'), await createGarageMember('axereported')];
  const vehicle = await buildVehicle(owner.api);
  expectStatus(await reporter.api.post('reports', { target_type: 'vehicle', target_id: vehicle.id, reason: 'spam' }), 201, 'POST reports');
  await useSession(context, reporter.session);
}

/** The seeded decision's id is new after every seed: read per run. */
const decision = async () => `/app/decision/${(await demoIds()).decision}`;
const JANN = '01m5wpk0c0e8jjewpe4ycappww';
const MAX = '01m63k07g0m4m0p4wwggarp6tm';

axeScreens([
  { name: 'SAFE-01 affected', path: decision, auth: 'member-affected', ready: '[data-testid="SAFE-01.title"]' },
  { name: 'SAFE-01 reporter', path: decision, auth: 'member-reporter', ready: '[data-testid="SAFE-01.reporterNote"]' },
  { name: 'SET-16 my reports', path: '/app/settings/reports', auth: reporterWithReport, ready: '[data-testid^="SET-16.report."]' },
  { name: 'SET-16 decisions', path: '/app/settings/reports', auth: 'member-affected', ready: '[data-testid^="SET-16.decision."]' },
  { name: 'WEB-09', path: '/melden', auth: 'guest', ready: '[data-testid="WEB-09.form"]' },
  { name: 'WEB-09 sent', path: '/melden/gesendet', auth: 'guest', ready: '[data-testid="WEB-09.sent.title"]' },
]);

axeStates([
  { route: 'SAFE-01', path: decision, auth: 'member-affected', states: { loading: 'SAFE-01.skeleton', empty: 'SAFE-01.notFound', error: 'SAFE-01.error', restricted: 'SAFE-01.restricted' } },
  { route: 'SET-16', path: '/app/settings/reports', auth: reporterWithReport, states: { loading: 'SET-16.skeleton', empty: 'SET-16.empty.mine', error: 'SET-16.error', restricted: 'SET-16.restricted' } },
]);

axeOverlays([
  {
    name: 'PROF-02 with the report sheet open',
    path: '/app/u/jann.ptrs',
    auth: 'member',
    ready: '[data-testid="PROF-02.more"]',
    open: async (_page, byTestId) => {
      await byTestId('PROF-02.more').click();
      await byTestId('PROF-02.moreSheet.report.body').click();
      return byTestId('PROF-02.report.reason.spam');
    },
  },
  {
    name: 'MSG-04 with the "Blockieren und melden" dialog open',
    path: `/app/messages/requests/${MAX}`,
    auth: 'member',
    ready: '[data-testid="MSG-04.request.block"]',
    open: async (_page, byTestId) => {
      await byTestId('MSG-04.request.block').click();
      return byTestId('MSG-04.reportBlock');
    },
    close: async (_page, byTestId) => byTestId('MSG-04.reportBlock.cancel').click(),
  },
  {
    name: 'MSG-05 with the report sheet open',
    path: `/app/messages/${JANN}/info`,
    auth: 'member',
    ready: '[data-testid="MSG-05.member"]',
    open: async (_page, byTestId) => {
      await byTestId('MSG-05.report.body').click();
      return byTestId('MSG-05.report.reason.harassment');
    },
  },
  {
    name: 'SAFE-01 with the appeal sheet open',
    path: decision,
    auth: 'member-affected',
    ready: '[data-testid="SAFE-01.appealButton"]',
    open: async (_page, byTestId) => {
      await byTestId('SAFE-01.appealButton').click();
      return byTestId('SAFE-01.appealSheet');
    },
  },
]);
