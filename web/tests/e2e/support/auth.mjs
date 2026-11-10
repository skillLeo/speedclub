// Authentication strategies for the visual matrix and for specs.
//
// A strategy prepares a browser context before the page loads, and the runner calls it once per context. A member
// strategy signs in through the API, never through the UI, so thousands of matrix cells stay fast: once per process
// and account, because the login limiter allows ten a minute from one address, and every context then gets that
// session's cookies. Web keeps the session in an httpOnly cookie and only asks auth/me at start when it has a cached
// member (`sc.sessionMember`, src/api/queries/auth.ts), so an init script puts one there before every page load.
//
// Credentials: the DemoSeeder members of docs/07_QA_AND_RELEASE.md, test data with DEMO_MEMBER_PASSWORD from web/.env, which is
// read here and never printed. The two onboarding accounts are fixtures under E2E_DOMAIN (support/backend.php).
import { readFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { deleteTestAccountsSync, ensureDecisionsFixture, ensureOnboardingAccounts, ensureSessionsFixture, ensureTwoFactorFixture, resetAuthLimits, resetCsrfLimit, startViewAs } from './backend.mjs';
import { BASE_URL, QA_USER_AGENT } from './qa.mjs';
import { STAFF_KINDS, STAFF_SESSION_COOKIE, staffRun, staffSession } from './staff.mjs';
import { msToNextStep, newTotpSecret, totpCode } from './totp.mjs';

/**
 * @typedef {(context: import('@playwright/test').BrowserContext, lease?: AuthLease) => Promise<void>} AuthStrategy
 * @typedef {{cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0], cachedMember: string, member: any}} MemberSession
 */

/** The flagship member: R34 and S15, the full FS-8 profile. */
export const DEMO_MEMBER = 'lukas.sc@speedclub.test';
/** Verified, username and profile done, no vehicle: the empty garage. */
export const DEMO_EMPTY_MEMBER = 'nina.neu@speedclub.test';
/** The QA block pair of DemoSeeder::seedQaSocialStates (M2.1): paul.roadster has blocked nina.neu. Read only. */
export const DEMO_BLOCKER = 'paul.roadster@speedclub.test';
/**
 * kenji.r34: the other side of lukas.sc's context-card conversation (m2.4-api-handover.md §12). The registry opens that thread as
 * kenji, never as lukas.sc, whose one unread message there must stay unread (opening it marks it read). Read only.
 */
export const DEMO_KENJI = 'kenji.r34@speedclub.test';
/** tobi.quattro: the member affected by the seeded decision (m2.6-api-handover.md §7, SAFE-01 and SET-16). Read only. */
export const DEMO_AFFECTED = 'tobi.quattro@speedclub.test';
/** nico.sti: the reporter of that decision (SAFE-01 reporter view). Read only. */
export const DEMO_REPORTER = 'nico.sti@speedclub.test';
/**
 * Members of the visual runner's stage fixtures (support/stage-fixtures.mjs): they exist only while their stage runs, which sets them up
 * before its cells sign in. CONSENT: accepted AGB and Datenschutz version 1 while version 2 asks for re-consent.
 */
export const CONSENT_FIXTURE = 'consent.fixture@e2e.speedclub.test';
/** SET-15a / SET-15b: two support requests, one answered by the team. */
export const SUPPORT_FIXTURE = 'support.fixture@e2e.speedclub.test';

const ENV_FILE = new URL('../../../.env', import.meta.url);

/** DEMO_MEMBER_PASSWORD from the environment or web/.env. Never log the value. */
export function demoMemberPassword() {
  const fromEnv = process.env.DEMO_MEMBER_PASSWORD;
  if (fromEnv) return fromEnv;
  let text = '';
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new Error('Member login needs web/.env with DEMO_MEMBER_PASSWORD (docs/07_QA_AND_RELEASE.md, test data).');
  }
  const line = text.split(/\r?\n/).find((l) => /^\s*DEMO_MEMBER_PASSWORD\s*=/.test(l));
  const value = line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  if (!value) throw new Error('DEMO_MEMBER_PASSWORD is empty in web/.env.');
  return value;
}

