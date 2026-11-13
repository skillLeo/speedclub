// Showcase crawl (crawl/showcase.spec.ts): target, credentials, sign-ins over HTTP, the ids the seeded data exposes, the page lists
// per role, the per-page checks and the summary. Works against the local server and against staging: nothing here touches the
// database or support/backend.php (the local staff fixture of crawl/setup.ts is the one exception, and only on a local target).
//
// Secrets (member password, staff password, staff TOTP secret) are read from the environment when they are needed, sent only in
// request bodies, and never written to a log, a finding, an error message or the report.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { cachedMemberOf } from '../support/auth.mjs';
import { QA_USER_AGENT, trackNetwork, waitForStablePage } from '../support/qa.mjs';
import { msToNextStep, totpCode } from '../support/totp.mjs';
import { uriToRegex } from '../visual/rate-budget.mjs';
import { routes as registryRoutes } from '../visual/routes.mjs';

type RegistryRoute = { id: string; path: string; auth: string; expectStatus?: number | number[] };
const registry = registryRoutes as unknown as RegistryRoute[];

// ---------------------------------------------------------------------------------------------------------------------------------
// Target and credentials

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const BASE_URL = (process.env.CRAWL_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const HOST = new URL(BASE_URL).hostname;
const LOCAL = LOCAL_HOSTS.has(HOST);

export const TARGET = {
  baseUrl: BASE_URL,
  origin: new URL(BASE_URL).origin,
  local: LOCAL,
  /** File name part of the report: local, staging or the host. */
  name: process.env.CRAWL_TARGET ?? (LOCAL ? 'local' : HOST.endsWith('.hostingersite.com') ? 'staging' : HOST.replace(/[^a-z0-9]+/gi, '-')),
};

/**
 * The browser clock. Locally the DemoSeeder world is dated relative to QA_NOW (support/qa.mjs), so the local crawl freezes Date there,
 * as every other spec does; on staging the showcase data is dated relative to the day it was seeded, so the crawl keeps the real clock
 * unless CRAWL_QA_NOW names one. Nothing in the crawl compares pixels or dates; the clock only decides which data the pages show.
 */
export const CRAWL_NOW = process.env.CRAWL_QA_NOW ?? (LOCAL ? '2026-11-02T10:00:00.000Z' : undefined);

/** Never logged. */
function secret(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: the ${purpose} is read from the environment only (see the header of crawl/showcase.spec.ts).`);
  return value;
}

export const memberEmail = () => process.env.CRAWL_MEMBER_EMAIL ?? 'sebastian.demo@speedclub.test';
export const staffEmail = () => process.env.CRAWL_STAFF_EMAIL ?? 'admin.demo@speedclub.test';

/** Headers of every request a member session sends, the way the web app sends them (Sanctum's stateful SPA check needs Origin/Referer). */
const MEMBER_HEADERS = { Accept: 'application/json', Origin: TARGET.origin, Referer: `${TARGET.baseUrl}/app/` };

async function xsrfOf(api: APIRequestContext): Promise<string> {
  return decodeURIComponent((await api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
}

type Cookies = Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];

export type MemberSession = { api: APIRequestContext; cookies: Cookies; cachedMember: string; username: string };

/**
 * Signs the crawl member in the way the web app does (ADR-124). The fixed QA user agent: DemoSeeder stores its fingerprint as a known
 * device of the demo members, so the crawl writes no "Neue Anmeldung" row into the showcase notifications. The session is ended by
 * `endMemberSession` when the test is done, so SET-06 of the showcase member does not collect crawl sessions.
 */
export async function memberSignIn(): Promise<MemberSession> {
  const email = memberEmail();
  const api = await request.newContext({ baseURL: TARGET.baseUrl, userAgent: QA_USER_AGENT, extraHTTPHeaders: MEMBER_HEADERS });
  const csrf = await api.get('/sanctum/csrf-cookie');
  if (!csrf.ok()) throw new Error(`GET /sanctum/csrf-cookie answered HTTP ${csrf.status()}`);
  const response = await api.post('/api/v1/auth/login', {
    data: { email, password: secret('CRAWL_MEMBER_PASSWORD', 'member password') },
    headers: { 'X-XSRF-TOKEN': await xsrfOf(api) },
  });
  if (response.status() !== 200) {
    await api.dispose();
    throw new Error(`Member sign-in of ${email} answered HTTP ${response.status()} (does the account exist on ${TARGET.baseUrl}?)`);
  }
  const { data } = (await response.json()) as { data: { two_factor_required?: boolean; member: { username?: string } } };
  if (data.two_factor_required === true) {
    await api.dispose();
    throw new Error(`Member ${email} has two-factor sign-in on; the crawl member must not.`);
  }
  return { api, cookies: (await api.storageState()).cookies, cachedMember: cachedMemberOf(data.member), username: data.member.username ?? '' };
}

export async function endMemberSession(session: MemberSession): Promise<string | null> {
  try {
    const response = await session.api.post('/api/v1/auth/logout', { headers: { 'X-XSRF-TOKEN': await xsrfOf(session.api) } });
    return response.status() === 204 ? null : `auth/logout answered HTTP ${response.status()}`;
  } finally {
    await session.api.dispose();
  }
}

/** Gives a browser context the member's session and, before every page load, the cached member the web app starts from. */
export async function useMemberSession(context: BrowserContext, session: MemberSession): Promise<void> {
  await context.addCookies(session.cookies);
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('sc.sessionMember', value);
    } catch {
      // Storage blocked: the app starts as a guest, and the page's checks say so.
    }
  }, session.cachedMember);
}

export type StaffSession = { api: APIRequestContext; cookies: Cookies };

/**
 * The real staff sign-in over HTTP (CSRF cookie, POST /admin/login, POST /admin/two-factor-challenge with an RFC 6238 code computed
 * here). Fortify takes each code once: a code another crawl test of this run used in the same 30 s step is refused, and the next step's
 * code is tried (at most twice).
 */
export async function staffSignIn(): Promise<StaffSession> {
  const email = staffEmail();
  const api = await request.newContext({
    baseURL: TARGET.baseUrl,
    userAgent: QA_USER_AGENT,
    extraHTTPHeaders: { Origin: TARGET.origin, Referer: `${TARGET.baseUrl}/admin/login` },
  });
  const fail = async (message: string): Promise<never> => {
    await api.dispose();
    throw new Error(message);
  };
  const post = async (path: string, data: Record<string, string>) =>
    api.post(path, { data, headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(api) }, maxRedirects: 0 });
  const form = await api.get('/admin/login', { headers: { Accept: 'text/html' }, maxRedirects: 0 });
  if (form.status() !== 200) return fail(`GET /admin/login answered HTTP ${form.status()}`);
  const login = await post('/admin/login', { email, password: secret('CRAWL_STAFF_PASSWORD', 'staff password') });
  if (login.status() !== 200) return fail(`Staff sign-in of ${email} answered HTTP ${login.status()}`);
  const body = (await login.json()) as { two_factor?: boolean };
  if (body.two_factor) {
    const totp = secret('CRAWL_STAFF_TOTP_SECRET', 'staff TOTP secret');
    for (let attempt = 1; ; attempt++) {
      const challenge = await post('/admin/two-factor-challenge', { code: totpCode(totp) });
      if (challenge.status() === 204) break;
      if (challenge.status() === 422 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, msToNextStep() + 500));
        continue;
      }
      return fail(`Staff two-factor challenge of ${email} answered HTTP ${challenge.status()}`);
    }
  }
  const proof = await api.get('/admin', { headers: { Accept: 'text/html' }, maxRedirects: 0 });
  if (proof.status() !== 200) {
    return fail(`After the staff sign-in of ${email}, GET /admin answered HTTP ${proof.status()} ${proof.headers().location ?? ''} (TOTP not enrolled?)`);
  }
  return { api, cookies: (await api.storageState()).cookies };
}

export async function endStaffSession(session: StaffSession, context: BrowserContext): Promise<string | null> {
  try {
    // The browser's cookies: its answers renewed the session cookie after the sign-in.
    const cookies = await context.cookies();
    const xsrf = decodeURIComponent(cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
    const response = await context.request.post(`${TARGET.baseUrl}/admin/logout`, {
      headers: { Accept: 'application/json', Origin: TARGET.origin, Referer: `${TARGET.baseUrl}/admin`, 'X-XSRF-TOKEN': xsrf },
      maxRedirects: 0,
    });
    return [200, 204, 302].includes(response.status()) ? null : `POST /admin/logout answered HTTP ${response.status()}`;
  } finally {
    await session.api.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The ids the seeded data exposes, read through the API as the member

export type QrInfo = { code: string; url: string; status: string; slug: string | null; visibility: string | null };
export type Tokens = { values: Record<string, string>; missing: Record<string, string>; qr: QrInfo[] };

/** Without these the showcase member cannot show the pages that need them; a missing one is a `missing-data` finding. */
export const REQUIRED_TOKENS = ['myUsername', 'myVehicleId', 'mySlug', 'myPhoto', 'myMod', 'myUpdate', 'myCode', 'otherSlug', 'otherUser', 'conversation', 'helpKey', 'makeSlug', 'modelKey', 'searchTerm'];

type Json = Record<string, unknown>;
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** Usernames of the showcase members (DemoShowcaseSeeder's data), read from the repo. */
function showcaseUsernames(): Set<string> {
  try {
    const file = fileURLToPath(new URL('../../../database/data/showcase/members.json', import.meta.url));
    return new Set((JSON.parse(readFileSync(file, 'utf8')) as { username: string }[]).map((m) => m.username));
  } catch {
    return new Set();
  }
}

export async function resolveTokens(api: APIRequestContext): Promise<Tokens> {
  const values: Record<string, string> = {};
  const missing: Record<string, string> = {};
  const get = async (path: string): Promise<Json | null> => {
    const response = await api.get(`/api/v1${path}`);
    if (!response.ok()) {
      missing[`GET ${path}`] = `HTTP ${response.status()}`;
      return null;
    }
    return (await response.json()) as Json;
  };
  const set = (key: string, value: string | undefined, why: string) => {
    if (value) values[key] = value;
    else missing[key] = why;
  };

  const profile = (await get('/me/profile'))?.data as Json | undefined;
  set('myUsername', str(profile?.username), 'me/profile has no username');

  const vehicles = list((await get('/me/vehicles'))?.data);
  const published = vehicles.filter((v) => v.status === 'published' && v.visibility === 'public');
  const main = published.find((v) => v.is_main === true) ?? published[0];
  set('myVehicleId', str(main?.id), 'the member has no published public vehicle');
  set('mySlug', str(main?.slug), 'the member has no published public vehicle');
  set('draft', str(vehicles.find((v) => v.status === 'draft')?.id), 'the member has no draft (optional)');

  if (main) {
    const detail = (await get(`/vehicles/${String(main.id)}`))?.data as Json | undefined;
    const photos = list(detail?.photos);
    set('myPhoto', str(photos[0]?.id), 'the main vehicle has no photo');
    values.viewerIndex = String(Math.min(1, Math.max(0, photos.length - 1)));
    set('myMod', str(list((await get(`/vehicles/${String(main.id)}/mods`))?.data)[0]?.id), 'the main vehicle has no modification');
    set('myUpdate', str(list((await get(`/vehicles/${String(main.id)}/updates`))?.data)[0]?.id), 'the main vehicle has no build update');
    // Search by the model name a visitor would type ("Skyline GT-R").
    set('searchTerm', str(main.model) ?? str(main.make), 'the main vehicle has no model');
  }

  const qr = list((await get('/me/qr-codes'))?.data).map((row) => {
    const vehicle = (row.vehicle ?? {}) as Json;
    return { code: String(row.code), url: String(row.url), status: String(row.status), slug: str(vehicle.slug) ?? null, visibility: str(vehicle.visibility) ?? null };
  });
  set('myCode', qr.find((q) => q.status === 'active' && q.visibility === 'public')?.code, 'the member has no active QR code of a public vehicle');
  set('revokedCode', qr.find((q) => q.status === 'revoked')?.code, 'the member has no revoked QR code (optional)');

  // Opening a thread marks it read (MSG-02), so only a thread without unread messages is opened: the showcase keeps its unread badges.
  const chats = list((await get('/conversations'))?.data);
  set(
    'conversation',
    str(chats.find((c) => c.unread_count === 0)?.id),
    chats.length === 0 ? 'the member has no conversation' : 'every conversation has unread messages, and opening one would mark it read',
  );
  set('requestConversation', str(list((await get('/conversations?folder=requests'))?.data)[0]?.id), 'no message request (optional)');
  set('decision', str(list((await get('/me/decisions'))?.data)[0]?.id), 'no moderation decision about the member (optional)');
  set('ticket', str(list((await get('/support/tickets'))?.data)[0]?.id), 'no support request (optional)');
  set('helpKey', str(list((await get('/help'))?.data)[0]?.key), 'no help article');

  // Another member's public build, the member it belongs to.
  const mine = new Set(vehicles.map((v) => v.slug));
  // A showcase member's build first (database/data/showcase/members.json): a real tester's account may follow nobody yet.
  const candidates = list((await get('/search/vehicles?sort=updated'))?.data).filter((v) => !mine.has(v.slug));
  const showcase = showcaseUsernames();
  const ownerOf = async (slug: unknown): Promise<string | undefined> =>
    str((((await get(`/public/vehicles/${String(slug)}`))?.data as Json | undefined)?.owner as Json | undefined)?.username);
  let recent = candidates[0];
  let recentOwner = recent ? await ownerOf(recent.slug) : undefined;
  for (const candidate of candidates.slice(0, 12)) {
    if (recentOwner !== undefined && showcase.has(recentOwner)) break;
    const owner = await ownerOf(candidate.slug);
    if (owner !== undefined && showcase.has(owner)) [recent, recentOwner] = [candidate, owner];
  }
  set('otherSlug', str(recent?.slug), 'no public vehicle of another member');
  if (recent) set('otherUser', recentOwner, 'the other vehicle names no owner');
  else missing.otherUser = 'no public vehicle of another member';

  const makes = list(((await get('/discover'))?.data as Json | undefined)?.makes);
  const make = makes.find((m) => String(m.name).toLowerCase() === String(main?.make ?? '').toLowerCase()) ?? makes[0];
  set('makeSlug', str(make?.slug), 'Discover lists no make');
  if (make) {
    const models = list(((await get(`/discover/makes/${String(make.slug)}`))?.data as Json | undefined)?.models);
    const model = models.find((m) => m.name === main?.model) ?? models.find((m) => Number(m.vehicle_count) > 0) ?? models[0];
    set('modelKey', str(model?.key), 'the make lists no model');
  } else missing.modelKey = 'Discover lists no make';

  return { values, missing, qr };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Page lists

export type Role = 'guest' | 'member' | 'admin';
export type Kind = 'spa' | 'blade' | 'admin';

/** A legitimately empty section: the marker (test id or data-empty value) and why it may be empty on the showcase. */
export type AllowEmpty = { marker: RegExp; reason: string };
export type AllowText = { pattern: RegExp; reason: string };

export type PageSpec = {
  /** Registry route ID (or a crawl id `CRAWL-…` for a page the registry photographs under a fixture). */
  id: string;
  /** Path template: `{token}` is filled from the resolved tokens. */
  path: string;
  kind: Kind;
  /** Registry ids whose screen this page covers besides `id`. */
  covers?: string[];
  /** Status of the main document by design (a deliberate 404 page). Default 200. */
  expectStatus?: number[];
  /** The document must end on a path matching this (a QR code that redirects into the app). */
  expectFinalPath?: string;
  allowEmpty?: AllowEmpty[];
  /** Text that looks like a key or placeholder and is deliberate on this page. */
  allowText?: AllowText[];
  /** The page is a deliberate not-found or state page: its own empty/unavailable markers are what it shows. */
  statePage?: boolean;
  /** Only on desktop devices (the admin is desktop-only, ADR-212). */
  desktopOnly?: boolean;
};

const SPA = (id: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({ id, path: `/app${path}`, kind: 'spa', ...extra });
const BLADE = (id: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({ id, path, kind: 'blade', ...extra });

const NO_REPORTS: AllowEmpty = { marker: /^SET-16\./, reason: 'a showcase member who never reported anything and has no decision about them is the expected state' };

export const GUEST_PAGES: PageSpec[] = [
  SPA('HOME-01', '/'),
  SPA('HOME-01-following-guest', '/?tab=following'),
  SPA('DISC-01', '/discover'),
  SPA('DISC-02', '/discover/search?q={searchTerm}', { covers: ['DISC-02-panel'] }),
  SPA('DISC-02-interpreted', '/discover/search?q={searchTerm}&understand=1'),
  SPA('DISC-02-members', '/discover/search?q={otherUser}'),
  SPA('DISC-02-filtered', '/discover/search?make={makeSlug}'),
  SPA('DISC-02-grid', '/discover/search?sort=power&view=grid'),
  SPA('DISC-02-updated', '/discover/search?sort=updated'),
  SPA('DISC-03', '/discover/make/{makeSlug}', { covers: ['DISC-03-toyota'] }),
  SPA('DISC-04', '/discover/model/{modelKey}', { covers: ['DISC-04-generation'] }),
  SPA('DISC-04-wheels', '/discover/model/{modelKey}?segment=wheels', {
    allowEmpty: [{ marker: /^DISC-04\.wheelsEmpty$/, reason: 'the wheels segment lists only builds of this model with structured wheel data; a model may have none' }],
  }),
  SPA('GAR-01-guest', '/garage'),
  SPA('VEH-01', '/v/{mySlug}', { covers: ['VEH-01-similar'] }),
  SPA('VEH-02', '/v/{mySlug}/mods/{myMod}', { covers: ['VEH-02-similar'] }),
  SPA('VEH-03', '/v/{mySlug}/gallery'),
  SPA('VEH-04', '/viewer?slug={mySlug}&index={viewerIndex}'),
  SPA('VEH-05', '/v/{mySlug}/updates/{myUpdate}'),
  SPA('VEH-06', '/compare?a={mySlug}&b={otherSlug}', { covers: ['VEH-06-same'] }),
  SPA('PROF-02-guest', '/u/{myUsername}'),
  SPA('PROF-01-guest', '/profile'),
  SPA('MSG-01-guest', '/messages'),
  SPA('SET-01-guest', '/settings'),
  SPA('SET-10', '/settings/appearance'),
  SPA('SET-14-article', '/settings/help/{helpKey}'),
  SPA('SET-17', '/settings/legal'),
  SPA('SET-18', '/settings/legal/privacy'),
  SPA('AUTH-02', '/welcome'),
  SPA('AUTH-03', '/sign-in'),
  SPA('AUTH-04', '/sign-up'),
  SPA('AUTH-06', '/forgot-password'),
  SPA('SYS-03', '/this-link-does-not-exist', { statePage: true }),
  BLADE('WEB-03', '/'),
  BLADE('WEB-01', '/v/{mySlug}'),
  BLADE('CRAWL-WEB-01-other', '/v/{otherSlug}'),
  BLADE('WEB-02', '/u/{myUsername}'),
  BLADE('CRAWL-WEB-02-other', '/u/{otherUser}'),
  BLADE('WEB-08', '/datenschutz'),
  BLADE('WEB-08-impressum', '/impressum'),
  BLADE('WEB-08-agb', '/agb'),
  BLADE('WEB-08-community', '/community-richtlinien'),
  BLADE('WEB-04', '/app-laden'),
  BLADE('WEB-05', '/konto-loeschen'),
  BLADE('WEB-07-verify', '/email/verify'),
  BLADE('WEB-07-reset', '/email/reset'),
  BLADE('WEB-09', '/melden'),
  BLADE('WEB-09-sent', '/melden/gesendet'),
  BLADE('WEB-10', '/kontakt'),
  // The deliberate 404: an unknown sticker code.
  BLADE('WEB-06-notfound', '/C/ZZZZZZZZ', { expectStatus: [404], statePage: true }),
  BLADE('WEB-06-revoked', '/C/{revokedCode}?qaMotion=off', { expectStatus: [410], statePage: true }),
  { id: 'ADM-01', path: '/admin/login', kind: 'admin', desktopOnly: true },
  { id: 'ADM-04', path: '/admin/forgot-password', kind: 'admin', desktopOnly: true },
];

export const MEMBER_PAGES: PageSpec[] = [
  SPA('HOME-01-member', '/'),
  SPA('HOME-01-following', '/?tab=following'),
  SPA('HOME-02', '/notifications'),
  SPA('DISC-01-member', '/discover'),
  SPA('GAR-01', '/garage'),
  SPA('GAR-02', '/garage/{myVehicleId}'),
  SPA('GAR-05', '/garage/{myVehicleId}/basics'),
  SPA('GAR-06', '/garage/{myVehicleId}/specs'),
  SPA('GAR-07', '/garage/{myVehicleId}/photos'),
  SPA('GAR-08', '/garage/{myVehicleId}/photos/{myPhoto}'),
  SPA('GAR-09', '/garage/{myVehicleId}/mods'),
  SPA('GAR-10', '/garage/{myVehicleId}/mods/{myMod}'),
  SPA('GAR-10-new', '/garage/{myVehicleId}/mods/new?category=wheels_tires'),
  SPA('GAR-11', '/garage/{myVehicleId}/history'),
  SPA('GAR-12', '/garage/{myVehicleId}/visibility'),
  SPA('GAR-03', '/add-vehicle/new/vehicle'),
  SPA('GAR-03-specs', '/add-vehicle/{draft}/specs'),
  SPA('GAR-03-photos', '/add-vehicle/{draft}/photos'),
  SPA('GAR-03-review', '/add-vehicle/{draft}/review'),
  SPA('GAR-04', '/published/{myVehicleId}'),
  SPA('CRAWL-VEH-01-own', '/v/{mySlug}'),
  SPA('VEH-01-member', '/v/{otherSlug}'),
  SPA('VEH-07', '/share-card/{myVehicleId}'),
  SPA('QR-01', '/profile/qr'),
  SPA('QR-02', '/qr/{myVehicleId}'),
  SPA('QR-03', '/qr/{myVehicleId}/placement'),
  SPA('QR-04', '/qr/{myVehicleId}/preview'),
  // The owner scanning their own sticker in the app: no scan is counted for the owner (QrScans::counts).
  SPA('WEB-06-app', '/c/{myCode}', { expectFinalPath: '^/app/v/{mySlug}/?$' }),
  SPA('PROF-01', '/profile'),
  SPA('PROF-02', '/u/{otherUser}'),
  SPA('PROF-03', '/profile/edit'),
  SPA('PROF-04', '/profile/connections?tab=followers'),
  SPA('PROF-04-member', '/u/{otherUser}/connections?tab=following'),
  // DQ-1087: PROF-05 opens the "Gespeichert" collection (COL-02).
  SPA('PROF-05', '/profile/saved', { expectFinalPath: '^/app/profile/collections/[0-9a-z]+/?$' }),
  SPA('MSG-01', '/messages'),
  SPA('MSG-01-requests', '/messages?folder=requests', {
    allowEmpty: [{ marker: /^MSG-01\.(empty|noResults)$/, reason: 'no open message request is a normal inbox state' }],
  }),
  SPA('MSG-01-archived', '/messages?folder=archived', {
    allowEmpty: [{ marker: /^MSG-01\.(empty|noResults)$/, reason: 'nothing archived is a normal inbox state' }],
  }),
  SPA('MSG-02', '/messages/{conversation}'),
  SPA('MSG-04', '/messages/requests/{requestConversation}'),
  SPA('MSG-05', '/messages/{conversation}/info'),
  SPA('MSG-03', '/new-message'),
  SPA('MSG-03-about', '/new-message?to={otherUser}&about={otherSlug}'),
  SPA('SAFE-01', '/decision/{decision}'),
  SPA('SET-01', '/settings'),
  SPA('SET-02', '/settings/account'),
  SPA('SET-03', '/settings/account/email'),
  SPA('SET-04', '/settings/security/password'),
  SPA('SET-05', '/settings/security/two-factor'),
  SPA('SET-06', '/settings/security/sessions'),
  SPA('SET-07', '/settings/privacy'),
  SPA('SET-08', '/settings/privacy/blocked', {
    allowEmpty: [{ marker: /^SET-08\.empty$/, reason: 'a showcase member who has blocked nobody is the expected state' }],
  }),
  SPA('SET-09', '/settings/notifications'),
  SPA('CRAWL-SET-10-member', '/settings/appearance'),
  SPA('SET-11', '/settings/language'),
  SPA('SET-12', '/settings/data/export', {
    allowEmpty: [{ marker: /^SET-12\./, reason: 'no data export requested yet is the expected state' }],
  }),
  SPA('SET-13', '/settings/data/delete'),
  SPA('SET-14', '/settings/help'),
  SPA('SET-15', '/settings/help/contact'),
  SPA('SET-15a', '/settings/help/requests', {
    allowEmpty: [{ marker: /^SET-15a?\.(empty|requests\.empty)$/, reason: 'a member without support requests is the expected state' }],
  }),
  SPA('SET-15b', '/settings/help/requests/{ticket}'),
  SPA('SET-16', '/settings/reports', { allowEmpty: [NO_REPORTS] }),
  SPA('CRAWL-SET-17-member', '/settings/legal'),
];

/** Registry routes the crawl does not visit, and why. Every other member-app and public registry route must be covered by a page above. */
export const EXCLUDED: Record<string, string> = {
  'HOME-01-following-empty': 'fixture: nina.neu, a member who follows nobody (the empty Folge ich state)',
  'HOME-01-announcement-info': 'stage fixture of the visual runner (one announcement published for the run)',
  'HOME-01-announcement-warning': 'stage fixture of the visual runner (one announcement published for the run)',
  CONSENT: 'stage fixture of the visual runner (re-consent version 2)',
  'GAR-01-empty': 'fixture: a member without vehicles (the empty garage)',
  'DISC-02-none': 'deliberate no-results search',
  'DISC-02-filtered-none': 'deliberate no-results filter',
  'DISC-02-ai': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'GAR-03-ai': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'GAR-08-ai': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'GAR-10-ai': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'SET-07-ai': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'VEH-01-translate': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'MSG-02-translate': 'QA flag override (qaFlags) of an [AI] feature that is off',
  'VEH-01-unavailable': 'deliberate unavailable vehicle of the DemoSeeder (seed-specific)',
  'PROF-02-unavailable': 'fixture: the QA block pair (paul.roadster has blocked nina.neu)',
  'PROF-02-report': 'QA override qaOpen=report (the report sheet held open for a screenshot)',
  'VEH-01-report': 'QA override qaOpen=report (the report sheet held open for a screenshot)',
  'MSG-02-context': 'fixture: kenji.r34 side of a seeded context-card thread; MSG-02 is covered with the crawl member',
  'SET-03-2fa': 'fixture: a member with two-factor on, created per run by support/backend.php',
  'SET-04-2fa': 'fixture: a member with two-factor on, created per run by support/backend.php',
  'SET-06': 'covered by the member page SET-06 (the registry signs in a fixture with a fixed device list)',
  'SET-08': 'covered by the member page SET-08 (the registry uses the QA block pair)',
  'SAFE-01-reporter': 'fixture: the reporter of a seeded moderation case',
  'SAFE-01-staff': 'fixture: decisions.fixture, decided per run through support/backend.php',
  'SAFE-01-reversal': 'fixture: decisions.fixture, decided per run through support/backend.php',
  'SET-16-decisions': 'fixture: tobi.quattro, the member affected by a seeded decision',
  'SET-15b': 'covered by the member page SET-15b when the crawl member has a support request',
  'AUTH-05': 'mid-flow page (after a sign-up); opening it for a showcase address could send a code mail',
  'AUTH-07': 'mid-flow page (after a reset request); opening it for a showcase address could send a code mail',
  'AUTH-08': 'onboarding fixture (verified, no username yet)',
  'AUTH-09': 'onboarding fixture (username chosen, profile step open)',
  'AUTH-11': 'mid-flow page: needs a pending two-factor challenge',
  'WEB-06-private': 'seed-specific code of a private vehicle; the deliberate 404 is WEB-06-notfound',
  'WEB-06-revoked': 'covered by the guest page WEB-06-revoked when the crawl member has a revoked code',
  'VIEWAS-HOME': 'staff view-as tab: started per run through support/backend.php start-view-as',
  'VIEWAS-MSG': 'staff view-as tab: started per run through support/backend.php start-view-as',
  'VIEWAS-SET-04': 'staff view-as tab: started per run through support/backend.php start-view-as',
  'VIEWAS-ENDED': 'staff view-as tab: started per run through support/backend.php start-view-as',
};

/** Registry ids that belong to the member app or the public pages (not DEV-*, not /admin). */
export function registryAppIds(): string[] {
  return registry.filter((r) => !r.id.startsWith('DEV-') && !r.path.startsWith('/admin')).map((r) => r.id);
}

/** Registry app ids neither covered by a crawl page nor excluded with a reason: a harness gap, reported by the coverage test. */
export function uncoveredRegistryIds(): string[] {
  const covered = new Set<string>();
  for (const page of [...GUEST_PAGES, ...MEMBER_PAGES]) {
    covered.add(page.id);
    for (const id of page.covers ?? []) covered.add(id);
  }
  return registryAppIds().filter((id) => !covered.has(id) && !(id in EXCLUDED));
}

/** Fills `{token}`s. Null + the missing tokens when one is not available. */
export function fillPath(template: string, tokens: Tokens): { path: string | null; missing: string[] } {
  const missing: string[] = [];
  const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = tokens.values[key];
    if (value === undefined) {
      missing.push(key);
      return '';
    }
    return encodeURIComponent(value);
  });
  return missing.length ? { path: null, missing } : { path, missing };
}

// --- Admin -------------------------------------------------------------------------------------------------------------------------

export type AdminRoute = { uri: string; name: string | null; permissions: string[] };

export function adminRoutes(): AdminRoute[] {
  const file = fileURLToPath(new URL('./admin-routes.json', import.meta.url));
  return (JSON.parse(readFileSync(file, 'utf8')) as { routes: AdminRoute[] }).routes;
}

/** GET routes under /admin that are no page of their own, and why. Every other route of admin-routes.json is crawled. */
export const ADMIN_NOT_PAGES: { uri: RegExp; reason: string }[] = [
  { uri: /^\/admin\/\{fallbackPlaceholder\}$/, reason: 'the admin 404 fallback; crawled as the deliberate 404 ADM-05-404' },
  { uri: /\.csv$|\/download$|\/original$|\/evidence$/, reason: 'file download or audited evidence answer, not a page' },
  { uri: /\/contrast$|\/impact$|\/suggest$|\/options$|^\/admin\/content\/home\/vehicles$/, reason: 'JSON answer of a page, not a page' },
  { uri: /^\/admin\/user\//, reason: 'Fortify JSON endpoint (two-factor QR, secret, recovery codes, password confirmation)' },
  { uri: /^\/admin\/(login|forgot-password)$/, reason: 'signed-out page: crawled in the guest role (ADM-01, ADM-04)' },
  { uri: /^\/admin\/(reset|invite)$/, reason: 'needs a one-time token from an e-mail' },
  { uri: /^\/admin\/two-factor-challenge$|^\/admin\/two-factor\/setup$/, reason: 'only reachable mid sign-in or before TOTP enrolment' },
  { uri: /^\/admin\/dev\//, reason: 'developer gallery, registered in local and testing only' },
];

/** Admin pages (path + query) whose sections are legitimately empty, or that show template variables by design. */
export const ADMIN_ALLOW: { path: RegExp; empty?: AllowEmpty[]; text?: AllowText[] }[] = [
  {
    path: /^\/admin\/(content\/templates|moderation\/templates|support\/macros)(\?|$)/,
    text: [{ pattern: /(^|[\s(]):[a-z][a-z_]{2,}\b/, reason: 'a template editor shows its :variables (Laravel placeholders) by design' }],
  },
  {
    path: /^\/admin\/vehicles\/[^/?]+\?tab=reports$/,
    empty: [{ marker: /ADM-12\.reports\.empty/, reason: 'no moderation case about a showcase vehicle is the expected state' }],
  },
  {
    path: /^\/admin\/media-review\?tab=(reported|hidden)$/,
    empty: [{ marker: /^data-empty=quiet in ADM-13\.empty$/, reason: 'no reported or hidden photo is a normal moderation queue state' }],
  },
  {
    path: /^\/admin\/team\/approvals\?tab=mine$/,
    empty: [{ marker: /^data-empty=quiet in ADM-43\.empty$/, reason: 'the signed-in staff member has asked for no four-eyes approval yet' }],
  },
  {
    path: /^\/admin\/moderation\/messages(\?|$)/,
    empty: [
      { marker: /^data-empty=quiet in ADM-22\.none$/, reason: 'the message review asks to pick a case first; it is a prompt, not missing data' },
      { marker: /ADM-22\.table\.empty$/, reason: 'no reported message is the healthy state of the review queue (a fresh host has none)' },
    ],
  },
  // Queues and logs a fresh host legitimately has empty: nothing waiting is the healthy state, not missing showcase data. A local run
  // rarely sees these because the e2e fixtures leave cases behind.
  { path: /^\/admin\/moderation\/reports\?tab=appeals$/, empty: [{ marker: /ADM-20\.table\.empty$/, reason: 'no appeal pending is the healthy queue state' }] },
  { path: /^\/admin\/moderation\/rules$/, empty: [{ marker: /ADM-23\.keywords\.empty$/, reason: 'keyword rules are optional; the club has set none' }] },
  {
    path: /^\/admin\/privacy\/requests$/,
    empty: [
      { marker: /ADM-45\.table\.empty$/, reason: 'no privacy request received by mail or letter is the normal state' },
      { marker: /ADM-45\.self-service$/, reason: 'no member has exported or deleted their data from the app on this host' },
    ],
  },
  { path: /^\/admin\/team\/roles$/, empty: [{ marker: /ADM-41\.empty$/, reason: 'custom roles are optional; the base roles cover the team' }] },
  { path: /^\/admin\/catalog\/import$/, empty: [{ marker: /ADM-17\.history-empty$/, reason: 'no catalogue import has been run on this host' }] },
  { path: /^\/admin\/catalog\/makes\?filter\[status\]=merged$/, empty: [{ marker: /ADM-14\.table\.no-results$/, reason: 'no make has been merged; the filter view is empty by nature' }] },
  { path: /^\/admin\/catalog\/[a-z-]+\/[^/?]+\?tab=history$/, empty: [{ marker: /history\.empty$/, reason: 'a catalogue entry nobody has edited has no versions yet' }] },
];

/** Routes that answer 404 to everyone by design while their flag is off (m3.6 §1: premium.enabled). */
export const ADMIN_FLAGGED: { uri: RegExp; reason: string }[] = [
  { uri: /^\/admin\/memberships\//, reason: 'membership scaffold behind premium.enabled (off by default, 09 §3.2): 404 while off' },
];

export type AdminPlan = {
  /** Pages without route parameters, with the registry's query variants. */
  statics: PageSpec[];
  /** Routes with parameters: resolved from links found on crawled admin pages. */
  params: { route: AdminRoute; regex: RegExp; variants: { query: string; id: string }[] }[];
  notPages: { uri: string; reason: string }[];
};

const DROP_QUERY = /(^|&)(dialog|qaStep|qaScroll|qaFlags|preview|request|brand)=/;

/** Admin query variants of the registry (tabs, sorts, filters), without dialogs and QA-only steps. */
function registryAdminVariants(): { id: string; path: string; query: string }[] {
  const out: { id: string; path: string; query: string }[] = [];
  for (const r of registry) {
    if (!r.path.startsWith('/admin') || ['staff-guest', 'staff-challenge', 'staff-enrol'].includes(r.auth)) continue;
    if (r.expectStatus) continue;
    const [path = '', query = ''] = r.path.split('#')[0]!.split('?');
    if (DROP_QUERY.test(query) || /\{auditEvent\}/.test(query)) continue;
    out.push({ id: r.id, path, query });
  }
  return out;
}

export function adminPlan(memberQuery: string): AdminPlan {
  const all = adminRoutes();
  const notPages: { uri: string; reason: string }[] = [];
  const pages: AdminRoute[] = [];
  for (const route of all) {
    const rule = ADMIN_NOT_PAGES.find((r) => r.uri.test(route.uri));
    if (rule) notPages.push({ uri: route.uri, reason: rule.reason });
    else pages.push(route);
  }
  const staticRoutes = pages.filter((r) => !r.uri.includes('{'));
  const paramRoutes = pages.filter((r) => r.uri.includes('{'));
  const variants = registryAdminVariants();
  const statics: PageSpec[] = [];
  for (const route of staticRoutes) {
    const regex = uriToRegex(route.uri);
    const flagged = ADMIN_FLAGGED.find((f) => f.uri.test(route.uri));
    const extra: Partial<PageSpec> = flagged ? { expectStatus: [200, 404], statePage: true } : {};
    const mine = variants.filter((v) => regex.test(v.path) && !staticRoutes.some((s) => s !== route && uriToRegex(s.uri).test(v.path) && s.uri.length > route.uri.length));
    const queries = [...new Set(mine.map((v) => v.query))];
    if (!queries.includes('') && !mine.some((v) => v.query === '')) queries.unshift('');
    for (const query of queries) {
      const ids = mine.filter((v) => v.query === query).map((v) => v.id);
      // ADM-07: search for the crawl member instead of the seeded lukas.sc.
      const q = route.uri === '/admin/search' ? (query ? `q=${encodeURIComponent(memberQuery)}` : '') : query;
      if (route.uri === '/admin/search' && !q) continue;
      statics.push({ id: ids[0] ?? `CRAWL${route.uri.replace(/\//g, '-').toUpperCase()}`, covers: ids.slice(1), path: `${route.uri}${q ? `?${q}` : ''}`, kind: 'admin', desktopOnly: true, ...extra });
    }
  }
  // The deliberate admin 404.
  statics.push({ id: 'ADM-05-404', path: '/admin/qa-seite-gibt-es-nicht', kind: 'admin', desktopOnly: true, expectStatus: [404], statePage: true });
  const params = paramRoutes.map((route) => {
    const regex = uriToRegex(route.uri);
    const mine = variants.filter((v) => regex.test(v.path) && !staticRoutes.some((s) => uriToRegex(s.uri).test(v.path)));
    const fallback = `CRAWL${route.uri.replace(/[/{}]+/g, '-').toUpperCase()}`;
    const out: { query: string; id: string }[] = [];
    for (const query of new Set(['', ...mine.map((v) => v.query)])) {
      out.push({ query, id: mine.find((v) => v.query === query)?.id ?? (query ? `${mine[0]?.id ?? fallback}?${query}` : (mine[0]?.id ?? fallback)) });
    }
    return { route, regex, variants: out };
  });
  return { statics, params, notPages };
}

/** Whether a same-origin path is a candidate for a parameter route: it matches the route and no static admin route. */
export function linkMatches(path: string, regex: RegExp, staticRegexes: RegExp[]): boolean {
  return regex.test(path) && !staticRegexes.some((s) => s.test(path));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Findings

export const FINDING_TYPES = [
  'console-error',
  'page-error',
  'http-error',
  'request-failed',
  'document-status',
  'not-rendered',
  'wrong-destination',
  'broken-image',
  'image-not-loaded',
  'image-url',
  'empty-state',
  'error-state',
  'untranslated',
  'bad-text',
  'qr',
  'missing-data',
  'third-party',
  'crawl-error',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export type Finding = { type: FindingType; page: string; path: string; detail: string; url?: string };
export type Allowed = Finding & { reason: string };

export type PageResult = {
  id: string;
  path: string;
  finalPath: string;
  status: number | null;
  ms: number;
  findings: number;
  retriedAfter429?: boolean;
};

/** The admin's queue-zero frame `clear` (EmptyQueue.vue: worked through) is a success state, not missing data. */
const QUEUE_CLEAR: AllowEmpty = { marker: /^data-empty=clear\b/, reason: 'queue-zero "worked through" (EmptyQueue clear) is a success state' };

/** A "Failed to load resource" console line repeats a failed response the network listeners already recorded with its URL. */
const FAILED_RESOURCE = /^Failed to load resource:/;
/** Requests the page itself cancelled (a query aborted by navigation inside the SPA, an image source switched): no failure. */
const ABORTED = /ERR_ABORTED|cancelled|NS_BINDING_ABORTED|Load request cancelled/i;

type DomReport = {
  images: { src: string; complete: boolean; naturalWidth: number; visible: boolean }[];
  imageUrls: string[];
  empties: { marker: string; text: string }[];
  errors: { marker: string; text: string }[];
  texts: { kind: 'untranslated' | 'bad-text'; text: string; where: string }[];
  codes: string[];
  links: string[];
  roots: string[];
};

export type CrawlState = {
  role: Role;
  device: string;
  /** The page the context's third-party guard attributes a request to. */
  current: { id: string; path: string };
  findings: Finding[];
  allowed: Allowed[];
  pages: PageResult[];
  notVisited: { id: string; path: string; reason: string }[];
  imageStatus: Map<string, string | null>;
  codes: Set<string>;
  links: Set<string>;
  aborted: number;
  thirdParty: Set<string>;
  qr: { code: string; via: string; result: string }[];
};

export function newState(role: Role, device: string): CrawlState {
  return {
    role,
    device,
    current: { id: '-', path: '-' },
    findings: [],
    allowed: [],
    pages: [],
    notVisited: [],
    imageStatus: new Map(),
    codes: new Set(),
    links: new Set(),
    aborted: 0,
    thirdParty: new Set(),
    qr: [],
  };
}

/**
 * No third party is reached (07 §2 determinism): a request to another origin is aborted and recorded as `third-party` for the page it
 * came from; the app must work without it.
 */
export async function guardContext(context: BrowserContext, state: CrawlState): Promise<void> {
  const isThirdParty = (url: URL) => /^(https?|wss?):$/.test(url.protocol) && url.origin.replace(/^ws/, 'http') !== TARGET.origin;
  await context.route(isThirdParty, async (route) => {
    const url = route.request().url();
    if (!state.thirdParty.has(url)) {
      state.thirdParty.add(url);
      state.findings.push({ type: 'third-party', page: state.current.id, path: state.current.path, detail: `${route.request().resourceType()} to another origin (blocked)`, url });
    }
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(isThirdParty, (ws) => {
    state.findings.push({ type: 'third-party', page: state.current.id, path: state.current.path, detail: 'websocket to another origin (blocked)', url: ws.url() });
    void ws.close();
  });
  if (CRAWL_NOW) await context.clock.setFixedTime(new Date(CRAWL_NOW));
}

const relative = (url: string) => {
  try {
    const u = new URL(url);
    return u.origin === TARGET.origin ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
};

/** Collects what the page shows, in the page. Plain DOM code (runs in the browser). */
function inspectDom(): DomReport {
  const visible = (el: Element) => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const abs = (u: string) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return '';
    }
  };
  const imageUrls = new Set<string>();
  const addUrl = (u: string | null | undefined) => {
    if (!u) return;
    const a = abs(u.trim());
    if (a && /^https?:/.test(a)) imageUrls.add(a);
  };
  const srcsetUrls = (s: string | null) => (s ?? '').split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean) as string[];

  const images = [...document.images].map((img) => {
    addUrl(img.currentSrc || img.getAttribute('src'));
    for (const u of srcsetUrls(img.getAttribute('srcset'))) addUrl(u);
    return { src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth, visible: visible(img) && !!img.getAttribute('src') };
  });
  for (const source of document.querySelectorAll('picture source[srcset]')) for (const u of srcsetUrls(source.getAttribute('srcset'))) addUrl(u);
  for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) addUrl(meta.getAttribute('content'));
  for (const link of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) addUrl(link.getAttribute('href'));
  for (const el of document.querySelectorAll('body *')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    for (const m of bg.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) if (m[2] && !m[2].startsWith('data:')) addUrl(m[2]);
  }

  const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const SUBPART = /\.(title|body|frame|action|icon|label)$/;
  // Markers named "empty" always count; the other state names only on an EmptyState (it renders `<id>.title`), so a checklist group
  // such as GAR-03.review.missing ("Fehlt noch") or a segment option ".none" is no empty state.
  const EMPTY_NAMED = /(^|\.)(empty|[a-z]+Empty|[a-z]+-empty)(\.[\w-]+)?$/;
  const STATE_NAMED = /(^|\.)(noResults|none|unavailable|gone|missing|restricted)$/;
  // EmptyState with an icon renders `<id>.frame` and `<id>.title`; a form group or a checklist with a title has no frame.
  const isEmptyState = (id: string) =>
    document.querySelector(`[data-testid="${CSS.escape(`${id}.title`)}"]`) !== null && document.querySelector(`[data-testid="${CSS.escape(`${id}.frame`)}"]`) !== null;
  const empties: { marker: string; text: string }[] = [];
  for (const el of document.querySelectorAll('[data-testid]')) {
    const id = el.getAttribute('data-testid') ?? '';
    if (SUBPART.test(id) || /\.errors?$/.test(id) || !(EMPTY_NAMED.test(id) || (STATE_NAMED.test(id) && isEmptyState(id)))) continue;
    // The admin's EmptyQueue inside it reports itself with its variant (below).
    if (!visible(el) || el.querySelector('[data-empty]') || el.matches('[data-empty]')) continue;
    empties.push({ marker: id, text: textOf(el) });
  }
  for (const el of document.querySelectorAll('[data-empty]')) {
    if (!visible(el)) continue;
    const owner = el.closest('[data-testid]')?.getAttribute('data-testid');
    empties.push({ marker: `data-empty=${el.getAttribute('data-empty') ?? ''}${owner ? ` in ${owner}` : ''}`, text: textOf(el) });
  }
  const errors: { marker: string; text: string }[] = [];
  for (const el of document.querySelectorAll('[data-testid$=".error"], [data-testid$="Error"]')) {
    const id = el.getAttribute('data-testid') ?? '';
    // ErrorState renders EmptyState parts (`<id>.title`); a field's validation message has none.
    if (visible(el) && document.querySelector(`[data-testid="${CSS.escape(`${id}.title`)}"]`)) errors.push({ marker: id, text: textOf(el) });
  }

  // Untranslated keys and placeholders in what a person can read.
  const TLD = new Set(['de', 'com', 'test', 'app', 'io', 'net', 'org', 'eu', 'info', 'dev', 'local', 'html', 'php', 'pdf', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'csv', 'json']);
  const KEY = /(?<![\w@/:.\-])([a-z][a-zA-Z0-9_]*(?::[a-zA-Z0-9_]+)?(?:\.[a-zA-Z0-9_]+)+)(?![\w@/\-]|\.[a-zA-Z0-9])/g;
  const looksLikeKey = (token: string) => {
    const segments = token.split(/[.:]/);
    if (segments.some((s) => s.length < 2)) return false;
    if (TLD.has((segments[segments.length - 1] ?? '').toLowerCase())) return false;
    return token.includes(':') || segments.length >= 3 || /[A-Z_]/.test(segments.slice(1).join(''));
  };
  // The admin shows machine keys on purpose in `.sc-key` (flag keys, template keys); the same key elsewhere on the page is deliberate.
  const machineKeys = new Set([...document.querySelectorAll('.sc-key')].map((el) => (el.textContent ?? '').trim()));
  const texts: DomReport['texts'] = [];
  const placeholders = new Set<string>();
  const check = (value: string, where: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    for (const m of text.matchAll(KEY)) if (m[1] && looksLikeKey(m[1]) && !machineKeys.has(m[1])) texts.push({ kind: 'untranslated', text: m[1], where });
    for (const m of text.matchAll(/\[\[[^\]]{0,240}\]\]|\{\{[^}]{0,240}\}\}/g)) placeholders.add(m[0]);
    if (/\{\{|\}\}|\[\[|\]\]/.test(text.replace(/\[\[[^\]]{0,240}\]\]|\{\{[^}]{0,240}\}\}/g, ''))) texts.push({ kind: 'untranslated', text: text.slice(0, 160), where });
    if (/missing translation|translation missing|__missing__/i.test(text)) texts.push({ kind: 'untranslated', text: text.slice(0, 160), where });
    if (/(^|[\s(])\:[a-z][a-z_]{2,}\b/.test(text)) texts.push({ kind: 'untranslated', text: text.slice(0, 160), where });
    if (/\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date/.test(text) || text === 'null') texts.push({ kind: 'bad-text', text: text.slice(0, 160), where });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, noscript, template, .sc-key') || !visible(parent)) continue;
    check(node.textContent ?? '', parent.getAttribute('data-testid') ?? parent.tagName.toLowerCase());
  }
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], img[alt]')) {
    if (!visible(el) || el.closest('.sc-key')) continue;
    const hasName = (el.textContent ?? '').trim() !== '' || el.hasAttribute('aria-label');
    for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
      // A tooltip next to a visible name (ADM-44's action code, a cell's full text) is the machine detail by design.
      if (attr === 'title' && hasName) continue;
      let value = el.getAttribute(attr);
      // "E-Mail bestätigt (member.email_verified)": the code in brackets after the label is deliberate (ADM-44).
      if (attr === 'aria-label' && value) value = value.replace(/\s*\([a-z][\w.]*\)\s*$/, '');
      if (value) check(value, `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()}[${attr}]`);
    }
  }
  check(document.title, 'document.title');
  if (placeholders.size) texts.push({ kind: 'untranslated', text: `${placeholders.size} unfilled placeholder(s): ${[...placeholders].join(' ')}`.slice(0, 600), where: 'page' });

  const codes = new Set<string>();
  const links = new Set<string>();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href') ?? '');
    if (!href.startsWith(location.origin)) continue;
    const u = new URL(href);
    const code = /^\/[cC]\/([A-Za-z0-9]{8})$/.exec(u.pathname)?.[1];
    if (code) codes.add(code.toUpperCase());
    links.add(`${u.pathname}${u.search}`);
  }
  const roots = [...document.querySelectorAll('[data-testid$=".root"]')].filter(visible).map((el) => el.getAttribute('data-testid') ?? '');
  return { images, imageUrls: [...imageUrls], empties, errors, texts, codes: [...codes], links: [...links], roots };
}

