// Staff sign-in for the admin tests (M3.1). The fixtures are support/backend.php STAFF_FIXTURES under STAFF_DOMAIN: one per role, the
// pending sign-in of ADM-02 (`challenge`), an account not yet enrolled for ADM-03 (`enrol`) and one admin per browser for the UI sign-in
// of flows/a0-admin-shell.spec.ts. Every run gives them a new password and new 160-bit TOTP secrets, kept in that run's memory only
// (and, for Playwright, in the environment its workers inherit from the global setup); nothing is written to disk.
//
// A sign-in goes through the real flow over HTTP: GET /admin/login (CSRF cookie), POST /admin/login, POST /admin/two-factor-challenge
// with a code computed here (support/totp.mjs), then a GET that proves where the session stands. The staff limiters (5 a minute per
// address and client, 30 per client, ADR-219's per-account delay) are respected by signing in once per fixture and run: the visual
// runner caches the session per process, Playwright signs in once in the global setup and hands the cookies to every worker.
import { randomBytes } from 'node:crypto';
import { request } from '@playwright/test';
import { deleteStaffFixturesSync, ensureStaffFixtures, resetStaffLimits } from './backend.mjs';
import { BASE_URL, QA_USER_AGENT } from './qa.mjs';
import { msToNextStep, newTotpSecret, totpCode } from './totp.mjs';

export const STAFF_DOMAIN = 'staff.e2e.speedclub.test';
/** Every fixture label of support/backend.php STAFF_FIXTURES (the PHP list is the authority; ensure-staff refuses a mismatch). */
export const STAFF_LABELS = [
  'owner', 'admin', 'moderator', 'support', 'content-editor', 'analyst', 'challenge', 'enrol', 'signin-chromium', 'signin-webkit',
  // flows/a1-restrict-member.spec.ts, per browser project: each signs in a session of its own there (password confirmations, ADR-215).
  // Admins, not Owners (ADR-237: at most 3 Owners with the seeded one; only `owner` and `a4-owner` are Owner fixtures).
  'a1-admin-chromium', 'a1-admin-webkit', 'a1-approver-chromium', 'a1-approver-webkit', 'a1-moderator-chromium', 'a1-moderator-webkit',
  // flows/a2-report-handling.spec.ts, per browser project, sessions of their own: the moderator who decides the photo, the one who decides
  // the appeal against it, and the one of the reported message (ADM-22).
  'a2-moderator-chromium', 'a2-moderator-webkit', 'a2-appeals-chromium', 'a2-appeals-webkit', 'a2-messages-chromium', 'a2-messages-webkit',
  // flows/a3-branding.spec.ts, per browser project: the content editor who uploads, publishes and rolls back the branding.
  'a3-brand-chromium', 'a3-brand-webkit',
  // flows/a4-role-assignment.spec.ts, per browser project: the admin who asks, the admin who approves, the support member whose roles
  // change; and the one Owner who asks to grant Owner (shared by both projects).
  'a4-admin-chromium', 'a4-admin-webkit', 'a4-approver-chromium', 'a4-approver-webkit', 'a4-subject-chromium', 'a4-subject-webkit', 'a4-owner',
];
const UNENROLLED = new Set(['enrol']);

/**
 * Auth kinds of the route registry and the specs → fixture and where its session stops.
 * @type {Record<string, {label: string, stop: 'signed-in'|'challenge'}>}
 */
export const STAFF_KINDS = {
  'staff-owner': { label: 'owner', stop: 'signed-in' },
  'staff-admin': { label: 'admin', stop: 'signed-in' },
  'staff-moderator': { label: 'moderator', stop: 'signed-in' },
  'staff-support': { label: 'support', stop: 'signed-in' },
  'staff-content': { label: 'content-editor', stop: 'signed-in' },
  'staff-analyst': { label: 'analyst', stop: 'signed-in' },
  // ADM-02: password accepted, the code still to come (session login.id).
  'staff-challenge': { label: 'challenge', stop: 'challenge' },
  // ADM-03: signed in without TOTP; EnsureStaffTwoFactor holds the session at the enrolment.
  'staff-enrol': { label: 'enrol', stop: 'signed-in' },
};

/** The environment variable through which the global setup hands the run to the Playwright workers. */
export const STAFF_RUN_ENV = 'SPEEDCLUB_E2E_STAFF_RUN';

/**
 * @typedef {import('./backend.mjs').StaffFixture} StaffFixture
 * @typedef {Awaited<ReturnType<import('@playwright/test').APIRequestContext['storageState']>>['cookies']} Cookies
 * @typedef {{password: string, secrets: Record<string, string>, accounts: Record<string, StaffFixture>, sessions?: Record<string, Cookies>}} StaffRun
 */

