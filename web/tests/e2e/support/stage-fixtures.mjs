// Stage fixtures of the visual matrix: data that every viewer of a screen would see (a published announcement on Start, a re-consent
// version of AGB and Datenschutz, the memberships pages behind premium.enabled) or that a staff queue lists (support tickets on ADM-25). Such a fixture must never be in place while
// another cell is captured, so the runner (run.mjs) takes the cells that name one (`fixture` in routes.mjs) after all others, one fixture
// at a time: set it up, capture its cells, remove it, and also remove it when the process exits or is interrupted in between. Only the
// visual runner uses them; the Playwright flows never meet them. support/backend.php creates and removes them (local and testing only).
import {
  announcementsState,
  backendSync,
  brandingState,
  deleteTestAccounts,
  disablePremiumFixture,
  enablePremiumFixture,
  ensureReconsentFixture,
  ensureSupportFixture,
  legalDocumentsState,
  lendSeededDrafts,
  publishAnnouncementFixture,
  removeAnnouncementFixture,
  removeHealthFixture,
  removeReconsentFixture,
  restoreSeededDrafts,
  runHealthFixture,
} from './backend.mjs';
import { maintenanceFixture } from './maintenance.mjs';

/**
 * @typedef {object} StageFixture
 * @property {string} what one line for the run's log
 * @property {() => Promise<unknown>} setup
 * @property {() => Promise<unknown>} teardown
 * @property {() => boolean} teardownSync for an exit or signal handler
 * @property {string} [lock] a Playwright flow lock (support/admin-flow.ts withFlowLock) a spec that sets the fixture up must hold, because
 *   a flow changes the same rows (draft-owner and A3 both move the seeded branding draft). The visual runner never overlaps a Playwright run.
 */

/** legal_documents before the reconsent fixture's setup, compared after its teardown. @type {{count:number, sha256:string}|null} */
let reconsentBefore = null;

/**
 * @param {'info'|'warning'} kind
 * @returns {StageFixture}
 */
function announcementFixture(kind) {
  /** @type {{count:number, sha256:string}|null} */
  let before = null;
  return {
    what: `a published ${kind} announcement (audience all, dismissible) as the only live one, beside the staff draft`,
    setup: async () => {
      await removeAnnouncementFixture();
      before = await announcementsState();
      return publishAnnouncementFixture(kind);
    },
    teardown: async () => {
      await removeAnnouncementFixture();
      const was = before;
      before = null;
      const after = await announcementsState();
      if (was && (after.sha256 !== was.sha256 || after.count !== was.count)) {
        throw new Error(`announcements config_versions differ after the ${kind} announcement fixture (${was.count} rows ${was.sha256.slice(0, 12)} before, ${after.count} rows ${after.sha256.slice(0, 12)} after)`);
      }
    },
    teardownSync: () => backendSync(['remove-announcement-fixture']),
  };
}

/** The staff fixture of auth kind `staff-content` (support/staff.mjs STAFF_KINDS), who owns the seeded drafts in the `draft-owner` stage. */
const DRAFT_OWNER = 'content-editor';

/** The branding draft and the announcements rows before the draft-owner stage, compared after it. */
async function draftsState() {
  return JSON.stringify({ branding: (await brandingState()).staff_draft, announcements: await announcementsState() });
}

/** @returns {StageFixture} */
function draftOwnerFixture() {
  /** @type {string|null} */
  let before = null;
  return {
    what: `the seeded branding and announcements drafts lent to the ${DRAFT_OWNER} fixture (created_by only), as their owner sees them`,
    setup: async () => {
      await restoreSeededDrafts();
      before = await draftsState();
      const lent = await lendSeededDrafts(DRAFT_OWNER);
      if (!lent.lent.branding || !lent.lent.announcements) {
        throw new Error(`draft-owner: the seeded drafts of BrandContentDemoSeeder are missing (lent ${JSON.stringify(lent.lent)}); re-seed the demo`);
      }
      return lent;
    },
    teardown: async () => {
      await restoreSeededDrafts();
      const was = before;
      before = null;
      const after = await draftsState();
      if (was && after !== was) throw new Error(`the seeded drafts differ after the draft-owner fixture (${was} before, ${after} after)`);
    },
    teardownSync: () => backendSync(['restore-seeded-drafts']),
    lock: 'branding',
  };
}