/** Scrolls the window and every inner scroller down (lazy images, sections that load on scroll), a bounded number of steps, then up. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
    const scrollers: (Element | Window)[] = [window];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 100) scrollers.push(el);
    }
    for (const s of scrollers.slice(0, 6)) {
      const height = s instanceof Window ? innerHeight : s.clientHeight;
      for (let step = 0; step < 8; step++) {
        if (s instanceof Window) scrollBy(0, height * 0.9);
        else s.scrollTop += height * 0.9;
        await pause();
      }
      if (s instanceof Window) scrollTo(0, 0);
      else s.scrollTop = 0;
    }
  });
}

/** Every image switched to eager and decoded (bounded), so `complete`/`naturalWidth` say whether it loads. */
async function loadAllImages(page: Page, timeoutMs: number): Promise<void> {
  await page.evaluate(async (maxWait) => {
    const images = [...document.images].filter((img) => img.getAttribute('src'));
    for (const img of images) if (img.loading === 'lazy') img.loading = 'eager';
    await Promise.race([Promise.allSettled(images.map((img) => img.decode())), new Promise((resolve) => setTimeout(resolve, maxWait))]);
  }, timeoutMs);
}

export type VisitOptions = { context: BrowserContext; state: CrawlState; spec: PageSpec; path: string; expectFinalPath?: RegExp };