/** The smallest avatar variant that fills 288 px, or the largest: what the app caches (avatarUrlOf). */
function avatarUrlOf(/** @type {any} */ media) {
  const variants = [...(media?.variants ?? [])].sort((a, b) => a.width - b.width);
  return (variants.find((v) => v.width >= 288) ?? variants[variants.length - 1])?.url ?? null;
}

/** The member the web app caches after a sign-in: id, username, name, avatar, next step. Never the address. */
export function cachedMemberOf(/** @type {any} */ member) {
  return JSON.stringify({
    id: member.id,
    username: member.username ?? '',
    displayName: member.display_name ?? null,
    avatarUrl: avatarUrlOf(member.avatar),
    nextStep: member.next_step ?? null,
  });
}

export { QA_USER_AGENT } from './qa.mjs';

/**
 * Signs in the way the web app does (ADR-124): the CSRF cookie, then auth/login with the XSRF header from the same origin. With
 * `totpSecret`, an account with two-factor on finishes the sign-in as AUTH-11 does (auth/two-factor/challenge with the current code).
 * @param {string} email
 * @param {string} password
 * @param {{totpSecret?: string}} [opts]
 * @returns {Promise<MemberSession>}
 */
export async function apiLogin(email, password, { totpSecret } = {}) {
  const api = await request.newContext({
    baseURL: BASE_URL,
    // One fixed user agent for every harness sign-in: DemoSeeder knows its fingerprint for the demo members, so QA runs never
    // write "new device" security rows into the demo notification history (M2.2 round 1, D2).
    userAgent: QA_USER_AGENT,
    extraHTTPHeaders: { Accept: 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/app/` },
  });
  try {
    for (let attempt = 1; ; attempt++) {
      let csrf = await api.get('/sanctum/csrf-cookie');
      // SEC-P1-53 counts every client of this machine as one: clear that limit once and ask again, never more.
      if (csrf.status() === 429) {
        await resetCsrfLimit();
        csrf = await api.get('/sanctum/csrf-cookie');
      }
      if (!csrf.ok()) throw new Error(`GET /sanctum/csrf-cookie answered HTTP ${csrf.status()}`);
      const xsrf = (await api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value;
      if (!xsrf) throw new Error('The CSRF cookie request set no XSRF-TOKEN cookie.');
      const response = await api.post('/api/v1/auth/login', {
        data: { email, password },
        headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) },
      });
      // Another run in the same minute: clear the loopback limiter once, never more.
      if (response.status() === 429 && attempt === 1) {
        await resetAuthLimits([email]);
        continue;
      }
      if (response.status() !== 200) throw new Error(`Member login for ${email} answered HTTP ${response.status()}.`);
      let { data } = await response.json();
      if (data.two_factor_required === true) {
        if (!totpSecret) throw new Error(`Member login for ${email} asks for a two-factor code, and no secret was given.`);
        data = await passTwoFactor(api, data.challenge, totpSecret);
      }
      const { cookies } = await api.storageState();
      return { cookies, cachedMember: cachedMemberOf(data.member), member: data.member };
    }
  } finally {
    await api.dispose();
  }
}

/**
 * AUTH-11 over HTTP: the challenge of auth/login with the current code of the secret, for the SPA session (no device fields). The server
 * takes each 30 s step once (and ±1): a refused code is tried once more with the next step's.
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {string} challenge
 * @param {string} secret
 */
async function passTwoFactor(api, challenge, secret) {
  for (let attempt = 1; ; attempt++) {
    const xsrf = (await api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
    const response = await api.post('/api/v1/auth/two-factor/challenge', {
      data: { challenge, code: totpCode(secret) },
      headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) },
    });
    if (response.status() === 200) return (await response.json()).data;
    if (response.status() === 422 && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, msToNextStep() + 500));
      continue;
    }
    throw new Error(`Two-factor challenge answered HTTP ${response.status()}: ${(await response.text()).slice(0, 300)}`);
  }
}

/** @type {Map<string, Promise<MemberSession>>} */
const sessions = new Map();

/**
 * The one session of this process for a demo member, shared with the auth strategies: one login per process and account.
 * @param {string} email
 */
export function sessionOf(email) {
  let session = sessions.get(email);
  if (!session) {
    session = apiLogin(email, demoMemberPassword());
    // A failed login must not stay cached as the answer for the rest of the run.
    session.catch(() => sessions.delete(email));
    sessions.set(email, session);
  }
  return session;
}

/** @type {Promise<{username:string,profile:string}>|null} */
let onboarding = null;

function onboardingAccounts() {
  onboarding ??= ensureOnboardingAccounts().then(({ accounts }) => {
    // The Playwright run removes every test account in its global teardown; the visual runner has none, so it cleans up
    // on exit. Synchronous, because nothing else runs there any more.
    if (process.env.TEST_WORKER_INDEX === undefined) process.once('exit', () => deleteTestAccountsSync('onboarding.'));
    return { username: accounts.username.email, profile: accounts.profile.email };
  });
  return onboarding;
}

/**
 * Gives a context the session's cookies and, before every page load, the cached member.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {MemberSession} session
 */
export async function useSession(context, session) {
  await context.addCookies(session.cookies);
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('sc.sessionMember', value);
    } catch {
      // Storage blocked: the app starts as a guest, and the ready selector of the route says so.
    }
  }, session.cachedMember);
}

/**
 * Ends the session of this context on the server, as a sign-out on another device or the idle timeout would. Only for a
 * session of its own (apiLogin + useSession), never the shared one of a strategy. Through the API and not by dropping
 * the cookie: an answer still on its way would set the cookie again.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function endSessionOnServer(context) {
  const xsrf = (await context.cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
  const response = await context.request.post(`${BASE_URL}/api/v1/auth/logout`, {
    headers: { Accept: 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/app/`, 'X-XSRF-TOKEN': decodeURIComponent(xsrf) },
  });
  if (response.status() !== 204) throw new Error(`auth/logout answered HTTP ${response.status()}.`);
}