/**
 * The fixtures of the auth kinds only: what the visual runner signs in as (its cells name auth kinds; view-as and the approvals fixture
 * use `owner`, `admin` and `moderator`). DQ-677: the flows' per-browser fixtures (a1-…, a4-…) would otherwise stand in every team list
 * and count it photographs.
 */
export const KIND_LABELS = [...new Set(Object.values(STAFF_KINDS).map((k) => k.label))];

/**
 * Creates (or resets) the fixtures with a new password and new secrets; with `labels` a subset, and every other fixture is removed. Only
 * the global setup or a standalone process calls this.
 * @param {string[]} [labels]
 */
export async function createStaffRun(labels) {
  const wanted = labels ?? STAFF_LABELS;
  const password = randomBytes(24).toString('base64url');
  const secrets = Object.fromEntries(wanted.filter((l) => !UNENROLLED.has(l)).map((l) => [l, newTotpSecret()]));
  const { accounts } = await ensureStaffFixtures(password, secrets, labels);
  const missing = wanted.filter((l) => !accounts[l]);
  if (missing.length) throw new Error(`backend.php ensure-staff did not create ${missing.join(', ')}`);
  return /** @type {StaffRun} */ ({ password, secrets, accounts });
}

/** @type {Promise<StaffRun>|null} */
let ownRun = null;

/**
 * The staff run of this process. In a Playwright worker it is the global setup's (never a new one: new secrets would end every other
 * worker's session); elsewhere (the visual runner) it is created once, and its fixtures are removed when the process exits.
 * @returns {Promise<StaffRun>}
 */
export function staffRun() {
  const shared = process.env[STAFF_RUN_ENV];
  if (shared) return Promise.resolve(JSON.parse(shared));
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    return Promise.reject(new Error(`No staff run in ${STAFF_RUN_ENV}: support/global-setup.ts creates it before the workers start.`));
  }
  if (!ownRun) {
    // The visual runner: the fixtures of the auth kinds, nothing else (DQ-677).
    ownRun = createStaffRun(KIND_LABELS).then((run) => {
      // Synchronous, because nothing asynchronous runs in an exit handler.
      process.once('exit', () => deleteStaffFixturesSync());
      return run;
    });
    ownRun.catch(() => (ownRun = null));
  }
  return ownRun;
}

/**
 * Signs a fixture in over HTTP and answers the cookies of its session.
 * @param {StaffRun} run
 * @param {string} label
 * @param {{stop?: 'signed-in'|'challenge'}} [opts]
 * @returns {Promise<Cookies>}
 */
