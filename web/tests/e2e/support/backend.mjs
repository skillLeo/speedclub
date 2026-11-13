// What the browser tests need from the local backend besides the app itself: the dev mailbox, a reset of the auth rate
// limiters between runs, aged codes, onboarding fixture accounts and the removal of every test account.
// All of it runs only against a server on this machine; support/backend.php refuses outside local and testing as well.
import { execFile, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BASE_URL } from './qa.mjs';

const exec = promisify(execFile);
const HELPER = fileURLToPath(new URL('./backend.php', import.meta.url));
const PHP = process.env.SPEEDCLUB_PHP ?? 'php';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Every account a test creates ends in this domain, and nothing else is ever deleted (support/backend.php). */
export const E2E_DOMAIN = 'e2e.speedclub.test';

function assertLocalServer() {
  const host = new URL(BASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`The QA backend helper only runs against a server on this machine, not ${host}.`);
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string,string>} [env]
 * @returns {Promise<any>}
 */
async function backendWith(command, args, env = {}) {
  assertLocalServer();
  let stdout = '';
  try {
    ({ stdout } = await exec(PHP, [HELPER, command, ...args], {
      windowsHide: true,
      timeout: 60_000,
      env: { ...process.env, ...env },
    }));
  } catch (error) {
    const e = /** @type {{stdout?:string,stderr?:string,message:string}} */ (error);
    throw new Error(`backend.php ${command} failed: ${[e.stderr, e.stdout].join('\n').trim().slice(0, 800) || e.message}`);
  }
  try {
    return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    throw new Error(`backend.php ${command} printed no JSON: ${stdout.trim().slice(0, 800)}`);
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 */
const backend = (command, ...args) => backendWith(command, args);

/**
 * A verified member under E2E_DOMAIN: by default one who finished onboarding; `username` stops before the name is chosen
 * (AUTH-08, `username` is then ignored), `profile` before the profile setup (AUTH-09).
 * @param {string} email
 * @param {string} username
 * @param {string} password
 * @param {'done'|'username'|'profile'} [step]
 * @returns {Promise<{id:string,next_step:string|null}>}
 */
export const createMember = (email, username, password, step = 'done') =>
  backendWith('create-member', [email, username, step], { E2E_MEMBER_PASSWORD: password });

/**
 * The register, login, verify and mail limiters of the loopback addresses, plus the login delay and the notice budget of
 * the given addresses. A run registers more than five accounts an hour from one address, which is exactly what the
 * limiter is there to stop.
 * @param {string[]} [emails]
 */
export const resetAuthLimits = (emails = []) => backend('reset-limits', ...emails);

/** @type {Promise<any> | null} */
let csrfReset = null;

/**
 * SEC-P1-53's limit of GET /sanctum/csrf-cookie for the loopback clients, and only that limit. Every browser context of a run is a
 * new client from the same address, so a full run asks more often a minute than any one client does. Called once after a 429 of that
 * request (support/auth.mjs, support/fixtures.ts), never in a loop; parallel callers of one process share the reset.
 */
export function resetCsrfLimit() {
  csrfReset ??= backend('reset-csrf-limit').finally(() => {
    csrfReset = null;
  });
  return csrfReset;
}

/**
 * Makes the open codes of a test account expired and older than the resend cooldown.
 * @param {string} email
 * @param {'email_verification'|'password_reset'} purpose
 */
export const ageCodes = (email, purpose) => backend('age-codes', email, purpose);

/** @returns {Promise<{accounts:{username:{email:string},profile:{email:string}}}>} */
export const ensureOnboardingAccounts = () => backend('ensure-onboarding');

/**
 * Removes accounts under E2E_DOMAIN, all of them or those whose address starts with `prefix`.
 * @param {string} [prefix]
 * @returns {Promise<{deleted:number}>}
 */
export const deleteTestAccounts = (prefix = '') => backend('delete-accounts', ...(prefix ? [prefix] : []));

/**
 * The counted scans of a QR code, summed over its days, and the columns a counter row has.
 * @param {string} code
 * @returns {Promise<{total:number,columns:string[]}>}
 */
export const qrScans = (code) => backend('qr-scans', code);

/**
 * Ends the merge window of a test vehicle's open build update, as if ten minutes had passed.
 * @param {string} vehicleId
 * @returns {Promise<{closed:number}>}
 */
export const closeBuildUpdates = (vehicleId) => backend('close-updates', vehicleId);

/**
 * Whether a test account shows up in the member search (users.discoverable). No member endpoint sets it in Phase 1.
 * @param {string} email under E2E_DOMAIN
 * @param {boolean} discoverable
 * @returns {Promise<{discoverable:boolean}>}
 */
export const setDiscoverable = (email, discoverable) => backend('set-discoverable', email, discoverable ? '1' : '0');

/**
 * Who may write to a test account (users.who_can_message), which decides can_message on PROF-02. No member endpoint sets it
 * before SET-07 (M2.5).
 * @param {string} email under E2E_DOMAIN
 * @param {'everyone'|'following'|'nobody'} value
 * @returns {Promise<{who_can_message:string}>}
 */
export const setWhoCanMessage = (email, value) => backend('set-who-can-message', email, value);

/**
 * Runs the queued plate-blur, data-export, decision-mail and appeal-outcome-mail jobs of one test account, as the queue worker would
 * (it does not run locally), and no other job; `only` (a job's class name) runs that kind alone.
 * @param {string} email under E2E_DOMAIN
 * @param {''|'BlurMedia'|'BuildDataExport'|'SendDecisionMail'|'SendAppealOutcomeMail'} [only]
 * @returns {Promise<{ran:string[]}>}
 */
export const runTestJobs = (email, only = '') => backend('run-test-jobs', email, ...(only ? [only] : []));

/**
 * M4.12 F15: moves a test account's creation back, so it may organise events (09 §8.7: at least 14 days old).
 * @param {string} email
 * @param {number} [days]
 */
export const ageTestMember = (email, days = 15) => backend('age-test-member', email, String(days));

/**
 * M4.12 F15: the ADM-53 decision on a test organiser's pending event (approve publishes it), until the admin queue drives it.
 * @param {string} slug
 * @param {'approve'|'reject'} [outcome]
 */
export const reviewTestEvent = (slug, outcome = 'approve') => backend('review-test-event', slug, outcome);

/** For an exit handler, where nothing asynchronous runs any more. */
export function deleteTestAccountsSync(prefix = '') {
  assertLocalServer();
  return spawnSync(PHP, [HELPER, 'delete-accounts', ...(prefix ? [prefix] : [])], { windowsHide: true, timeout: 60_000 }).status;
}

/**
 * @typedef {{at:string,to:string[],subject:string,html:string,text:string,code:string|null}} DevMail
 */

/**
 * The newest mail to an address from the local mailbox, or null.
 * @param {string} to
 * @returns {Promise<DevMail|null>}
 */
export function latestMail(to) {
  assertLocalServer();
  // Not fetch(): see appFingerprint in qa.mjs.
  return new Promise((resolve, reject) => {
    const request = http.get(`${BASE_URL}/dev/mail/latest?to=${encodeURIComponent(to)}`, { agent: false, headers: { Accept: 'application/json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        if (response.statusCode === 404) resolve(null);
        else if (response.statusCode === 200) resolve(JSON.parse(body));
        else reject(new Error(`/dev/mail/latest answered HTTP ${response.statusCode}`));
      });
    });
    request.on('error', reject);
  });
}

/**
 * Waits for a mail to `to` that `accept` takes, newest first.
 * @param {string} to
 * @param {(mail:DevMail)=>boolean} accept
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<DevMail>}
 */
export async function waitForMail(to, accept, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = await latestMail(to);
    if (mail && accept(mail)) return mail;
    if (Date.now() > deadline) throw new Error(`No matching mail to ${to} within ${timeoutMs} ms (latest: ${mail?.subject ?? 'none'})`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Decides the open case about a test account (remove_content, Community-Richtlinien §4, system as decider) through DecideCase.
 * @param {string} email under E2E_DOMAIN
 * @returns {Promise<{decision_id:string}>}
 */
export const decideTestCase = (email) => backend('decide-test-case', email);

/**
 * The moderation cases about a test account, newest first (A2: which case a report opened). Read only, no report content.
 * @param {string} email under E2E_DOMAIN
 * @returns {Promise<{cases: {id:string, target_type:string, target_id:string, status:string}[]}>}
 */
export const testCases = (email) => backend('test-cases', email);

/**
 * DQ-453: the SET-06 fixture member (sessions.fixture@E2E_DOMAIN) with its fixed devices, every earlier session ended.
 * @returns {Promise<{email:string, devices:number}>}
 */
export const ensureSessionsFixture = () => backend('ensure-sessions-fixture');

/**
 * @typedef {{email:string, name:string, role:string, id:number, enrolled:boolean}} StaffFixture
 */

/**
 * The staff fixtures of this run (support/backend.php STAFF_FIXTURES), reset to the run's password and TOTP secrets. Both travel in the
 * environment of the helper, never on its command line. With `labels`, only those exist afterwards: every other fixture is removed.
 * @param {string} password
 * @param {Record<string,string>} secrets base32 per enrolled label
 * @param {string[]} [labels]
 * @returns {Promise<{accounts: Record<string, StaffFixture>}>}
 */
export const ensureStaffFixtures = (password, secrets, labels) =>
  backendWith('ensure-staff', [], {
    E2E_STAFF_PASSWORD: password,
    E2E_STAFF_SECRETS: JSON.stringify(secrets),
    ...(labels ? { E2E_STAFF_LABELS: JSON.stringify(labels) } : {}),
  });

/**
 * Removes the staff fixtures (and leftovers of an earlier fixture list under the staff domain), their approval requests, saved views and
 * the branding they made (remove-branding-fixture); nothing else.
 * @returns {Promise<{deleted:number, approvals:number, branding:{versions:number, restored:number|null, assets:number, files:number}}>}
 */
export const deleteStaffFixtures = () => backend('delete-staff');

/** For an exit handler. */
export function deleteStaffFixturesSync() {
  assertLocalServer();
  return spawnSync(PHP, [HELPER, 'delete-staff'], { windowsHide: true, timeout: 60_000 }).status;
}

/** The loopback staff sign-in limiter of the fixture addresses: once, after a 429 from a run in the same minute. */
export const resetStaffLimits = () => backend('reset-staff-limits');

/** ADM-44-event: the newest seeded audit event (before DemoSeeder::NOW), preferring one with a diff. Read only. @returns {Promise<{id:string, action:string}>} */
export const seededAuditEvent = () => backend('seeded-audit-event');

/**
 * VIEWAS-*: a view-as of the demo member marco.amg by the owner fixture of this run (support/backend.php start-view-as, StartViewAs), as
 * the admin's "Ansicht als" opens it: the one-time URL `/app/#view_as=<token>&staff=<name>`, valid 30 minutes. A new start ends the
 * previous one. Needs the staff fixtures (support/staff.mjs staffRun) first.
 * @param {string} label the staff fixture, `owner`
 * @returns {Promise<{url:string, expires_at:string, member:string, staff:string}>}
 */
export const startViewAs = (label = 'owner') => backend('start-view-as', label);

/**
 * SAFE-01-staff and SAFE-01-reversal: decisions.fixture@E2E_DOMAIN with a staff-origin publishing restriction that stands and a messaging
 * restriction with its reversal, at fixed times. Kept while whole, so every call of a run answers the same ids.
 * @returns {Promise<{email:string, staff_decision:string, reversal:string, original:string}>}
 */
export const ensureDecisionsFixture = () => backend('ensure-decisions-fixture');

/**
 * SET-03-2fa and SET-04-2fa: twofactor.fixture@E2E_DOMAIN with two-factor on and the given secret, its sessions ended. The secret
 * travels in the environment, never on the command line.
 * @param {string} secret 160-bit base32
 * @returns {Promise<{email:string, two_factor:boolean}>}
 */
export const ensureTwoFactorFixture = (secret) => backendWith('ensure-two-factor-fixture', [], { E2E_MEMBER_TOTP: secret });

/**
 * ADM-43, ADM-43-mine, ADM-43-all (DQ-528): the approvals queue of the `admin` fixture, seeded after the staff fixtures exist (support/
 * staff.mjs staffRun, whose ensure-staff removes every fixture's requests): two pending for the admin (a member deletion by the owner
 * fixture, a bulk restriction by the moderator fixture), one pending of the admin's own, one denied with a comment, one executed bulk with
 * three failed records, one expired. Creation and decision times are fixed relative to QA_NOW; nothing is executed. Only the visual runner
 * calls it (run.mjs), never the Playwright global setup, so the flows never meet these requests; delete-staff removes them with the run.
 * @returns {Promise<{created:number, members:number, ids:Record<string,string>}>}
 */
export const ensureApprovalsFixture = () => backend('ensure-approvals-fixture');

/**
 * flows/a3-branding.spec.ts: the branding versions a staff fixture created or published go, the version live before the run is live
 * again (no rollback copy, so ADM-35 keeps its history), and the brand images a fixture uploaded go once no version names them.
 * @returns {Promise<{versions:number, restored:number|null, assets:number, files:number}>}
 */
export const removeFixtureBranding = () => backend('remove-branding-fixture');

/**
 * @typedef {{id:number, version:number, sha256:string}} RowState one config_versions row, all its columns hashed
 */

/**
 * The live branding version, every published version, a branding draft under the key that is not a fixture's, and a staff member's draft
 * wherever it stands (under the key, or parked by A3).
 * @returns {Promise<{live:number|null, versions:number[], foreign_draft:number|null, staff_draft:(RowState & {parked:boolean})|null}>}
 */
export const brandingState = () => backend('branding-state');

/**
 * A3, inside its lock: moves a staff member's branding draft aside (its key column only) so the fixture can draft, publish and roll back;
 * remove-branding-fixture (also delete-staff and ensure-staff) puts it back. Never taken over, never discarded.
 * @returns {Promise<{parked: RowState|null}>}
 */
export const parkBrandingDraft = () => backend('park-branding-draft');

/**
 * Visual stage `draft-owner` (DQ-674): the seeded branding and announcements drafts are the given fixture's for the capture (created_by
 * only); restoreSeededDrafts gives each back to the staff member its first config.draft_saved names.
 * @param {string} label
 * @returns {Promise<{lent: Record<string, number>, to: string}>}
 */
export const lendSeededDrafts = (label) => backend('lend-seeded-drafts', label);

/** @returns {Promise<{restored:number}>} */
export const restoreSeededDrafts = () => backend('restore-seeded-drafts');

// Stage fixtures of the visual runner (support/stage-fixtures.mjs, run.mjs): each exists only while the cells that photograph it run.

/**
 * HOME-01-announcement-info / -warning: that announcement as the only live one, a published version of its own above every version of
 * the key (a staff draft stays the draft, untouched), the live one superseded until the removal.
 * @param {'info'|'warning'} kind
 * @returns {Promise<{id:string, version:number, base:number|null, draft:number|null}>}
 */
export const publishAnnouncementFixture = (kind) => backend('publish-announcement-fixture', kind);

/** Removes the fixture's announcements versions and makes the one before it live again. @returns {Promise<{removed:number, restored:number|null}>} */
export const removeAnnouncementFixture = () => backend('remove-announcement-fixture');

/**
 * Pure: where publish-announcement-fixture would put its version for these config_versions rows of the key (self-test).
 * @param {{version:number, status:string, fixture?:boolean}[]} rows
 * @returns {Promise<{version:number, supersede:number|null} | {refused:string}>}
 */
export const announcementFixturePlan = (rows) => backend('announcement-fixture-plan', JSON.stringify(rows));

/** Count and hash of every config_versions row of the announcements key with all columns. @returns {Promise<{count:number, sha256:string}>} */
export const announcementsState = () => backend('announcements-state');

/**
 * CONSENT: a re-consent version of AGB and of Datenschutz, each one above every version of that document (drafts included), and
 * consent.fixture. @returns {Promise<{email:string, documents:number, accepted:Record<string,string>, reconsent:Record<string,string>}>}
 */
export const ensureReconsentFixture = () => backend('ensure-reconsent-fixture');

/**
 * Pure: what ensure-reconsent-fixture would make of these legal_documents rows (self-test).
 * @param {{key:string, locale:string, version:string, published_at:string|null, reason?:string|null}[]} rows
 * @returns {Promise<{versions:Record<string,string>, accepted:Record<string,string>} | {refused:string}>}
 */
export const reconsentFixturePlan = (rows) => backend('reconsent-fixture-plan', JSON.stringify(rows));

/** Count and hash of every legal_documents row with all columns. @returns {Promise<{count:number, sha256:string}>} */
export const legalDocumentsState = () => backend('legal-documents-state');

/** Removes the re-consent fixture's legal versions (the account goes with deleteTestAccounts('consent.fixture')). */
export const removeReconsentFixture = () => backend('remove-reconsent-fixture');

/** ADM-F1/F2: premium.enabled on for their cells (only the `enabled` column; refused when a person switched it on). */
export const enablePremiumFixture = () => backend('enable-premium-fixture');

/** premium.enabled off again, only when the fixture switched it on. */
export const disablePremiumFixture = () => backend('disable-premium-fixture');

/** M4.14: parts_catalogue and businesses on for the matrix cells and F13 (refused when a person switched one on, ADR-455). */
export const enableM414Flags = () => backend('enable-m414-flags');

/** parts_catalogue and businesses off again, only when the fixture switched them on. */
export const disableM414Flags = () => backend('disable-m414-flags');

/** M4.14 visual path tokens {kwProduct}, {productMod}, {productModVehicle}. @returns {Promise<Record<string, string|null>>} */
export const m414Ids = () => backend('m414-ids');

/** M4.14 F13: staff verify (or reject) a test applicant's business, as ADM-55 would. */
export const reviewTestBusiness = (slug, outcome = 'verify') => backend('review-test-business', slug, outcome);

/** SET-15a / SET-15b: support.fixture with its two requests. @returns {Promise<{email:string, tickets:string[]}>} */
export const ensureSupportFixture = () => backend('ensure-support-fixture');

/** ADM-48 (stage fixture `health-run`): one run of the health checks, as the scheduler makes them; removed by removeHealthFixture. */
export const runHealthFixture = () => backend('run-health-fixture');

/** Removes the health results runHealthFixture made, and only those. */
export const removeHealthFixture = () => backend('remove-health-fixture');

/**
 * For an exit or signal handler: runs every helper command in order, synchronously (a failed one does not stop the next), and answers
 * whether all of them succeeded.
 * @param {[string, ...string[]][]} commands each `[command, ...args]`
 */
export function backendSync(...commands) {
  assertLocalServer();
  const statuses = commands.map(([command, ...args]) => spawnSync(PHP, [HELPER, command, ...args], { windowsHide: true, timeout: 60_000 }).status);
  return statuses.every((status) => status === 0);
}