/** @type {Promise<string>|null} */
let sessionsFixture = null;

/** DQ-453: seeded once per process, right before this process signs in as it (the sign-in is the "Dieses Gerät" row). */
function sessionsFixtureEmail() {
  sessionsFixture ??= ensureSessionsFixture().then(({ email }) => email);
  sessionsFixture.catch(() => (sessionsFixture = null));
  return sessionsFixture;
}

/** @type {Promise<{email:string, staff_decision:string, reversal:string, original:string}>|null} */
let decisionsFixture = null;

/**
 * SAFE-01-staff and SAFE-01-reversal (support/backend.php ensure-decisions-fixture): made once per process, before the path tokens are
 * read and before this process signs in as it; the fixture keeps its ids while it is whole.
 */
export function decisionsFixtureIds() {
  decisionsFixture ??= ensureDecisionsFixture().then((ids) => {
    // As for the onboarding accounts: the Playwright teardown removes test accounts, the visual runner on exit.
    if (process.env.TEST_WORKER_INDEX === undefined) process.once('exit', () => deleteTestAccountsSync('decisions.fixture'));
    return ids;
  });
  decisionsFixture.catch(() => (decisionsFixture = null));
  return decisionsFixture;
}

/** @type {Promise<MemberSession>|null} */
let twoFactorSession = null;

/**
 * SET-03-2fa and SET-04-2fa: the two-factor fixture with a secret of this process, held in memory only, signed in once through AUTH-11.
 * @returns {Promise<MemberSession>}
 */
function twoFactorFixtureSession() {
  twoFactorSession ??= (async () => {
    const secret = newTotpSecret();
    const { email } = await ensureTwoFactorFixture(secret);
    if (process.env.TEST_WORKER_INDEX === undefined) process.once('exit', () => deleteTestAccountsSync('twofactor.fixture'));
    return apiLogin(email, demoMemberPassword(), { totpSecret: secret });
  })();
  twoFactorSession.catch(() => (twoFactorSession = null));
  return twoFactorSession;
}

