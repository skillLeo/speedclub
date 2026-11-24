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
  disableM414Flags,
  disableM56Gallery,
  disablePremiumFixture,
  enableM414Flags,
  enableM56Gallery,
  enableM414Affiliate,
  disableM414Affiliate,
  enablePremiumFixture,
  ensureM417Fixture,
  ensureSessionsFixture,
  ensureReconsentFixture,
  ensureSupportFixture,
  ensureSpotsFixture,
  removeSpotsFixture,
  ensureCotdFixture,
  removeCotdFixture,
  ensureM59AiAdminFixture,
  removeM59AiAdminFixture,
  ensureM59AiSpecsFixture,
  removeM59AiSpecsFixture,
  ensureStickerFixture,
  removeStickerFixture,
  ensureStickerDraftFixture,
  removeStickerDraftFixture,
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
  // M4.14 (ADR-455): parts_catalogue and businesses are off everywhere until the module's design QA passed, and their API answers 404
  // feature_disabled while off; the BRD/BIZ cells (routes-m414.mjs) switch both on for their capture and off right after. Only the
  // `enabled` column; refused when a person switched one on (support/backend.php m414FlagsFixture). The app side reads them from
  // app-config, and the cells also name them in qaFlags.
  'm414-flags': {
    what: 'parts_catalogue and businesses on, so BRD-01/02, BIZ-01…04 and the Teile/Betriebe scopes have data',
    setup: () => enableM414Flags(),
    teardown: () => disableM414Flags(),
    teardownSync: () => backendSync(['disable-m414-flags']),
  },
  // DQ-P5-012: EVT-02's gallery from the seed: events.gallery on, so the cells read "Saugmotor-Abend"'s approved gallery (night photos at
  // a car park, ShowcaseEvents member_events[].gallery) through the server's own endpoint, off again after the capture.
  'm56-gallery': {
    what: 'events.gallery on, so the EVT-02 gallery cells read the seeded gallery of Saugmotor-Abend',
    setup: () => enableM56Gallery(),
    teardown: () => disableM56Gallery(),
    teardownSync: () => backendSync(['disable-m56-gallery']),
  },
  // DQ-1150: BRD-02 with an affiliate link ("Anzeige"): the M4.14 flags plus affiliate_links on and a test affiliate URL on KW
  // Variante 3 (shop.speedclub.test), all undone after the capture (support/backend.php m414AffiliateFixture).
  'm414-affiliate': {
    what: 'parts_catalogue, businesses and affiliate_links on, KW Variante 3 with a test affiliate URL',
    setup: () => enableM414Affiliate(),
    teardown: () => disableM414Affiliate(),
    teardownSync: () => backendSync(['disable-m414-affiliate']),
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
  // M4.17 part 2: ADM-55 and ADM-60 show their real states (one application waiting, two comments) instead of the local zero state.
  // The business and the comments go with the account (foreign keys cascade).
  'm417-queues': {
    what: 'm417.fixture with one open business application and two comments under a demo build update',
    setup: () => ensureM417Fixture(),
    teardown: () => deleteTestAccounts('m417.fixture'),
    teardownSync: () => backendSync(['delete-accounts', 'm417.fixture']),
  },
  // M4.17 DQ-1197: ADM-59 with active sessions. sessions.fixture (@mia.sessions, the SET-06 account) with its three fixed app devices;
  // every setup ends what the account had and seeds the same devices, so nothing needs removing after.
  'm417-sessions': {
    what: 'sessions.fixture (@mia.sessions) with its three fixed app devices, for ADM-59 and its revoke dialog',
    setup: () => ensureSessionsFixture(),
    teardown: async () => undefined,
    teardownSync: () => true,
  },
  // M5.9b ADM-62: two test spotters on demo cars (a burst, a city hop, ordinary spots); the spots go first so the demo cars' stats are
  // recomputed, then the accounts.
  'm59b-spots': {
    what: 'spots.fixture (@nico.spotter: burst + city hop) and spots.fixture-lea (@lea.dex: ordinary spots) on demo cars',
    setup: () => ensureSpotsFixture(),
    teardown: async () => {
      await removeSpotsFixture();
      await deleteTestAccounts('spots.fixture');
    },
    teardownSync: () => backendSync(['remove-spots-fixture'], ['delete-accounts', 'spots.fixture']),
  },
  'm59d-cotd': {
    what: 'Car of the Day rows around today on public demo cars (two past picks, yesterday skipped, today picked, tomorrow a team choice)',
    setup: () => ensureCotdFixture(),
    teardown: () => removeCotdFixture(),
    teardownSync: () => backendSync(['remove-cotd-fixture']),
  },
  // M5.4 DQ-M54-07/-15: lukas.sc's R34 with three sticker versions that passed the server's Scan-Test (STK-05 passed, STK-06 order,
  // STK-07 history); the teardown deletes exactly those versions.
  'm54-stickers': {
    what: 'three passed sticker versions (Round, Banner, Classic with a custom line) on lukas.sc\'s R34',
    setup: () => ensureStickerFixture(),
    teardown: () => removeStickerFixture(),
    teardownSync: () => backendSync(['remove-sticker-fixture']),
  },
  // DQ-P5-206: STK-05-line and STK-06-notReady need a current version that has not passed the Scan-Test, in a template that prints
  // the custom line. Since M5.10 the seed leaves the R34 on a passed Vertical JDM, so this stage opens a Classic draft above it
  // (support/backend.php ensure-sticker-draft-fixture) and the teardown deletes it again, whatever the seed gave the car.
  'm54-sticker-draft': {
    what: 'an open Classic draft (no Scan-Test) above lukas.sc\'s R34\'s current sticker version',
    // A leftover of an aborted run (its draft or the draft it changed) is undone first.
    setup: async () => {
      await removeStickerDraftFixture();
      return ensureStickerDraftFixture();
    },
    teardown: () => removeStickerDraftFixture(),
    teardownSync: () => backendSync(['remove-sticker-draft-fixture']),
  },
  // M5.9 AI helpers (m5.9-contract §8 D-5, §2.4): no provider runs locally (OA-18), so no seed has a cached spec suggestion or a triage
  // template. ADM-14-model's "KI-Herstellerangaben" (E30 and E46 of BMW M3) and ADM-21's "KI-Vorschlag: <Vorlage>" read these rows; the
  // teardown deletes exactly them and puts the case's ai columns and ai.moderation_triage back (support/backend.php m59AiAdminFixture).
  'm59-ai-admin': {
    what: 'two cached AI spec suggestions of BMW M3 (E30, E46), the triage template street_racing on the ADM-21 web notice, ai.moderation_triage on',
    setup: () => ensureM59AiAdminFixture(),
    teardown: () => removeM59AiAdminFixture(),
    teardownSync: () => backendSync(['remove-m59-ai-admin-fixture']),
  },
  // M5.9 DQ-P5-057: WEB-01 with an AI-marked spec needs a real row (Blade renders from the database). kenji.r34's R34 keeps its factory
  // 280 PS / 392 Nm and gets vehicle_specs.ai_fields for power and torque, as a PUT with `ai_suggestion` would leave it; the teardown puts
  // ai_fields back (support/backend.php m59AiSpecsFixture).
  'm59-ai-specs': {
    what: 'kenji.r34\'s R34 with power and torque marked as taken over from the AI suggestion (vehicle_specs.ai_fields)',
    setup: () => ensureM59AiSpecsFixture(),
    teardown: () => removeM59AiSpecsFixture(),
    teardownSync: () => backendSync(['remove-m59-ai-specs-fixture']),
  },
  'support-tickets': {
    what: 'support.fixture with two support requests, one answered by the team',
    setup: () => ensureSupportFixture(),
    teardown: () => deleteTestAccounts('support.fixture'),
    teardownSync: () => backendSync(['delete-accounts', 'support.fixture']),
  },
};

/** The names a route's `fixture` may take. */
export const STAGE_FIXTURE_NAMES = Object.keys(STAGE_FIXTURES);