/** @type {Record<string, StageFixture>} */
export const STAGE_FIXTURES = {
  // DQ-674: ADM-28 and ADM-30 as the owner of their draft sees them (editable: upload, focal point, publish; the banner drawer with its
  // fields), not only in the read-only "Entwurf von …" state, which keeps one cell each without this fixture (ADM-28-foreign,
  // ADM-30-foreign). The drafts of BrandContentDemoSeeder are lent to the content-editor fixture (created_by only, no updated_at) and given
  // back to the staff member their first config.draft_saved names; delete-staff and ensure-staff give them back too, before they remove
  // anything a fixture created, so an aborted run never costs the seeded drafts.
  'draft-owner': draftOwnerFixture(),
  // A published version of its own above every announcements version, the editor's draft of BrandContentDemoSeeder included, which stays
  // the draft, untouched; the version live before is superseded for the capture and live again after. The teardown proves that the
  // key's config_versions rows are, row for row and column for column, what they were before the setup (a leftover of an aborted run
  // is removed before that state is taken).
  'announcement-info': announcementFixture('info'),
  'announcement-warning': announcementFixture('warning'),
  // The version is the one above every version of the document, drafts included: with the seeded data AGB 2 and Datenschutz 3, above the
  // Datenschutz draft 2 of BrandContentDemoSeeder (ADM-31), which stays untouched. The teardown proves that legal_documents is, row for
  // row and column for column, what it was before the setup.
  reconsent: {
    what: 'a re-consent version of AGB and Datenschutz above every existing version, and consent.fixture who accepted the version before',
    setup: async () => {
      reconsentBefore = await legalDocumentsState();
      return ensureReconsentFixture();
    },
    teardown: async () => {
      await removeReconsentFixture();
      await deleteTestAccounts('consent.fixture');
      const before = reconsentBefore;
      reconsentBefore = null;
      const after = await legalDocumentsState();
      if (before && (after.sha256 !== before.sha256 || after.count !== before.count)) {
        throw new Error(`legal_documents differ after the reconsent fixture (${before.count} rows ${before.sha256.slice(0, 12)} before, ${after.count} rows ${after.sha256.slice(0, 12)} after)`);
      }
    },
    teardownSync: () => backendSync(['remove-reconsent-fixture'], ['delete-accounts', 'consent.fixture']),
  },
  // ADM-F1/F2 (m3.6 §1): the memberships scaffold answers 404 while premium.enabled is off (the default), so its cells switch it on for
  // their capture and off right after. Only the flag's `enabled` column; refused when a person switched it on (support/backend.php).
  premium: {
    what: 'premium.enabled on, so the memberships pages ADM-F1/F2 exist',
    setup: () => enablePremiumFixture(),
    teardown: () => disablePremiumFixture(),
    teardownSync: () => backendSync(['disable-premium-fixture']),
  },
  // ADM-48: a local demo has no cron, so a fresh seed has no health run and the default cells would be the empty state (visual run 3).
  // One run of the checks the scheduler makes (no notification, no audit row); only its own batches are removed after.
  'health-run': {
    what: 'one run of the health checks, as the scheduler makes it every five minutes on a host',
    setup: () => runHealthFixture(),
    teardown: () => removeHealthFixture(),
    teardownSync: () => backendSync(['remove-health-fixture']),
  },
  // M4.13: MNT-01/02 and GAR-01-due over lukas.sc's R34 (support/maintenance.mjs).
  maintenance: maintenanceFixture,
  'support-tickets': {
    what: 'support.fixture with two support requests, one answered by the team',
    setup: () => ensureSupportFixture(),
    teardown: () => deleteTestAccounts('support.fixture'),
    teardownSync: () => backendSync(['delete-accounts', 'support.fixture']),
  },
};

/** The names a route's `fixture` may take. */
export const STAGE_FIXTURE_NAMES = Object.keys(STAGE_FIXTURES);