/** sessionStorage key of the view-as tab (mobile/src/api/clientViewAs.ts VIEW_AS_STORAGE_KEY). */
export const VIEW_AS_STORAGE_KEY = 'sc.viewAs';
/** A view-as lasts 30 minutes; a cell that starts with less than this left gets a new one (the server ends the old one). */
const VIEW_AS_MARGIN_MS = 8 * 60_000;
/** How long a renewal waits for the cells still on the old view-as (a cell's watchdog is 120 s) before it ends it anyway. */
const VIEW_AS_DRAIN_MS = 180_000;

/** @type {{url: string, expiresAt: number}|null} */
let viewAs = null;
/** @type {Promise<string>|null} */
let viewAsStarting = null;
/** Cells that hold a lease on the current view-as (authLease): a renewal ends that one on the server, so it waits for them first. */
let viewAsHolders = 0;

/** Resolves once no cell holds the current view-as, or after VIEW_AS_DRAIN_MS. */
async function viewAsDrained() {
  const until = Date.now() + VIEW_AS_DRAIN_MS;
  while (viewAsHolders > 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * The view-as URL of this run (support/backend.php start-view-as): the owner fixture viewing marco.amg, started on first use and again
 * when less than VIEW_AS_MARGIN_MS of its 30 minutes are left. One process holds it: a second process starting its own would end this
 * one's (one view-as per staff member and member), so Playwright workers, which run in parallel, never start one. A renewal waits until
 * the cells on the old one are done (viewAsHolders), and no new cell takes the old one meanwhile.
 * @returns {Promise<string>}
 */
function viewAsUrl() {
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    return Promise.reject(new Error('The view-as auth kinds belong to the visual runner (one process); a spec starts its own view-as.'));
  }
  if (!viewAsStarting && viewAs && viewAs.expiresAt - Date.now() > VIEW_AS_MARGIN_MS) return Promise.resolve(viewAs.url);
  viewAsStarting ??= staffRun()
    .then(() => viewAsDrained())
    .then(() => startViewAs('owner'))
    .then(({ url, expires_at }) => {
      viewAs = { url, expiresAt: Date.parse(expires_at) };
      return url;
    })
    .finally(() => (viewAsStarting = null));
  return viewAsStarting;
}

/**
 * @typedef {{epoch: string|null, release: () => void}} AuthLease
 */

/**
 * For a runner that keeps a browser context per auth kind across cells (visual/run.mjs): what the context's credentials must be for
 * this cell (`epoch`), renewed first when they are about to run out, and held until `release()`. A kept context whose epoch differs
 * is opened anew. Verify of 2026-11-09, run 1: the contexts kept the view-as fragment and the staff cookies they were opened with, so
 * after 30 minutes a kept view-as tab started as a guest (auth/me 401, VIEWAS-* fs2) and a new admin context got an expired cookie.
 * - viewas: the current view-as URL; the lease keeps a renewal from ending it while the cell runs.
 * - staff kinds: the staff session cookie of the process's session (support/staff.mjs renews it 5 minutes before it runs out).
 * - every other kind: null (member sessions are API tokens without such an expiry within a run).
 * @param {string} kind
 * @returns {Promise<AuthLease>}
 */
export async function authLease(kind) {
  if (kind === 'viewas') {
    // Taken in the same turn as the URL resolves, so a renewal that starts afterwards sees this holder.
    for (;;) {
      const url = await viewAsUrl();
      if (viewAsStarting || viewAs?.url !== url) continue;
      viewAsHolders++;
      let held = true;
      return {
        epoch: url,
        release: () => {
          if (held) viewAsHolders--;
          held = false;
        },
      };
    }
  }
  if (kind in STAFF_KINDS) {
    const cookie = (await staffSession(kind)).find((c) => c.name === STAFF_SESSION_COOKIE);
    return { epoch: cookie?.value ?? '', release: () => {} };
  }
  return { epoch: null, release: () => {} };
}

/** @param {() => Promise<string>} email */
const member = (email) => /** @type {AuthStrategy} */ (async (context) => useSession(context, await sessionOf(await email())));

/** @type {Record<string, AuthStrategy>} */
export const authStrategies = {
  guest: async () => {},
  member: member(async () => DEMO_MEMBER),
  'member-empty': member(async () => DEMO_EMPTY_MEMBER),
  // SET-08 with a row: paul.roadster, who has blocked nina.neu.
  'member-blocker': member(async () => DEMO_BLOCKER),
  // MSG-02 with the R34 context card, from kenji.r34's side (M2.4).
  'member-kenji': member(async () => DEMO_KENJI),
  // SAFE-01 affected view and SET-16 "Entscheidungen zu deinen Inhalten" (M2.6).
  'member-affected': member(async () => DEMO_AFFECTED),
  // SAFE-01 reporter view (M2.6).
  'member-reporter': member(async () => DEMO_REPORTER),
  // SET-06 with a fixed list: a member nobody else signs in as, its devices seeded the same in every run (DQ-453).
  'member-sessions': member(sessionsFixtureEmail),
  // SET-03 / SET-04 with two-factor on: the code field from the start (SEC-P2-07, M3.2).
  'member-two-factor': async (context) => useSession(context, await twoFactorFixtureSession()),
  // SAFE-01 of a staff-origin decision and of a reversal (M3.2, ADR-224): decisions.fixture, see decisionsFixtureIds.
  'member-decisions': member(async () => (await decisionsFixtureIds()).email),
  // CONSENT and SET-15a/b (M3.5): members of a stage fixture, signed in once their stage has set them up (run.mjs).
  'member-consent': member(async () => CONSENT_FIXTURE),
  'member-support': member(async () => SUPPORT_FIXTURE),
  // VIEWAS-* (M3.2, m3.2-contract §3): a tab the admin's "Ansicht als" opened. No member cookie: the view-as token is the Bearer. On the
  // first document of the context the address carries the run's one-time fragment, as window.open hands it over, so the app's own
  // intake takes it into sessionStorage and drops it from the address; later loads of the tab find it there.
  viewas: async (context, lease) => {
    // The lease's URL (visual/run.mjs holds one while it opens the context): asking viewAsUrl() again could wait for a renewal that
    // waits for this very lease.
    const fragment = new URL(lease?.epoch ?? (await viewAsUrl())).hash.slice(1);
    await context.addInitScript(
      ({ key, value }) => {
        try {
          if (window.top !== window || sessionStorage.getItem(key) || location.hash) return;
          history.replaceState(history.state, '', `${location.pathname}${location.search}#${value}`);
        } catch {
          // Storage blocked: the app starts as a guest, and the route's ready selector says so.
        }
      },
      { key: VIEW_AS_STORAGE_KEY, value: fragment },
    );
  },
  // VIEWAS-ENDED: the same tab after "Beenden" (the token revoked): what it keeps in sessionStorage then is the end and its reason.
  'viewas-ended': async (context) => {
    await context.addInitScript((key) => {
      try {
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ ended: 'ended' }));
      } catch {
        // As above.
      }
    }, VIEW_AS_STORAGE_KEY);
  },
  // Verified, no username yet: AUTH-08.
  'member-username': member(async () => (await onboardingAccounts()).username),
  // Username chosen, profile step open: AUTH-09.
  'member-profile': member(async () => (await onboardingAccounts()).profile),
  // Admin (M3.1, support/staff.mjs): signed out, for ADM-01, ADM-04 and the errors without a session. Nothing to set: the staff session
  // has its own cookie on /admin, and a member session never reaches the admin.
  'staff-guest': async () => {},
  ...Object.fromEntries(Object.keys(STAFF_KINDS).map((kind) => [kind, /** @type {AuthStrategy} */ (async (context) => context.addCookies(await staffSession(kind)))])),
};

/** Auth kinds a route may name. */
export const AUTH_KINDS = Object.keys(authStrategies);

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} kind
 * @param {AuthLease} [lease] the runner's lease for this context (authLease), if it holds one
 */
export async function applyAuth(context, kind, lease) {
  const strategy = authStrategies[kind];
  if (!strategy) throw new Error(`Unknown auth kind "${kind}". Known: ${Object.keys(authStrategies).join(', ')}`);
  await strategy(context, lease);
}