/**
 * Opens one page in a page of its own (so nothing of the previous page is still loading), waits until it has rendered and settled,
 * scrolls through it, loads every image, and records what fails. A page whose answers include a 429 (the crawl is faster than a
 * person) is opened once more after the limiter's window; the second visit counts.
 */
export async function visit(options: VisitOptions): Promise<void> {
  const first = await visitOnce(options);
  if (!first.rateLimited) {
    commit(options.state, first);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(65, Math.max(5, first.retryAfter)) * 1000));
  const second = await visitOnce(options);
  second.result.retriedAfter429 = true;
  commit(options.state, second);
}

type Visit = { result: PageResult; findings: Finding[]; allowed: Allowed[]; dom: DomReport | null; rateLimited: boolean; retryAfter: number; statePage: boolean };

function commit(state: CrawlState, visitResult: Visit): void {
  state.pages.push(visitResult.result);
  state.findings.push(...visitResult.findings);
  state.allowed.push(...visitResult.allowed);
  if (visitResult.dom) {
    if (!visitResult.statePage) for (const code of visitResult.dom.codes) state.codes.add(code);
    for (const link of visitResult.dom.links) state.links.add(link);
  }
}

async function visitOnce({ context, state, spec, path, expectFinalPath }: VisitOptions): Promise<Visit> {
  const started = Date.now();
  const findings: Finding[] = [];
  const allowed: Allowed[] = [];
  const push = (type: FindingType, detail: string, url?: string) => findings.push({ type, page: spec.id, path, detail, ...(url ? { url: relative(url) } : {}) });
  state.current = { id: spec.id, path };
  const page = await context.newPage();
  const network = trackNetwork(page);
  let listening = true;
  let rateLimited = false;
  let retryAfter = 0;
  const expected = spec.expectStatus ?? [200];

  page.on('console', (message) => {
    if (!listening || message.type() !== 'error') return;
    const text = message.text();
    if (FAILED_RESOURCE.test(text) || text.includes('ERR_BLOCKED_BY_CLIENT')) return;
    push('console-error', text.replace(/\s+/g, ' ').slice(0, 400), message.location().url || undefined);
  });
  page.on('pageerror', (error) => {
    if (listening) push('page-error', `${error.name}: ${error.message}`.split('\n')[0]!.slice(0, 400));
  });
  page.on('response', (response) => {
    if (!listening) return;
    const status = response.status();
    const isDocument = response.request().isNavigationRequest() && response.frame() === page.mainFrame();
    if (isDocument && status < 300) return;
    if (isDocument && expected.includes(status)) return;
    if (status === 429) {
      rateLimited = true;
      retryAfter = Math.max(retryAfter, Number(response.headers()['retry-after'] ?? 30) || 30);
    }
    if (status >= 400) push(isDocument ? 'document-status' : 'http-error', `HTTP ${status} ${response.request().method()} ${response.request().resourceType()}`, response.url());
  });
  page.on('requestfailed', (req) => {
    if (!listening) return;
    const error = req.failure()?.errorText ?? '';
    if (state.thirdParty.has(req.url()) || error.includes('ERR_BLOCKED_BY_CLIENT') || /blocked/i.test(error)) return;
    if (ABORTED.test(error)) {
      state.aborted++;
      return;
    }
    push('request-failed', `${req.method()} ${req.resourceType()}: ${error}`, req.url());
  });

  let status: number | null = null;
  let dom: DomReport | null = null;
  try {
    const response = await page.goto(`${TARGET.baseUrl}${path}`, { waitUntil: 'load', timeout: 45_000 });
    status = response?.status() ?? null;
    if (status !== null && !expected.includes(status) && status >= 300 && status < 400) push('document-status', `HTTP ${status}`);
    if (spec.kind === 'spa') {
      const rendered = await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('[data-testid$=".root"]')].some((el) => (el as HTMLElement).checkVisibility() && el.getBoundingClientRect().height > 0),
          undefined,
          { timeout: 25_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!rendered) push('not-rendered', 'no screen root ([data-testid$=".root"]) became visible within 25 s');
    }
    await network.waitForQuiet({ quietMs: 400, timeoutMs: 20_000 }).catch(() => undefined);
    await scrollThrough(page);
    await network.waitForQuiet({ quietMs: 400, timeoutMs: 15_000 }).catch(() => undefined);
    await loadAllImages(page, 10_000);
    const stable = await waitForStablePage(page, { network, timeoutMs: 15_000 }).catch(() => null);
    for (const src of stable?.imagesFailed ?? []) push('broken-image', 'image failed to decode', src);
    dom = await page.evaluate(inspectDom);

    const finalPath = new URL(page.url()).pathname;
    if (expectFinalPath && !expectFinalPath.test(finalPath)) push('wrong-destination', `ended on ${finalPath}, expected ${expectFinalPath.source}`);

    for (const img of dom.images) {
      if (!img.src || img.src.startsWith('data:')) continue;
      if (img.complete && img.naturalWidth === 0) push('broken-image', 'img loaded with naturalWidth 0', img.src);
      else if (!img.complete && img.visible) push('image-not-loaded', 'visible img did not finish loading within 10 s', img.src);
    }
    for (const url of dom.imageUrls) {
      let verdict = state.imageStatus.get(url);
      if (verdict === undefined) {
        verdict = await checkImageUrl(context, url);
        state.imageStatus.set(url, verdict);
      }
      if (verdict) push('image-url', verdict, url);
    }
    const adminAllow = spec.kind === 'admin' ? ADMIN_ALLOW.filter((a) => a.path.test(path)) : [];
    const allowEmpty = [...(spec.allowEmpty ?? []), ...adminAllow.flatMap((a) => a.empty ?? []), QUEUE_CLEAR];
    const allowText = [...(spec.allowText ?? []), ...adminAllow.flatMap((a) => a.text ?? [])];
    if (!spec.statePage) {
      for (const empty of dom.empties) {
        const rule = allowEmpty.find((a) => a.marker.test(empty.marker));
        const finding: Finding = { type: 'empty-state', page: spec.id, path, detail: `${empty.marker}: "${empty.text}"` };
        if (rule) allowed.push({ ...finding, reason: rule.reason });
        else findings.push(finding);
      }
    }
    for (const error of dom.errors) push('error-state', `${error.marker}: "${error.text}"`);
    for (const text of dom.texts) {
      const rule = allowText.find((a) => a.pattern.test(text.text));
      const finding: Finding = { type: text.kind, page: spec.id, path, detail: `${text.where}: "${text.text}"` };
      if (rule) allowed.push({ ...finding, reason: rule.reason });
      else findings.push(finding);
    }
    return { result: { id: spec.id, path, finalPath: `${finalPath}${new URL(page.url()).search}`, status, ms: Date.now() - started, findings: findings.length }, findings, allowed, dom, rateLimited, retryAfter, statePage: spec.statePage === true };
  } catch (error) {
    push('crawl-error', String(error).split('\n')[0]!.slice(0, 300));
    return { result: { id: spec.id, path, finalPath: '', status, ms: Date.now() - started, findings: findings.length }, findings, allowed, dom, rateLimited, retryAfter, statePage: spec.statePage === true };
  } finally {
    listening = false;
    await page.close().catch(() => undefined);
  }
}