export async function staffSignIn(run, label, { stop = 'signed-in' } = {}) {
  const account = run.accounts[label];
  if (!account) throw new Error(`Unknown staff fixture "${label}"`);
  const api = await request.newContext({
    baseURL: BASE_URL,
    userAgent: QA_USER_AGENT,
    extraHTTPHeaders: { Origin: BASE_URL, Referer: `${BASE_URL}/admin/login` },
  });
  try {
    const xsrf = async () => decodeURIComponent((await api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
    const post = async (/** @type {string} */ path, /** @type {Record<string,string>} */ data) =>
      api.post(path, { data, headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrf() }, maxRedirects: 0 });

    const form = await api.get('/admin/login', { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    if (form.status() !== 200) throw new Error(`GET /admin/login answered HTTP ${form.status()}`);

    for (let attempt = 1; ; attempt++) {
      const response = await post('/admin/login', { email: account.email, password: run.password });
      // A run right before this one used the same minute: clear the loopback limiter of the fixtures once, never more.
      if (response.status() === 429 && attempt === 1) {
        await resetStaffLimits();
        continue;
      }
      if (response.status() !== 200) throw new Error(`Staff sign-in of ${label} answered HTTP ${response.status()}: ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      if (body.two_factor !== account.enrolled) throw new Error(`Staff sign-in of ${label}: two_factor ${String(body.two_factor)}, expected ${account.enrolled}`);
      break;
    }

    if (account.enrolled && stop === 'signed-in') {
      const secret = run.secrets[label];
      if (!secret) throw new Error(`No TOTP secret for ${label}`);
      for (let attempt = 1; ; attempt++) {
        const response = await post('/admin/two-factor-challenge', { code: totpCode(secret) });
        if (response.status() === 204) break;
        // Fortify refuses a code it has seen (the same fixture signed in within this 30 s step): the next step's code is new.
        if (response.status() === 422 && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, msToNextStep() + 500));
          continue;
        }
        throw new Error(`Two-factor challenge of ${label} answered HTTP ${response.status()}: ${(await response.text()).slice(0, 300)}`);
      }
    }

    // Proof of where the session stands: the dashboard, the enrolment, or the code step.
    const target = proofPath(account, stop);
    const proof = await api.get(target, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    if (proof.status() !== 200) {
      throw new Error(`After the sign-in of ${label}, GET ${target} answered HTTP ${proof.status()} ${proof.headers().location ?? ''}`);
    }
    return (await api.storageState()).cookies;
  } finally {
    await api.dispose();
  }
}

/**
 * @param {StaffFixture} account
 * @param {'signed-in'|'challenge'} stop
 */
const proofPath = (account, stop) => (stop === 'challenge' ? '/admin/two-factor-challenge' : account.enrolled ? '/admin' : '/admin/two-factor/setup');

/** The staff session cookie (config speedclub.staff.session_cookie); its expiry is the 30 idle minutes of ADR-217 from the last answer. */
export const STAFF_SESSION_COOKIE = 'sc_staff_session';
/** A cached session with less than this left on its cookie is renewed before it is handed out again. */
const RENEW_MARGIN_MS = 5 * 60_000;

/** When the session cookie of these cookies runs out (ms), Infinity for a cookie without an expiry. @param {Cookies} cookies */
export function sessionCookieExpiry(cookies) {
  const cookie = cookies.find((c) => c.name === STAFF_SESSION_COOKIE);
  if (!cookie) return 0;
  return cookie.expires > 0 ? cookie.expires * 1000 : Infinity;
}

/**
 * The session of these cookies, renewed: one GET of the page that proves where it stands, with the cookies sent whatever their local
 * expiry says (the server decides whether the session still exists), and the cookies of that answer, which carry a new expiry. Null
 * when the server no longer knows the session (30 idle minutes, a sign-out) or it no longer stands there. No sign-in.
 * @param {Cookies} cookies
 * @param {StaffFixture} account
 * @param {'signed-in'|'challenge'} stop
 * @returns {Promise<Cookies|null>}
 */
async function renewedSession(cookies, account, stop) {
  const sent = cookies.map((c) => ({ ...c, expires: -1 }));
  const api = await request.newContext({ baseURL: BASE_URL, userAgent: QA_USER_AGENT, storageState: { cookies: sent, origins: [] } });
  try {
    if ((await api.get(proofPath(account, stop), { headers: { Accept: 'text/html' }, maxRedirects: 0 })).status() !== 200) return null;
    const renewed = (await api.storageState()).cookies;
    return sessionCookieExpiry(renewed) > Date.now() ? renewed : null;
  } finally {
    await api.dispose();
  }
}

/** @type {Map<string, Promise<Cookies>>} */
const sessions = new Map();

/**
 * The session of this process for an auth kind: the global setup's in a Playwright worker, else a sign-in on first use. Handed out
 * again as long as its cookie has more than RENEW_MARGIN_MS left; then renewed first (renewedSession), or, when the server has ended it,
 * signed in anew. Verify of 2026-11-09, run 1: the visual runner kept the cookies of its first sign-in for the whole run, so every
 * context it opened more than 30 minutes later (the premium stage, all ADM-F1/F2 cells) got an expired cookie and the sign-in page.
 * @param {string} kind a key of STAFF_KINDS
 * @returns {Promise<Cookies>}
 */
export async function staffSession(kind) {
  const spec = STAFF_KINDS[kind];
  if (!spec) throw new Error(`Unknown staff auth kind "${kind}"`);
  const current = sessions.get(kind);
  /** @type {Cookies|null} */
  let previous = null;
  if (current) {
    const cookies = await current;
    // Renewed by another caller while this one waited: that one's.
    if (sessions.get(kind) !== current) return staffSession(kind);
    if (sessionCookieExpiry(cookies) - Date.now() > RENEW_MARGIN_MS) return cookies;
    previous = cookies;
  }
  const next = staffRun().then(async (run) => {
    const shared = run.sessions?.[kind];
    const account = run.accounts[spec.label];
    if (!account) throw new Error(`No staff fixture ${spec.label}`);
    const kept = previous ?? shared;
    // A worker that first needs the session more than 30 idle minutes after the global setup signs in once more, in that worker only.
    const renewed = kept ? await renewedSession(kept, account, spec.stop) : null;
    if (renewed) return renewed;
    if (process.env.TEST_WORKER_INDEX !== undefined && !kept) throw new Error(`The global setup signed in no session for ${kind}`);
    return staffSignIn(run, spec.label, { stop: spec.stop });
  });
  next.catch(() => {
    if (sessions.get(kind) === next) sessions.delete(kind);
  });
  sessions.set(kind, next);
  return next;
}

/**
 * Global setup: the fixtures, and one sign-in per auth kind, handed to the workers in the environment.
 * @returns {Promise<StaffRun>}
 */
export async function prepareStaffRunForWorkers() {
  const run = await createStaffRun();
  /** @type {Record<string, Cookies>} */
  const signedIn = {};
  for (const [kind, { label, stop }] of Object.entries(STAFF_KINDS)) signedIn[kind] = await staffSignIn(run, label, { stop });
  const shared = { ...run, sessions: signedIn };
  process.env[STAFF_RUN_ENV] = JSON.stringify(shared);
  return shared;
}