/** GET of an image URL with the context's cookies: 200 and an image type, or the reason it is not. */
async function checkImageUrl(context: BrowserContext, url: string): Promise<string | null> {
  if (!url.startsWith(TARGET.origin)) return null; // another origin: recorded as third-party by the guard when the page asked for it
  try {
    const response = await context.request.get(url, { timeout: 20_000, headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
    const type = response.headers()['content-type'] ?? '';
    if (response.status() !== 200) return `GET answered HTTP ${response.status()}`;
    if (!/^image\//.test(type)) return `GET answered ${type || 'no content type'}, not an image`;
    return null;
  } catch (error) {
    return `GET failed: ${String(error).split('\n')[0]}`;
  }
}

/**
 * A scanned sticker (F4): /c/{code} redirects to /v/{slug} and that page answers 200; a revoked code answers 410. Checked as a guest
 * with a fresh client, the way a phone camera opens it. `qaMotion=off` makes the server skip the scan counter outside production
 * (PublicPageContext::qa), so the crawl never adds scans to the showcase statistics.
 */
export async function checkQr(state: CrawlState, code: string, expectedSlug: string | null, status: string | null): Promise<void> {
  const api = await request.newContext({ baseURL: TARGET.baseUrl, userAgent: QA_USER_AGENT });
  const record = (via: string, result: string, ok: boolean) => {
    state.qr.push({ code, via, result });
    if (!ok) state.findings.push({ type: 'qr', page: 'QR-SCAN', path: via, detail: result });
  };
  try {
    for (const prefix of ['/c/', '/C/']) {
      const via = `${prefix}${code}`;
      const first = await api.get(`${via}?qaMotion=off`, { maxRedirects: 0 });
      if (status === 'revoked') {
        record(via, `HTTP ${first.status()} (revoked: expected 410)`, first.status() === 410);
        continue;
      }
      const location = first.headers().location ?? '';
      const target = location ? new URL(location, TARGET.baseUrl) : null;
      if (first.status() !== 302 || !target) {
        record(via, `HTTP ${first.status()}, expected a 302 to /v/${expectedSlug ?? '{slug}'}`, false);
        continue;
      }
      const slugOk = expectedSlug ? target.pathname === `/v/${expectedSlug}` : /^\/v\/[a-z0-9-]+$/.test(target.pathname);
      const end = await api.get(target.href, { headers: { Accept: 'text/html' } });
      const ok = slugOk && end.status() === 200 && target.origin === TARGET.origin;
      record(via, `302 → ${relative(target.href)} → HTTP ${end.status()}${slugOk ? '' : ` (expected /v/${expectedSlug ?? '{slug}'})`}`, ok);
    }
  } catch (error) {
    record(`/c/${code}`, `request failed: ${String(error).split('\n')[0]}`, false);
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Results

export type Part = {
  target: string;
  baseUrl: string;
  role: Role;
  device: string;
  project: string;
  memberEmail?: string;
  staffEmail?: string;
  startedAt: string;
  durationMs: number;
  pages: PageResult[];
  findings: Finding[];
  allowed: Allowed[];
  notVisited: { id: string; path: string; reason: string }[];
  qr: { code: string; via: string; result: string }[];
  imageUrlsChecked: number;
  abortedRequests: number;
  notes: string[];
};

/** A readable table of findings for the test's error message (the full list is in the report). */
export function failureTable(part: Pick<Part, 'role' | 'device' | 'findings' | 'pages'>, limit = 120): string {
  const byType = new Map<string, number>();
  for (const f of part.findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  const lines = [
    `Showcase crawl ${part.role} × ${part.device} (${TARGET.name}): ${part.findings.length} finding(s) on ${new Set(part.findings.map((f) => f.page)).size} of ${part.pages.length} page(s)`,
    `By type: ${[...byType].map(([t, n]) => `${t} ${n}`).join(' · ')}`,
    '',
    '| type | page | path | detail | url |',
    '|---|---|---|---|---|',
  ];
  for (const f of part.findings.slice(0, limit)) lines.push(`| ${f.type} | ${f.page} | ${f.path} | ${cell(f.detail)} | ${cell(f.url ?? '')} |`);
  if (part.findings.length > limit) lines.push(`… and ${part.findings.length - limit} more: docs/reports/phase-4/showcase-crawl-${TARGET.name}.md`);
  return lines.join('\n');
}

export const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 220);
