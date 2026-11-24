// Showcase crawl (crawl/showcase.spec.ts): target, credentials, sign-ins over HTTP, the ids the seeded data exposes, the page lists
// per role, the per-page checks and the summary. Works against the local server and against staging: nothing here touches the
// database or support/backend.php (the local staff fixture of crawl/setup.ts is the one exception, and only on a local target).
//
// Secrets (member password, staff password, staff TOTP secret) are read from the environment when they are needed, sent only in
// request bodies, and never written to a log, a finding, an error message or the report.
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * A value of web/.env, read only on a local target and only for a key named here (the demo member password that
 * config('speedclub.demo.member_password') reads). Never logged.
 */
function localDotEnv(key: string): string | undefined {
  if (!LOCAL) return undefined;
  try {
    const file = fileURLToPath(new URL('../../../.env', import.meta.url));
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] !== key) continue;
      const raw = (m[2] ?? '').trim();
      const quoted = /^(['"])(.*)\1$/.exec(raw);
      return (quoted ? quoted[2] : raw.replace(/\s+#.*$/, '')) || undefined;
    }
  } catch {
    // No .env: the environment must name it.
  }
  return undefined;
}

/** Where a secret may come from besides its own variable: locally, the demo password of web/.env for the showcase member. */
const SECRET_FALLBACK: Record<string, () => string | undefined> = {
  CRAWL_MEMBER_PASSWORD: () => process.env.DEMO_MEMBER_PASSWORD ?? localDotEnv('DEMO_MEMBER_PASSWORD'),
};

/** Never logged. */
function secret(name: string, purpose: string): string {
  const value = process.env[name] || SECRET_FALLBACK[name]?.();
  if (!value) throw new Error(`${name} is not set: the ${purpose} is read from the environment only (see the header of crawl/showcase.spec.ts).`);
  return value;
}

export const memberEmail = () => process.env.CRAWL_MEMBER_EMAIL ?? 'sebastian.demo@speedclub.test';
/**
 * The new, empty member of this run (persona `fresh`): signed up through the API by crawl/setup.ts on a local target (the code comes
 * from the dev mailbox), or named by CRAWL_FRESH_EMAIL / CRAWL_FRESH_PASSWORD elsewhere. Null when the run has none.
 */
export const freshEmail = (): string | null => process.env.CRAWL_FRESH_EMAIL || null;
/** The account a role signs in as over HTTP. */
export const personaEmail = (role: Role): string => (role === 'fresh' ? (freshEmail() ?? '-') : memberEmail());
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
export async function memberSignIn(persona: 'member' | 'fresh' = 'member'): Promise<MemberSession> {
  const email = persona === 'fresh' ? freshEmail() : memberEmail();
  if (!email) throw new Error('No new member for this run: crawl/setup.ts signs one up on a local target, elsewhere CRAWL_FRESH_EMAIL names one.');
  const password = persona === 'fresh' ? secret('CRAWL_FRESH_PASSWORD', 'new member password') : secret('CRAWL_MEMBER_PASSWORD', 'member password');
  const api = await request.newContext({ baseURL: TARGET.baseUrl, userAgent: QA_USER_AGENT, extraHTTPHeaders: MEMBER_HEADERS });
  const csrf = await api.get('/sanctum/csrf-cookie');
  if (!csrf.ok()) throw new Error(`GET /sanctum/csrf-cookie answered HTTP ${csrf.status()}`);
  const response = await api.post('/api/v1/auth/login', {
    data: { email, password },
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
  // The unlock toast of an app start (BadgeUnlock, M5.9d) marks the badges it showed as seen. The crawl sees the toast on its first
  // page, but must leave the showcase as it found it (GiftDemoSeeder keeps two badges unseen for the client's first start), so the
  // read mark is answered here as the server would (204) and never reaches it.
  await context.route(/\/api\/v1\/me\/badges\/seen(\?|$)/, async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 204, body: '' });
    else await route.continue();
  });
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

/**
 * Without these the showcase member cannot show the pages that need them; a missing one is a `missing-data` finding. The Phase 4 and
 * Phase 5 ones are what DemoShowcaseSeeder and GiftDemoSeeder give the showcase member (m5.9f-demo-handover.md): a meet they are going
 * to, maintenance items and logs on the main build, spots in the Dex, a Wrapped, open invite codes.
 */
export const REQUIRED_TOKENS = [
  'myUsername',
  'myMemberId',
  'myVehicleId',
  'mySlug',
  'myPhoto',
  'myMod',
  'myUpdate',
  'myCode',
  'otherSlug',
  'otherUser',
  'conversation',
  'helpKey',
  'makeSlug',
  'modelKey',
  'searchTerm',
  'eventSlug',
  'goingEvent',
  'maintenanceItem',
  'maintenanceLog',
  'mySpot',
  'dexCar',
  'wrappedSeasonAny',
  'inviteCode',
];

/** The card kinds of a Wrapped (WrappedResource), in the order of the registry's WRP-01 cells. */
export const WRAPPED_CARDS = ['intro', 'spots', 'scans', 'score', 'top_mod', 'treffen', 'build_spirit', 'percentile', 'share'] as const;

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
  // The admin links a member record by its id (/admin/members/{id}), never by the username.
  set('myMemberId', str(profile?.id), 'me/profile has no id');

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
    // Wartung (MNT-01/02): private to the owner, so only the owner's API names them.
    set('maintenanceItem', str(list((await get(`/vehicles/${String(main.id)}/maintenance-items`))?.data)[0]?.id), 'the main vehicle has no maintenance item');
    set('maintenanceLog', str(list((await get(`/vehicles/${String(main.id)}/maintenance-logs`))?.data)[0]?.id), 'the main vehicle has no service log entry');
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

  // Another member's public build, the member it belongs to: a showcase member's build first (database/data/showcase/members.json; a
  // real tester's account may follow nobody yet). The editors' sample builds (is_sample, the Speedclub Editorial account, which is no
  // member) were updated last and fill the first search pages, so the search is read page by page until a member's build turns up; the
  // editorial account gets pages of its own (CRAWL-…-editorial).
  const mine = new Set(vehicles.map((v) => v.slug));
  const showcase = showcaseUsernames();
  const ownerName = (v: Json | undefined) => str((v?.owner as Json | undefined)?.username);
  const isMemberBuild = (v: Json) => v.is_sample !== true && showcase.has(ownerName(v) ?? '');
  const builds: Json[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 6; page++) {
    const body = await get(`/search/vehicles?sort=updated${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    builds.push(...list(body?.data).filter((v) => !mine.has(v.slug)));
    cursor = str((body?.meta as Json | undefined)?.next_cursor);
    if (!cursor || builds.some(isMemberBuild)) break;
  }
  const other = builds.find(isMemberBuild) ?? builds.find((v) => v.is_sample !== true) ?? builds[0];
  set('otherSlug', str(other?.slug), 'no public vehicle of another member');
  set('otherUser', ownerName(other), other ? 'the other vehicle names no owner' : 'no public vehicle of another member');
  const editorial = builds.find((v) => v.is_sample === true);
  set('editorialSlug', str(editorial?.slug), 'no editorial sample build is listed (optional)');
  set('editorialUser', ownerName(editorial), 'no editorial sample build is listed (optional)');

  // Treffen (M4.12): ids from the lists the app reads. An after-RSVP place is hidden from everyone who is not going.
  const events = list((await get('/events'))?.data);
  const slugOf = (e: Json | undefined) => str(e?.slug);
  const placeOf = (e: Json) => str((e.location as Json | undefined)?.visibility);
  set('eventSlug', slugOf(events.find((e) => e.my_rsvp == null) ?? events[0]), 'no upcoming event is listed');
  set('memberEvent', slugOf(events.find((e) => e.is_sample !== true && e.my_rsvp == null)), 'no upcoming meet of a member (not a sample) that the crawl member has not answered (optional)');
  set('privateEvent', slugOf(events.find((e) => placeOf(e) === 'after_rsvp')), 'no upcoming event shows its place only after the RSVP (optional)');
  set(
    'privateEventOpen',
    slugOf(events.find((e) => placeOf(e) === 'after_rsvp' && e.my_rsvp !== 'going')),
    'the crawl member is going to every after-RSVP event, so none hides its place from them (optional)',
  );
  const going = list((await get('/me/events'))?.data);
  set('goingEvent', slugOf(going[0]), 'the member is going to no event');
  // Attendees: a sample event lists nobody to anyone but its organiser (09 §8.19, AttendeeController), so the list is read on a meet
  // of a member (DQ-1110), the one the member goes to first.
  set(
    'memberMeet',
    slugOf(going.find((e) => e.is_sample !== true) ?? events.find((e) => e.is_sample !== true)),
    'no upcoming meet organised by a member (not a sample): a sample event lists no attendees by rule (09 §8.19) (optional)',
  );
  const organised = list((await get('/me/events?tab=organised'))?.data);
  set('pendingEvent', slugOf(organised.find((e) => e.status === 'pending_review')), 'the member organises no event in review (optional)');
  set('draftEvent', slugOf(organised.find((e) => e.status === 'draft')), 'the member has no event draft (optional)');
  let past: Json | undefined;
  for (const organiser of [...new Set(events.map((e) => str((e.organiser as Json | undefined)?.username)))].filter((u) => u !== undefined).slice(0, 5)) {
    past = list((await get(`/public/users/${encodeURIComponent(organiser)}/events?when=past`))?.data)[0];
    if (past) break;
  }
  set('pastEvent', slugOf(past), 'no organiser of a listed event has a meet that is over (optional)');

  // STREET DEX (M5.9b): the member's spots, page by page.
  const dex: Json[] = [];
  let dexCursor: string | undefined;
  for (let page = 0; page < 6; page++) {
    const body = await get(`/me/dex${dexCursor ? `?cursor=${encodeURIComponent(dexCursor)}` : ''}`);
    dex.push(...list(body?.data));
    dexCursor = str((body?.meta as Json | undefined)?.next_cursor);
    if (!dexCursor) break;
  }
  const dexVehicle = (entry: Json | undefined) => (entry?.vehicle ?? {}) as Json;
  const spotted = dex.filter((entry) => entry.spotted === true);
  set('mySpot', str(spotted[0]?.spot_id), 'the member has spotted no car');
  set('dexCar', str(dexVehicle(spotted.find((entry) => dexVehicle(entry).ghost !== true)).id), 'the member has spotted no car');
  set('dexGhostCar', str(dexVehicle(spotted.find((entry) => dexVehicle(entry).ghost === true)).id), 'the member has found no Ghost car in person (optional)');
  const inDex = new Set(dex.map((entry) => str(dexVehicle(entry).id)));
  set('dexUnspottedCar', str(builds.find((v) => v.is_sample !== true && !inDex.has(str(v.id)))?.id), 'every listed public build of another member is in the member Dex (optional)');

  // Season Wrapped (M5.9e). The first read of a Wrapped sets viewed_at, which ends its "Neu" mark (PROF-01), so the crawl opens only a
  // released one the member has opened before, as it opens only read threads.
  const seasons = list((await get('/me/wrapped'))?.data);
  set('wrappedSeasonAny', str(seasons[0]?.season_key), 'the member has no Wrapped');
  const opened = seasons.find((s) => s.released === true && typeof s.viewed_at === 'string');
  set(
    'wrappedSeason',
    str(opened?.season_key),
    seasons.some((s) => s.released === true) ? 'the member has opened no released Wrapped yet, and the first read would end its "Neu" mark' : 'the member has no released Wrapped',
  );
  if (opened) {
    const cards = list(((await get(`/me/wrapped/${encodeURIComponent(String(opened.season_key))}`))?.data as Json | undefined)?.cards);
    for (const kind of WRAPPED_CARDS) {
      const index = cards.findIndex((card) => card.kind === kind);
      set(`wrappedCard_${kind}`, index >= 0 ? String(index + 1) : undefined, `the member's Wrapped ${String(opened.season_key)} has no ${kind} card`);
    }
  }

  // Invites (M5.9d): an open code, which a guest's AUTH-12 shows as the invitation.
  set('inviteCode', str(list((await get('/me/invites'))?.data).find((i) => i.accepted_at == null)?.code), 'the member has no open invite code');

  // Read without `get`: a flag that is off on a host (forum) answers 404 by design, which is no missing showcase data.
  const optional = async (path: string): Promise<Json | null> => {
    const response = await api.get(`/api/v1${path}`);
    return response.ok() ? ((await response.json()) as Json) : null;
  };

  // Sticker designs (M5.4, ShowcasePhase5): a published build whose current design has not passed the server Scan-Test yet (the
  // showcase's hero-3 draft), for STK-06 "Erst der Scan-Test". Reading the current design writes nothing.
  let notReady: string | undefined;
  for (const vehicle of published) {
    const design = (await optional(`/vehicles/${String(vehicle.id)}/sticker-design`))?.data as Json | undefined;
    if (design && design.validated_at == null) {
      notReady = str(vehicle.id);
      break;
    }
  }
  set('stickerDraftVehicle', notReady, 'every published build of the member has a design that passed the Scan-Test (optional)');

  // Forum (M5.8): the most active thread, the one FOR-01 lists first (a solved sample with its photo and attached car on the showcase).
  const threads = list((await optional('/forum/threads'))?.data);
  set('forumThread', str((threads.find((t) => t.is_solved === true) ?? threads[0])?.id), 'the forum is off or lists no thread (optional)');

  // Crews (R4-2.3, CREW-00…05): a listed crew, and one the member runs (founder or admin) for its edit and manage pages.
  const crews = list((await optional('/crews'))?.data);
  set('crewSlug', str(crews[0]?.slug), 'no crew is listed (optional)');
  const runs = list((await optional('/me/crews'))?.data).find((c) => ['founder', 'admin'].includes(String(((c.viewer ?? {}) as Json).role ?? '')));
  set('myCrew', str(runs?.slug), 'the member runs no crew (optional)');

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

/** `fresh`: a member signed up for this run, with nothing of their own (every own section is an empty state). */
export type Role = 'guest' | 'member' | 'fresh' | 'admin';
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
  /** A full-screen modal that has no `<ID>.root` (INTRO: `INTRO.screen`): the selector that proves it rendered. */
  rendered?: string;
};

/** The introduction (IntroScreen) is a full-screen pager without a `.root`: its backdrop `INTRO.screen` and its pager. */
const INTRO_RENDERED = '[data-testid="INTRO.screen"], [data-testid="INTRO.pager"]';

const SPA = (id: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({ id, path: `/app${path}`, kind: 'spa', ...extra });
const BLADE = (id: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({ id, path, kind: 'blade', ...extra });

const NO_REPORTS: AllowEmpty = { marker: /^SET-16\./, reason: 'a showcase member who never reported anything and has no decision about them is the expected state' };

/**
 * build_comments is on in local and staging (ADR-528), and the showcase seeds no comment: an invented conversation would be fake
 * activity (09 §8.19). An update nobody has commented on yet shows the comments section's empty state with its composer prompt.
 */
const NO_COMMENTS: AllowEmpty = {
  marker: /^VEH-05\.comments\.empty$/,
  reason: 'build_comments is on here (ADR-528) and nobody has commented on the showcase update yet; the showcase seeds no comments (no fake activity, 09 §8.19)',
};

/** A statePage that is deliberately a not-found or "only in the app" page, with the status it answers. */
const NOT_FOUND: Partial<PageSpec> = { expectStatus: [404], statePage: true };

export const GUEST_PAGES: PageSpec[] = [
  SPA('HOME-01', '/'),
  SPA('HOME-01-following-guest', '/?tab=following', {
    allowEmpty: [
      {
        marker: /^HOME-01\.following\.guest\.empty\.sample$/,
        reason: 'a guest follows nobody: Folge ich is the sign-in prompt with its badged sample lead (the subject of the registry cell HOME-01-following-guest)',
      },
    ],
  }),
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
  // The Build Score section with the build's real score is part of the visitor's Übersicht (VEH-01-score-visitor forces qaScore=sample).
  // M5.3: VEH-01 is one scroll (VEH-01-onescroll is the registry's picture of it on lukas.sc's R34).
  SPA('VEH-01', '/v/{mySlug}', { covers: ['VEH-01-similar', 'VEH-01-score-visitor', 'VEH-01-onescroll'] }),
  // M5.3 one scroll (ADR-505): the 2.0 tabs are sections, opened by `?section=` (VEH-01-sections: the index pinned at Mods).
  SPA('VEH-01-specs', '/v/{mySlug}?section=specs'),
  SPA('VEH-01-mods', '/v/{mySlug}?section=mods', { covers: ['VEH-01-sections'] }),
  SPA('VEH-01-history', '/v/{mySlug}?section=history'),
  SPA('VEH-08', '/v/{mySlug}/history'),
  SPA('VEH-02', '/v/{mySlug}/mods/{myMod}', { covers: ['VEH-02-similar'] }),
  SPA('VEH-03', '/v/{mySlug}/gallery'),
  SPA('VEH-04', '/viewer?slug={mySlug}&index={viewerIndex}'),
  SPA('VEH-05', '/v/{mySlug}/updates/{myUpdate}', { allowEmpty: [NO_COMMENTS] }),
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
  SPA('AUTH-12', '/auth/email'),
  // /join/{code} with one of the showcase member's open codes: AUTH-12 with the invitation (AUTH-12-invite forces qaGift=sample).
  SPA('AUTH-12-invite', '/join/{inviteCode}'),
  // The secure link without its token (cut, used or expired): the invalid-link state is what this path shows.
  SPA('AUTH-17-invalid', '/auth/secure', { statePage: true }),
  // A magic link opened in a browser without the sign-in attempt: the "type the code in the app" state is the page.
  SPA('WEB-16', '/auth/magic', { statePage: true }),
  SPA('ONB-01', '/onboarding?page=1'),
  SPA('ONB-02', '/onboarding?page=2'),
  SPA('ONB-03', '/onboarding?page=3'),
  SPA('COL-01-guest', '/profile/collections'),
  SPA('DEX-01-guest', '/dex'),
  SPA('WRP-01-guest', '/wrapped/{wrappedSeasonAny}'),
  SPA('SET-25', '/settings/about/whats-new'),
  // M5.5 Shop (flag shop on), R5-3: the three categories, the sticker category page (ShopSampleSeeder, badged samples), a coming
  // category, the old filter address (redirects to its category page) and every product page. No store is configured on this host, so
  // the Shopify products show "Bald im Shop erhältlich".
  SPA('SHOP-01-catalogue', '/shop'),
  SPA('SHOP-03-sticker', '/shop/c/sticker'),
  SPA('SHOP-03-soon', '/shop/c/apparel'),
  SPA('SHOP-01-filtered', '/shop?category=sticker'),
  SPA('SHOP-02-designer', '/shop/car-sticker'),
  SPA('SHOP-02-unavailable', '/shop/round-badge'),
  SPA('CRAWL-SHOP-02-banner', '/shop/schriftzug-banner'),
  // M5.8 Forum (flag forum on): a top-level category with its sub-forums and the seeded sample threads (ForumSampleSeeder).
  SPA('FOR-02', '/forum/c/technik-tuning'),
  SPA('CRAWL-FOR-03-guest', '/forum/{forumThread}'),
  // R4-2.3 Crews (04 §CREW-00/01; no registry cell yet): the list and a crew page as a visitor.
  SPA('CRAWL-CREW-00-guest', '/crews'),
  SPA('CRAWL-CREW-01-guest', '/crews/{crewSlug}'),
  // R4-1.4 Einführung (04 INTRO-01…04): a guest's run changes nothing on the server.
  SPA('CRAWL-INTRO-01-guest', '/intro', { rendered: INTRO_RENDERED }),
  SPA('SYS-03', '/this-link-does-not-exist', { statePage: true }),
  BLADE('WEB-03', '/'),
  BLADE('WEB-01', '/v/{mySlug}'),
  BLADE('CRAWL-WEB-01-other', '/v/{otherSlug}'),
  BLADE('CRAWL-WEB-01-editorial', '/v/{editorialSlug}'),
  BLADE('WEB-02', '/u/{myUsername}'),
  BLADE('CRAWL-WEB-02-other', '/u/{otherUser}'),
  BLADE('CRAWL-WEB-02-editorial', '/u/{editorialUser}'),
  BLADE('WEB-13', '/e/{eventSlug}'),
  BLADE('WEB-13-private', '/e/{privateEvent}'),
  BLADE('WEB-13-member', '/e/{memberEvent}'),
  BLADE('WEB-13-past', '/e/{pastEvent}'),
  BLADE('WEB-13-missing', '/e/gibt-es-nicht', NOT_FOUND),
  // businesses is off on every environment (ADR-455): every /b/{slug} answers the "Betrieb nicht verfügbar" 404, and with the flag on an
  // unknown slug answers the same page. WEB-14 and WEB-15 (the flag on) are stage-fixture cells, see EXCLUDED.
  BLADE('WEB-14-off', '/b/qa-betrieb-gibt-es-nicht', NOT_FOUND),
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
  // M5.9d WEB-17 (04): the invite landing of one of the showcase member's open codes.
  BLADE('CRAWL-WEB-17', '/join/{inviteCode}'),
  // The deliberate 404: an unknown sticker code.
  BLADE('WEB-06-notfound', '/C/ZZZZZZZZ', { expectStatus: [404], statePage: true }),
  BLADE('WEB-06-revoked', '/C/{revokedCode}?qaMotion=off', { expectStatus: [410], statePage: true }),
  { id: 'ADM-01', path: '/admin/login', kind: 'admin', desktopOnly: true },
  { id: 'ADM-04', path: '/admin/forgot-password', kind: 'admin', desktopOnly: true },
];

export const MEMBER_PAGES: PageSpec[] = [
  // Für dich with the real stream: scrolled through (HOME-01-member-long) and with the day's Car of the Day lead (HOME-01-cotd forces
  // qaGift=sample).
  SPA('HOME-01-member', '/', { covers: ['HOME-01-member-long', 'HOME-01-cotd'] }),
  SPA('HOME-01-following', '/?tab=following'),
  SPA('HOME-02', '/notifications'),
  // The seeded curated collections and the weekend's meets are sections of the member's Entdecken.
  SPA('DISC-01-member', '/discover', { covers: ['DISC-01-collections', 'DISC-01-events'] }),
  // "Nächste Fälligkeiten" (the showcase member's maintenance items) and each card's compact Build Score (GAR-01-score forces qaScore).
  SPA('GAR-01', '/garage', { covers: ['GAR-01-due', 'GAR-01-score'] }),
  SPA('GAR-02', '/garage/{myVehicleId}'),
  SPA('GAR-05', '/garage/{myVehicleId}/basics'),
  SPA('GAR-06', '/garage/{myVehicleId}/specs'),
  SPA('GAR-07', '/garage/{myVehicleId}/photos'),
  SPA('GAR-08', '/garage/{myVehicleId}/photos/{myPhoto}'),
  SPA('GAR-09', '/garage/{myVehicleId}/mods'),
  SPA('GAR-10', '/garage/{myVehicleId}/mods/{myMod}'),
  SPA('GAR-10-new', '/garage/{myVehicleId}/mods/new?category=wheels_tires'),
  // M5.3 "Plan anlegen": the editor with Geplant preset, asking for the system first, and with a system chosen (the plan group).
  SPA('GAR-10-plan-pick', '/garage/{myVehicleId}/mods/new?status=planned'),
  SPA('GAR-10-plan', '/garage/{myVehicleId}/mods/new?status=planned&category=suspension'),
  SPA('GAR-11', '/garage/{myVehicleId}/history'),
  SPA('GAR-12', '/garage/{myVehicleId}/visibility', { covers: ['GAR-12-spots'] }),
  SPA('MNT-01', '/garage/{myVehicleId}/maintenance'),
  SPA('MNT-02', '/maintenance-editor/{myVehicleId}?kind=item&item={maintenanceItem}'),
  SPA('MNT-02-new', '/maintenance-editor/{myVehicleId}?kind=item'),
  SPA('MNT-02-log', '/maintenance-editor/{myVehicleId}?kind=log&log={maintenanceLog}'),
  SPA('MNT-03', '/settings/reminders'),
  SPA('GAR-03', '/add-vehicle/new/vehicle', {
    allowEmpty: [
      {
        marker: /^GAR-03\.vehPreview\.empty$/,
        reason: 'the desktop Vorschau pane of a new vehicle before its first photo: the badged sample stage with "Foto hinzufügen" (DQ-1218); a form that was just opened has nothing to preview',
      },
    ],
  }),
  SPA('GAR-03-specs', '/add-vehicle/{draft}/specs'),
  SPA('GAR-03-photos', '/add-vehicle/{draft}/photos'),
  SPA('GAR-03-review', '/add-vehicle/{draft}/review'),
  SPA('GAR-04', '/published/{myVehicleId}'),
  // The owner on their own build: the OwnerCapsule (VEH-01-owner), the spot line (VEH-01-spots forces qaDex) and the Build Score with
  // "Nächstes Upgrade" (VEH-01-score forces qaScore) on the real data.
  SPA('CRAWL-VEH-01-own', '/v/{mySlug}', { covers: ['VEH-01-owner', 'VEH-01-spots', 'VEH-01-score'] }),
  // M5.3 Pläne for the owner: the showcase's plans (ShowcasePhase5: target month, priority, the owner-only budget).
  SPA('VEH-01-plans-owner', '/v/{mySlug}?section=plans'),
  SPA('VEH-05-owner', '/v/{mySlug}/updates/{myUpdate}', { allowEmpty: [NO_COMMENTS] }),
  SPA('UPD-01', '/post-update?vehicleId={myVehicleId}'),
  SPA('UPD-01-beforeAfter', '/post-update?vehicleId={myVehicleId}&kind=before_after'),
  SPA('VEH-01-member', '/v/{otherSlug}'),
  // The server card with the build's real score (VEH-07-gift forces qaScore).
  // The server card with the build's real score (VEH-07-gift forces qaScore) and its customiser (VEH-07-customise opens this screen
  // from VEH-01's "Mehr" sheet).
  SPA('VEH-07', '/share-card/{myVehicleId}', { covers: ['VEH-07-gift', 'VEH-07-customise'] }),
  SPA('STK-01', '/stickers'),
  SPA('STK-02', '/stickers/{myVehicleId}'),
  SPA('STK-02-preview', '/stickers/{myVehicleId}/preview'),
  SPA('STK-03', '/stickers/{myVehicleId}/placement'),
  // The real counts of the main build's code (STK-04-data photographs them on the m54-stickers fixture).
  SPA('STK-04', '/stickers/{myVehicleId}/stats', { covers: ['STK-04-data'] }),
  // The main build's ordered Banner design passed the server Scan-Test (ShowcasePhase5 hero-main; STK-05-passed is that state).
  SPA('STK-05', '/stickers/{myVehicleId}/design', { covers: ['STK-05-passed'] }),
  SPA('STK-05-car', '/stickers/{myVehicleId}/design?mode=car'),
  SPA('STK-05-ruler', '/stickers/{myVehicleId}/design?mode=ruler'),
  SPA('STK-06', '/stickers/{myVehicleId}/order'),
  // The showcase's hero-3 build has a Round draft without a Scan-Test: "Erst der Scan-Test".
  SPA('STK-06-notReady', '/stickers/{stickerDraftVehicle}/order'),
  SPA('STK-07', '/stickers/{myVehicleId}/history'),
  // The owner scanning their own sticker in the app: no scan is counted for the owner (QrScans::counts).
  SPA('WEB-06-app', '/c/{myCode}', { expectFinalPath: '^/app/v/{mySlug}/?$' }),
  // Level, Founding line and badges (PROF-01-gift forces qaGift), the "Mein Dex" row (PROF-01-dex), the "Dein Wrapped" row
  // (PROF-01-wrapped) on the showcase member's real data.
  // PROF-01-insights is the "Statistiken" row of the same group, scrolled to.
  SPA('PROF-01', '/profile', { covers: ['PROF-01-gift', 'PROF-01-dex', 'PROF-01-wrapped', 'PROF-01-insights'] }),
  SPA('PROF-01-updates', '/profile?tab=updates'),
  SPA('PROF-01-events', '/profile?tab=events'),
  SPA('PROF-01-saved', '/profile?tab=saved'),
  // Another member's level and earned badges (PROF-02-gift forces qaGift).
  SPA('PROF-02', '/u/{otherUser}', { covers: ['PROF-02-gift'] }),
  SPA('PROF-02-updates', '/u/{otherUser}?tab=updates'),
  SPA('CRAWL-PROF-02-editorial', '/u/{editorialUser}'),
  SPA('PROF-03', '/profile/edit'),
  SPA('PROF-04', '/profile/connections?tab=followers'),
  SPA('PROF-04-member', '/u/{otherUser}/connections?tab=following'),
  SPA('CRAWL-PROF-04-editorial', '/u/{editorialUser}/connections?tab=following', {
    allowEmpty: [
      {
        marker: /^PROF-04\.empty$/,
        reason: 'the Speedclub Editorial account follows nobody and has no followers by rule: no invented numbers on samples (09 §8.19, DemoShowcaseSeeder follow rules)',
      },
    ],
  }),
  SPA('COL-01', '/profile/collections'),
  // DQ-1087: PROF-05 opens the "Gespeichert" collection (COL-02).
  SPA('PROF-05', '/profile/saved', { expectFinalPath: '^/app/profile/collections/[0-9a-z]+/?$', covers: ['COL-02'] }),
  SPA('BDG-01', '/profile/badges'),
  SPA('INV-01', '/settings/invites'),
  SPA('DEX-01', '/dex'),
  SPA('DEX-02', '/scan'),
  // One of the showcase member's real spots: the live reveal with its actions (DEX-03-live reads a public car as a reveal under
  // qaDex=live because the registry's lukas.sc has no spot of his own).
  SPA('DEX-03', '/dex/spot/{mySpot}', { covers: ['DEX-03-live'] }),
  // DEX-04-live: the same page on a car the showcase member really spotted ({dexCar} is one, from GET me/dex); the registry cell only
  // picks the car seen in the most cities.
  SPA('DEX-04', '/dex/car/{dexCar}', { covers: ['DEX-04-live'] }),
  SPA('DEX-04-ghost', '/dex/car/{dexGhostCar}'),
  SPA('DEX-04-preview', '/dex/car/{dexUnspottedCar}'),
  SPA('DEX-05', '/dex/sets'),
  SPA('DEX-06', '/vehicles/{myVehicleId}/spots'),
  SPA('WRP-01', '/wrapped/{wrappedSeason}?card={wrappedCard_intro}'),
  SPA('WRP-01-spots', '/wrapped/{wrappedSeason}?card={wrappedCard_spots}'),
  SPA('WRP-01-scans', '/wrapped/{wrappedSeason}?card={wrappedCard_scans}'),
  SPA('WRP-01-score', '/wrapped/{wrappedSeason}?card={wrappedCard_score}'),
  SPA('WRP-01-top-mod', '/wrapped/{wrappedSeason}?card={wrappedCard_top_mod}'),
  SPA('WRP-01-treffen', '/wrapped/{wrappedSeason}?card={wrappedCard_treffen}'),
  SPA('WRP-01-build-spirit', '/wrapped/{wrappedSeason}?card={wrappedCard_build_spirit}'),
  SPA('WRP-01-percentile', '/wrapped/{wrappedSeason}?card={wrappedCard_percentile}'),
  SPA('WRP-01-share', '/wrapped/{wrappedSeason}?card={wrappedCard_share}'),
  SPA('EVT-01', '/events'),
  // Karte by link: the map's consent gate; tiles of OpenFreeMap load only after the tap, so nothing reaches a third party.
  SPA('EVT-01-map', '/events?view=map'),
  SPA('EVT-01-upcoming', '/events?when=upcoming'),
  SPA('EVT-02', '/events/{eventSlug}'),
  SPA('EVT-02-member', '/events/{memberEvent}'),
  SPA('EVT-02-private', '/events/{privateEventOpen}'),
  SPA('EVT-02-going', '/events/{goingEvent}'),
  SPA('EVT-04-member', '/events/{memberMeet}/attendees'),
  SPA('EVT-02-organiser', '/events/{pendingEvent}'),
  SPA('EVT-03-frozen', '/event-editor/{pendingEvent}'),
  SPA('EVT-04', '/events/{pendingEvent}/attendees', {
    // The registry's EVT-04 is this page of an event in review (routes-m412-evt.mjs): nobody can answer an event before it is
    // published, so its list is empty and the page shows the badged sample of what will appear.
    allowEmpty: [{ marker: /^EVT-04\.empty(\.preview|\.sample)?$/, reason: 'an event in review cannot be answered yet: its attendee list is empty until it is published (the registry cell of EVT-04)' }],
  }),
  SPA('EVT-06', '/events/{pendingEvent}/manage'),
  SPA('EVT-03-draft', '/event-editor/{draftEvent}'),
  SPA('EVT-03-new', '/event-editor/new'),
  SPA('EVT-05', '/profile/events?tab=organised'),
  // parts_catalogue and membership are off on every environment (ADR-455, 09 §16 #14): the calm off states, nothing asked of the API.
  SPA('BRD-01-off', '/brands/kw', { statePage: true }),
  SPA('MEM-01-off', '/membership', { statePage: true }),
  // M5.8 Forum (flag forum on): the seeded sample threads (ForumSampleSeeder), sorted from the address, one thread, the composer.
  SPA('FOR-01', '/forum'),
  SPA('FOR-01-unanswered', '/forum?sort=unanswered'),
  SPA('FOR-03', '/forum/{forumThread}'),
  SPA('FOR-04', '/forum-composer?category=fahrwerk'),
  SPA('FOR-05', '/forum/mine', {
    allowEmpty: [
      {
        marker: /^FOR-05\.(empty|emptySubscriptions)(\.[\w.-]+)?$/,
        reason: 'the showcase account has started and subscribed to no thread: ForumSampleSeeder writes its 25 sample threads under the sample members (me/forum/threads and me/forum/subscriptions are empty), so Meine Themen shows its badged sample row and "Thema starten"',
      },
    ],
  }),
  // M5.7 Statistiken (flag insights on): the showcase's view history (ShowcasePhase5 view_days), the account and the main build.
  SPA('INS-01', '/insights'),
  SPA('INS-01-vehicle', '/vehicles/{myVehicleId}/insights'),
  // M5.5 Shop as a member (the catalogue with "Dein Sticker").
  SPA('CRAWL-SHOP-01-member', '/shop'),
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
  SPA('SET-01-search', '/settings?q=reifen'),
  // The deliberate search without a match: its "Nichts zu „vergaser“ gefunden." is the page.
  SPA('SET-01-search-empty', '/settings?q=vergaser', { statePage: true }),
  SPA('SET-02', '/settings/account'),
  SPA('SET-03', '/settings/account/email'),
  SPA('SET-04', '/settings/security/password'),
  SPA('SET-05', '/settings/security/two-factor'),
  SPA('SET-06', '/settings/security/sessions'),
  SPA('SET-19', '/settings/security/sign-in', {
    allowEmpty: [
      {
        marker: /^SET-19\.passkeys\.empty$/,
        reason: 'a passkey is a credential bound to the member\'s own device (WebAuthn); a seeded one would be a fake no device of the client can use, so a demo account honestly has none (me/sign-in-methods passkeys.count 0) and the section shows its badged sample',
      },
    ],
  }),
  SPA('SET-21', '/settings/security/activity'),
  SPA('AUTH-14', '/auth/passkey-offer'),
  SPA('AUTH-17-invalid-member', '/auth/secure', { statePage: true }),
  // The "Spots" group of the real privacy settings (SET-07-spots names the same path).
  SPA('SET-07', '/settings/privacy', { covers: ['SET-07-spots'] }),
  SPA('SET-08', '/settings/privacy/blocked', {
    // The empty state's sample row (SET-08.empty.preview) is part of that state, not a second empty section.
    allowEmpty: [{ marker: /^SET-08\.empty(\.preview)?$/, reason: 'a showcase member who has blocked nobody is the expected state' }],
  }),
  // The real categories, incl. Spots, the four gift categories (SET-09-spots and SET-09-gift force qaDex/qaGift), Forum (forum is on),
  // "Neue Treffen in deiner Nähe" and the engagement types Build-Erinnerungen and Wochenrückblick (me/settings lists event_nearby,
  // plan_due and weekly_recap; the registry cells staged them before the server did).
  SPA('SET-09', '/settings/notifications', { covers: ['SET-09-spots', 'SET-09-gift', 'SET-09-forum', 'SET-09-nearby', 'SET-09-engagement'] }),
  SPA('CRAWL-SET-10-member', '/settings/appearance', { covers: ['SET-10-member'] }),
  SPA('SET-22', '/settings/appearance/icon'),
  SPA('SET-11', '/settings/language', { covers: ['SET-11-units'] }),
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
  // R4-2.3 Crews (04 CREW-00…05; no registry cell yet).
  SPA('CRAWL-CREW-00', '/crews'),
  SPA('CRAWL-CREW-01', '/crews/{crewSlug}'),
  SPA('CRAWL-CREW-02-new', '/crews/new'),
  SPA('CRAWL-CREW-02-edit', '/crews/{myCrew}/edit'),
  SPA('CRAWL-CREW-03', '/crews/{myCrew}/manage'),
  SPA('CRAWL-CREW-03-requests', '/crews/{myCrew}/requests'),
  SPA('CRAWL-CREW-04', '/crews/mine'),
  SPA('CRAWL-CREW-05', '/crews/invites'),
  // R4-1.4 Einführung opened again from Hilfe (`replay=1` changes nothing on the server; the first run's close sets intro_seen_at).
  SPA('CRAWL-INTRO-01', '/intro?replay=1', { rendered: INTRO_RENDERED }),
  // 04 QR-01…04 (the 1.0 sticker screens, still routed): the member's codes, one code, the placement guide and the page preview.
  SPA('CRAWL-QR-01', '/profile/qr'),
  SPA('CRAWL-QR-02', '/qr/{myVehicleId}'),
  SPA('CRAWL-QR-03', '/qr/{myVehicleId}/placement'),
  SPA('CRAWL-QR-04', '/qr/{myVehicleId}/preview'),
];

/**
 * The new member of the run (persona `fresh`): the member pages, filled with the ids the new account can read (another member's build,
 * events, crews, the forum). A page that needs something of their own (a vehicle, a spot, a Wrapped) is not visited, with the reason.
 * First the introduction a new account opens after its first sign-in (04 INTRO-01; its close sets intro_seen_at, crawl/showcase.spec.ts).
 */
export const FRESH_PAGES: PageSpec[] = [
  SPA('CRAWL-INTRO-01-fresh', '/intro', { rendered: INTRO_RENDERED }),
  ...MEMBER_PAGES.filter((p) => p.id !== 'CRAWL-INTRO-01'),
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

  // --- Phase 4 and 5 registry cells (M4.9–M4.18, M5.9a–e) that are no page of their own on real data -------------------------------
  'AUTH-01': 'QA override ?splash=hold (non-production only) holds the cold-start splash for a picture; an automated browser starts on its screen',
  'HOME-01-member-offline': 'offline state: the visual runner takes the network away; the crawl checks every page online',
  'COL-01-empty': 'fixture: nina.neu, a member who saved nothing (the empty Sammlungen state); COL-01 is crawled with the showcase member',
};

/** Registry cells that need a stage fixture, a QA override (qaFlags, qaOpen, qaPush, qaDex/qaScore/qaGift/qaWrapped on a sample id) or a
 * walk/prepare step of the visual runner (taps, staged API answers): they are photographed there, and the crawl visits the same route
 * on the showcase data under the id named in the reason. */
const STAGED: Record<string, string> = {
  // M4.14 parts, brands, businesses: off on every environment (ADR-455); the off states are crawled (BRD-01-off, WEB-14-off).
  ...Object.fromEntries(
    ['BRD-01', 'BRD-02', 'BRD-02-affiliate', 'BIZ-01', 'BIZ-01-sample', 'BIZ-02', 'BIZ-02-edit', 'BIZ-02-step2', 'BIZ-02-step3', 'BIZ-02-step4', 'BIZ-02-step5', 'BIZ-02-status-applied', 'BIZ-02-status-rejected', 'BIZ-03', 'BIZ-04', 'BIZ-05', 'DISC-01-parts', 'DISC-01-businesses', 'VEH-02-product', 'GAR-10-parts', 'WEB-14', 'WEB-15'].map((id) => [
      id,
      'stage fixture m414-flags (parts_catalogue and businesses switched on for the capture) with qaFlags; both flags are off on every environment (ADR-455), so the showcase shows their off states, crawled as BRD-01-off and WEB-14-off',
    ]),
  ),
  'MEM-01': 'QA flag override qaFlags=membership; the flag is off on every environment until the client signs off perks and price (09 §16 #14); the off state is crawled as MEM-01-off',
  'SET-24': 'QA flag override qaFlags=membership (off on every environment, 09 §16 #14); SET-01 is crawled without the row',
  'STK-01-sample': 'QA override qaStickers=sample (bundled, "Beispiel"-badged scan counts, M5.4); STK-01 is crawled with the real counts',
  'STK-04-sample': 'QA override qaStickers=sample (bundled, "Beispiel"-badged 30 days, M5.4); STK-04 is crawled with the real counts',
  'SET-09-webpush-off': 'QA override qaPush forces the browser\'s push permission state; SET-09 is crawled with the browser\'s own state',
  'SET-09-webpush-on': 'QA override qaPush forces the browser\'s push permission state; SET-09 is crawled with the browser\'s own state',
  'SET-09-webpush-denied': 'QA override qaPush forces the browser\'s push permission state; SET-09 is crawled with the browser\'s own state',
  'SET-09-webpush-needsInstall': 'QA override qaPush forces the browser\'s push permission state; SET-09 is crawled with the browser\'s own state',
  'SET-01-install': 'QA override qaOpen=installHint holds the install hint open for a picture; SET-01 is crawled',
  'GAR-01-plateCheck': 'QA override qaOpen=plateCheck holds the "Kennzeichen prüfen" card open; GAR-01 is crawled',
  'GAR-07-plateBlur': 'QA override qaOpen=plateBlur: the upload editor between the photo picker and the queue, which only a picked file opens; GAR-07 is crawled',
  // M4.12 events: a state that needs the stage fixture's map tiles.
  'EVT-01-spots': 'the Spots layer is drawn on the map, which loads OpenFreeMap tiles (a third party) only after its consent tap; the crawl blocks third parties and visits Karte with its gate (EVT-01-map); the layer is covered by flows/f18-spot-layer.spec.ts',
  // M5.9b STREET DEX: the reveal variants of one spot, forced on the sample spot.
  'DEX-03-duplicate': 'QA override qaDex=duplicate on the sample spot (the reveal variant of a scan); DEX-03 is crawled on one of the showcase member\'s real spots',
  'DEX-03-first': 'QA override qaDex=first on the sample spot (the reveal variant of a scan); DEX-03 is crawled on one of the showcase member\'s real spots',
  'DEX-03-ghost': 'QA override qaDex=ghost on the sample spot (the reveal variant of a scan); DEX-03 is crawled on one of the showcase member\'s real spots',
  'DEX-03-young': 'QA override qaDex=young on the sample spot (an account younger than a day); DEX-03 is crawled on one of the showcase member\'s real spots',
  'DEX-01-rarity': 'sheet opened by a tap (walk) over DEX-01, which is crawled',
  // M5.9c Build Score: states and sheets.
  'VEH-01-score-pending': 'QA override qaScore=pending plus a walk: the score before its first computation; VEH-01 is crawled with the real score',
  'VEH-01-score-error': 'QA override qaScore=error plus a walk: a failed score read; VEH-01 is crawled with the real score',
  'VEH-01-score-formula': 'sheet opened by a tap (walk) over VEH-01, which is crawled',
  'VEH-01-journey': 'sheet opened by a tap (walk) over VEH-01, which is crawled',
  'UPD-01-beforeAfter-invalid': 'validation state reached by tapping "Posten" (walk); UPD-01-beforeAfter is crawled',
  // M5.9d supporting system: sheets and the one toast of an app start.
  'PROF-01-level': 'sheet opened by a tap (walk) over PROF-01, which is crawled',
  'PROF-01-badge': 'sheet opened by a tap (walk) over PROF-01, which is crawled',
  'HOME-01-cotd-owner': 'the owner\'s story editor sheet, opened by a tap (walk) on the owner\'s own Car of the Day; HOME-01-member is crawled',
  'HOME-01-badgeToast': 'QA override qaGift=stack: the unlock toast, shown once per app start; the crawl meets the real toast on its first member page and keeps the unseen badges (crawl/lib.ts useMemberSession)',
  // M5.9e Wrapped: the states before a release.
  'WRP-01-notReleased': 'QA override qaWrapped=countdown: a Wrapped before its release date (403); the showcase member\'s Wrapped is released, and WRP-01 is crawled card by card',
  'HOME-01-wrappedCountdown': 'QA override qaWrapped=countdown: the banner of the 7 days before a release date (me/wrapped meta.countdown); HOME-01-member is crawled with the real meta',
  // M4.18 sign-in 2.0: walks and staged answers of routes-m418-gaps.mjs (fictional QA data, never sent).
  'AUTH-12-validation': 'validation state reached by a walk (an address without "@" sent); AUTH-12 is crawled',
  'AUTH-13': 'needs a code sent to a real address: staged answers of the visual runner (never sent); AUTH-12 is crawled',
  'AUTH-13-wrong': 'needs a code sent to a real address: staged answers of the visual runner (never sent); AUTH-12 is crawled',
  'AUTH-13-expired': 'needs a code sent to a real address: staged answers of the visual runner (never sent); AUTH-12 is crawled',
  'AUTH-13-locked': 'needs a code sent to a real address: staged answers of the visual runner (never sent); AUTH-12 is crawled',
  'AUTH-16': 'needs a provider sign-in whose address belongs to an account: staged answers of the visual runner; AUTH-12 is crawled',
  'AUTH-16-wrong': 'needs a provider sign-in whose address belongs to an account: staged answers of the visual runner; AUTH-12 is crawled',
  'AUTH-17': 'needs the token of a login-alert mail ("Das war ich nicht"); the token-less link is crawled as AUTH-17-invalid',
  'AUTH-17-done': 'state after "Konto jetzt sichern", which signs every device out: staged answers of the visual runner; AUTH-17-invalid is crawled',
  'AUTH-09b': 'fixture: finish.fixture, a new passwordless account at its AGB step (member-finish)',
  'AUTH-09b-validation': 'fixture: finish.fixture, a new passwordless account at its AGB step (member-finish), plus a walk',
  'SET-19-menu': 'staged passkeys (prepare) plus a tap (walk); SET-19 is crawled with the showcase member\'s own sign-in methods',
  'SET-19-rename': 'staged passkeys (prepare) plus a tap (walk); SET-19 is crawled with the showcase member\'s own sign-in methods',
  'SET-19-remove': 'staged passkeys (prepare) plus a tap (walk); SET-19 is crawled with the showcase member\'s own sign-in methods',
  REAUTH: 'the reauth sheet after a staged 403 reauthentication_required (prepare + walk); SET-19 is crawled',
  'REAUTH-code': 'the reauth sheet on a staged e-mail code (prepare + walk); SET-19 is crawled',
  'SET-21-notme': 'dialog opened by a tap (walk) on a staged sign-in; SET-21 is crawled with the showcase member\'s own activity',
  'SYS-01': 'needs an app-config that demands an update (prepare stubs it); on a live host the path shows the app',
  'SYS-02': 'needs an app-config in maintenance (prepare stubs it); a live host in maintenance would stop the whole crawl',
  'SYS-02-message': 'needs an app-config in maintenance with the team\'s message (prepare stubs it)',
  'WEB-02-stage': 'seed-specific shape (jann.ptrs of the DemoSeeder: no cover of his own, one photo per build) for the brand stage; WEB-02, CRAWL-WEB-02-other and CRAWL-WEB-02-editorial are crawled',
  // --- Phase 5 registry cells (M5.3–M5.9) that are no page of their own on the showcase data ------------------------------------------
  ...Object.fromEntries(
    ['STK-05-expanded', 'STK-05-qroff', 'STK-05-line', 'STK-05-minimal', 'STK-05-banner', 'STK-05-plate', 'STK-05-vertical', 'STK-05-round'].map((id) => [
      id,
      'QA override qaDesigner (a designer preview that saves nothing, compiled out of production); STK-05, STK-05-car and STK-05-ruler are crawled on the showcase member\'s real designs',
    ]),
  ),
  'STK-07-empty': 'a build without any sticker design: every published build of the showcase member has at least one version (ShowcasePhase5), so STK-07 is crawled with the real history',
  'SHOP-01': 'stage fixture: the shop flag switched off for the capture (prepare withShopOff); shop is on here, so the catalogue is crawled as SHOP-01-catalogue',
  'SHOP-01-live': 'staged answer: the seeded products with their sample flag switched off (prepare asRealProducts); SHOP-01-catalogue is crawled with the real, badged samples',
  'SHOP-03-live': 'staged answer: the sticker category with the seeded products\' sample flag switched off (prepare asRealProducts); SHOP-03-sticker is crawled with the real, badged samples',
  'SHOP-02-external': 'staged answer: a product with a configured store (prepare withStore); no store is configured on this host, so the same product is crawled as CRAWL-SHOP-02-banner ("Bald im Shop erhältlich")',
  'HOME-01-member-unread': 'staged answer: 12 unread messages (prepare withManyUnreadMessages); HOME-01-member is crawled with the real unread count',
  'VEH-01-specs-expanded': 'opened in place by a tap (walk) on "Alle Daten anzeigen" over VEH-01-specs, which is crawled',
  'VEH-01-mods-expanded': 'opened in place by a tap (walk) on "+ 1 weitere" over VEH-01-mods, which is crawled',
  'VEH-01-plans-install': 'dialog opened by a tap (walk) on "Als verbaut markieren" over VEH-01-plans-owner, which is crawled; confirming would change the showcase',
  'VEH-01-plans-empty-owner': 'staged answer without plans (prepare) plus a walk; the showcase member\'s builds have plans, crawled as VEH-01-plans-owner',
  'GAR-10-plan-leaving': 'state reached by a walk (a filled plan switched to Verbaut) over GAR-10-plan, which is crawled',
  'GAR-02-goal': 'staged build goal (prepare): no showcase build has a build goal (vehicles.build_goal_season is the owner\'s own choice); GAR-02 is crawled',
  'GAR-02-goalSheet': 'sheet opened by a tap (walk) over GAR-02, which is crawled',
  'VEH-01-goal': 'staged build goal (prepare) as kenji.r34 on lukas.sc\'s R34: no showcase build has a build goal; VEH-01 and VEH-01-member are crawled',
  'EVT-01-weekEmpty': 'staged dates (prepare): a week without meets but later ones; EVT-01 is crawled with the real week',
  'EVT-02-gallery': 'events.gallery is off on this host: the stage fixture m56-gallery switches it on for the capture; EVT-02-* are crawled without the gallery',
  'EVT-02-gallery-all': 'events.gallery is off on this host (stage fixture m56-gallery) and the full gallery opens by a tap (walk)',
  ...Object.fromEntries(
    ['EVT-02-checkin', 'EVT-02-checkin-sheet', 'EVT-02-wasThere', 'EVT-06-m56', 'EVT-06-code', 'EVT-07', 'EVT-07-success', 'PROF-01-checkins'].map((id) => [
      id,
      'events.checkin is off on this host (qaFlags=events.checkin) and the cell stages a running meet, the organiser\'s rotating code or a check-in answer (prepare/walk); EVT-02-*, EVT-06 and PROF-01-events are crawled without check-in',
    ]),
  ),
  'FOR-01-sortSheet': 'sheet opened by a tap (walk) over FOR-01, which is crawled',
  'FOR-03-locked': 'staged answer (prepare): the forum seed has no locked thread; FOR-03 is crawled on a real thread',
  'FOR-03-pending': 'staged answer (prepare): the crawl member\'s own thread in pre-moderation; the showcase member has started no thread; FOR-03 is crawled on a real thread',
  'FOR-04-similar': 'state reached by typing a title (walk) in FOR-04, which is crawled',
  'FOR-04-validation': 'validation state reached by submitting the empty form (walk) in FOR-04, which is crawled',
  'INS-01-drop': 'staged insights answer (prepare, a quieter week whose numbers add up); INS-01 is crawled with the showcase member\'s real view history',
  'INS-01-zero': 'staged insights answer (prepare, nothing counted yet); INS-01 is crawled with the showcase member\'s real view history',
  'INS-01-viewas': 'staff view-as tab: started per run through support/backend.php start-view-as',
  'VEH-07-square': 'chosen by a tap (walk) in the VEH-07 customiser, which is crawled',
  'VEH-07-square-light': 'chosen by taps (walk) in the VEH-07 customiser, which is crawled',
  'VEH-07-custom': 'chosen by taps (walk) in the VEH-07 customiser, which is crawled',
  // M5.9 [AI] cells: every ai.* flag is off (no provider key, OA-18); the cells force the flag with qaFlags and stage the AI answer.
  ...Object.fromEntries(
    [
      'GAR-03-specsAi',
      'GAR-03-specsAi-variants',
      'GAR-03-specsAi-taken',
      'GAR-03-specsAi-loading',
      'GAR-03-specsAi-error',
      'GAR-06-specsAi',
      'GAR-06-specsAi-taken',
      'GAR-06-specsAi-loading',
      'GAR-06-specsAi-error',
      'GAR-10-match',
      'GAR-10-match-none',
      'FOR-03-summary',
      'FOR-03-summary-open',
      'VEH-01-aiSpecs',
    ].map((id) => [id, 'QA flag override (qaFlags) of an [AI] feature that is off (ai.* off, OA-18) with a staged AI answer']),
  ),
  'WEB-01-aiSpecs': 'stage fixture m59-ai-specs (vehicle_specs.ai_fields set for the capture only) of an [AI] feature that is off (OA-18); WEB-01 is crawled',
};
Object.assign(EXCLUDED, STAGED);

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
  { uri: /\/wrapped\/\{season\}\/cards\/\{n\}\.png$/, reason: 'staff-only Season Wrapped card image (PNG, M5.9e admin), not a page' },
  { uri: /^\/admin\/content\/badges\/preview$/, reason: 'JSON count of the badge rule preview (ADM-63, M5.9d admin), not a page' },
  {
    uri: /^\/admin\/stickers\/designs\/\{design\}\/print\.(pdf|svg)$/,
    reason: 'print file of a sticker design (ADM-65, m5.4-contract §8): an attachment, each download audited (sticker.print_downloaded), not a page; covered by flows/a5-sticker-designs.spec.ts',
  },
  { uri: /\/contrast$|\/impact$|\/suggest$|\/options$|^\/admin\/content\/home\/vehicles$/, reason: 'JSON answer of a page, not a page' },
  {
    uri: /^\/admin\/audit\/verify-page$/,
    reason: 'JSON answer of ADM-44 "Diese Seite prüfen" (AuditPageCheckController, GET ?ids=… of the shown events; 422 without ids), not a page',
  },
  { uri: /^\/admin\/palette\/targets\/\{kind\}$/, reason: 'JSON answer of the ⌘K palette (PaletteTargetsController: events, businesses, flags), not a page' },
  {
    uri: /^\/admin\/(businesses\/\{business\}|events\/\{event\})\/preview$/,
    reason: 'JSON record of the ADM-55/ADM-53 side pane (BusinessShowController/EventShowController::preview), not a page',
  },
  {
    uri: /^\/admin\/system\/mail-preview\/\{mail\}\/frame$/,
    reason: 'the mail document of ADM-61-open\'s sandboxed frame, signed per audited opening; loaded and checked inside ADM-61-open',
  },
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
  // Queues of features that are off on every environment: nothing can arrive while the flag is off.
  {
    path: /^\/admin\/businesses$/,
    empty: [{ marker: /ADM-55\.table\.empty$/, reason: 'the applications queue: businesses is off on every environment (ADR-455), so no member can apply' }],
  },
  {
    // A host updated from an earlier version has no imported parts (ProductSeeder runs on a fresh install only) and parts_catalogue is
    // off on every environment (ADR-455): the empty catalogue with its import action is the honest state until the operator imports.
    path: /^\/admin\/catalog\/products$/,
    empty: [{ marker: /^data-empty=first in ADM-57\.table\.empty$/, reason: 'parts_catalogue is off on every environment (ADR-455) and an updated host has imported no parts yet; the page offers the import' }],
  },
  {
    path: /^\/admin\/comments$/,
    empty: [{ marker: /ADM-60\.table\.empty$/, reason: 'build_comments is off (09 §3.2: comments behind an off flag), so no comment exists; the page says so' }],
  },
  // ADM-06's KPI counts real decisions only (samples never count, Kpi.php): a showcase host has no real moderation decision in its last
  // 7 days, and seeding a non-sample one would put an invented number on the dashboard (no fake counts). Only this one KPI tile.
  {
    path: /^\/admin$/,
    empty: [{ marker: /ADM-06\.kpi\.median_decision\.empty$/, reason: 'no real moderation decision in 7 days on a showcase host; the KPI never counts samples and a seeded decision would be an invented number' }],
  },
  // The registry's "-no-results" cells search for nonsense on purpose (ADM-65 a design id no design has, ADM-66 "zzzzzz"): "Keine
  // Treffer für diese Filter" with "Filter zurücksetzen" is the cell.
  {
    path: /^\/admin\/stickers\/designs\?filter\[q\]=SDZZZZZZZZ$/,
    empty: [{ marker: /^data-empty=quiet in ADM-65\.table\.no-results$/, reason: 'ADM-65-no-results searches for the design id SDZZZZZZZZ, which no design has: the no-results frame is the cell' }],
  },
  {
    path: /^\/admin\/shop\/products\?filter\[q\]=zzzzzz$/,
    empty: [{ marker: /^data-empty=quiet in ADM-66\.table\.no-results$/, reason: 'ADM-66-no-results searches for "zzzzzz", which no product is called: the no-results frame is the cell' }],
  },
  // ADM-68 Forum queues: ForumSampleSeeder publishes its 25 threads and 74 posts by verified sample members (no pre-moderation) and
  // seeds no report, so nothing waits on a showcase host; a queue with nothing waiting is the healthy state, not missing data.
  {
    path: /^\/admin\/forum(\?tab=(pending|reported))?$/,
    empty: [
      {
        marker: /^data-empty=first in ADM-68\.table\.empty$/,
        reason: 'nothing waits in the forum pre-moderation or report queue: the forum seed has only published posts by verified sample members and no report (moderation_cases has no forum case)',
      },
    ],
  },
  // The registry's "-none" variant of the Wrapped tab: a season the member has no Wrapped of (2025, before M5.9e) is its subject.
  {
    path: /^\/admin\/members\/[^/?]+\?tab=wrapped&season=2025-saison$/,
    empty: [{ marker: /^data-empty=first in ADM-10\.wrapped\.empty$/, reason: 'ADM-10-wrapped-none opens 2025-saison, a season before Wrapped existed: the empty frame with "Vorschau erzeugen" is the cell' }],
  },
];

/** Routes that answer 404 to everyone by design while their flag is off (m3.6 §1: premium.enabled). */
export const ADMIN_FLAGGED: { uri: RegExp; reason: string }[] = [
  { uri: /^\/admin\/memberships\//, reason: 'membership scaffold behind premium.enabled (off by default, 09 §3.2): 404 while off' },
];

/**
 * Owner-only admin pages: the local crawl signs in as the e2e Owner fixture (setup.ts) and a hosted demo as admin.demo, an Owner since
 * client round 6 (ADR-540, DemoShowcaseSeeder), so they must open (200). CRAWL_STAFF_ROLE names another role for a crawl with a
 * non-Owner account (they must then refuse with 403). Each run checks its one expected answer, never "either".
 */
export const ADMIN_OWNER_ONLY: { uri: RegExp; reason: string }[] = [
  { uri: /^\/admin\/system\/mail-preview$/, reason: 'ADM-61 Mail-Vorschau is Owner only (system.mail_preview, SEC-M46-04): a recorded mail can hold a sign-in code' },
];
/** Whether the crawl's staff session is an Owner: the local fixture (setup.ts) and admin.demo are; CRAWL_STAFF_ROLE says otherwise. */
const STAFF_IS_OWNER = (process.env.CRAWL_STAFF_ROLE ?? 'owner') === 'owner';

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
    const ownerOnly = ADMIN_OWNER_ONLY.some((o) => o.uri.test(route.uri));
    const extra: Partial<PageSpec> = flagged
      ? { expectStatus: [200, 404], statePage: true }
      : ownerOnly && !STAFF_IS_OWNER
        ? { expectStatus: [403], statePage: true }
        : {};
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

/**
 * Links that fill a static page's query tokens (ADM-55-pane `/admin/businesses?tab=all&business={sampleBusiness}`: a queue row links
 * its side pane as `?business=<id>` from 1280 px). A candidate has the template's path, every literal parameter and a value for every
 * token; it comes back as the template's path with the template's parameters, the tokens filled from the link.
 */
export function queryTokenCandidates(template: string, links: Iterable<string>): string[] {
  const [path = '', query = ''] = template.split('?');
  const wanted = [...new URLSearchParams(query).entries()];
  const out: string[] = [];
  for (const link of links) {
    const [linkPath = '', linkQuery = ''] = link.split('?');
    if (linkPath !== path) continue;
    const params = new URLSearchParams(linkQuery);
    const token = (value: string) => /^\{\w+\}$/.test(value);
    if (!wanted.every(([key, value]) => (token(value) ? (params.get(key) ?? '') !== '' : params.get(key) === value))) continue;
    const filled = new URLSearchParams(wanted.map(([key, value]) => [key, token(value) ? (params.get(key) ?? '') : value]));
    out.push(`${path}?${filled.toString()}`);
  }
  return [...new Set(out)];
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
  // Client QA 2026-11-23 (workstream C): layout and copy checks of every page.
  'horizontal-overflow',
  'under-tab-bar',
  'under-safe-area',
  'raw-key',
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
  /** actions: visible buttons and links of the state (its `.action` included); nested: inside another empty marker (a part of it). */
  empties: { marker: string; text: string; actions: number; nested: boolean }[];
  errors: { marker: string; text: string }[];
  texts: { kind: 'untranslated' | 'bad-text'; text: string; where: string }[];
  /** Dotted tokens of readable text that the generic key check passed: compared with the app's and the admin's own keys (`raw-key`). */
  keyCandidates: { text: string; where: string }[];
  codes: string[];
  links: string[];
  roots: string[];
};

export type CrawlState = {
  role: Role;
  device: string;
  /** A phone project: the tab bar and safe-area checks run. */
  phone: boolean;
  /** Insets emulated on every page of a Chromium phone project (crawl.config.ts metadata `safeArea`), or null. */
  safeArea: SafeArea | null;
  /** The page the context's third-party guard attributes a request to. */
  current: { id: string; path: string };
  findings: Finding[];
  allowed: Allowed[];
  pages: PageResult[];
  notVisited: { id: string; path: string; reason: string }[];
  imageStatus: Map<string, string | null>;
  codes: Set<string>;
  links: Set<string>;
  /** Where each link was found (the paths of the pages that show it): the admin crawl prefers records linked from the showcase member's. */
  linkFrom: Map<string, Set<string>>;
  aborted: number;
  thirdParty: Set<string>;
  qr: { code: string; via: string; result: string }[];
};

export function newState(role: Role, device: string, layout: { phone: boolean; safeArea: SafeArea | null } = { phone: false, safeArea: null }): CrawlState {
  return {
    role,
    device,
    phone: layout.phone,
    safeArea: layout.safeArea,
    current: { id: '-', path: '-' },
    findings: [],
    allowed: [],
    pages: [],
    notVisited: [],
    imageStatus: new Map(),
    codes: new Set(),
    links: new Set(),
    linkFrom: new Map(),
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
  // Only the member web reads the clock to choose its data (Home's week, "heute"); admin pages get theirs from the server. Playwright
  // installs its clock as a script in every frame, which a sandboxed frame without allow-scripts refuses with a console error ("Blocked
  // script execution in '…' because the document's frame is sandboxed"): ADM-61's mail preview frame runs no script at all (its CSP
  // and sandbox), so that error was the harness's own (probed on Chromium and WebKit with and without the clock).
  if (CRAWL_NOW && state.role !== 'admin') await context.clock.setFixedTime(new Date(CRAWL_NOW));
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
export function inspectDom(): DomReport {
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
  const empties: DomReport['empties'] = [];
  const emptyEls: Element[] = [];
  const ACTION = 'a[href], button, [role="button"], [role="link"]';
  const actionsOf = (el: Element, id: string | null) => {
    const own = new Set([...el.querySelectorAll(ACTION)].filter(visible));
    if (id) for (const a of document.querySelectorAll(`[data-testid="${CSS.escape(`${id}.action`)}"]`)) if (visible(a)) own.add(a);
    return own.size;
  };
  for (const el of document.querySelectorAll('[data-testid]')) {
    const id = el.getAttribute('data-testid') ?? '';
    if (SUBPART.test(id) || /\.errors?$/.test(id) || !(EMPTY_NAMED.test(id) || (STATE_NAMED.test(id) && isEmptyState(id)))) continue;
    // The admin's EmptyQueue inside it reports itself with its variant (below).
    if (!visible(el) || el.querySelector('[data-empty]') || el.matches('[data-empty]')) continue;
    empties.push({ marker: id, text: textOf(el), actions: actionsOf(el, id), nested: false });
    emptyEls.push(el);
  }
  for (const el of document.querySelectorAll('[data-empty]')) {
    if (!visible(el)) continue;
    const owner = el.closest('[data-testid]')?.getAttribute('data-testid');
    empties.push({ marker: `data-empty=${el.getAttribute('data-empty') ?? ''}${owner ? ` in ${owner}` : ''}`, text: textOf(el), actions: actionsOf(el, null), nested: false });
    emptyEls.push(el);
  }
  emptyEls.forEach((el, i) => {
    if (emptyEls.some((other) => other !== el && other.contains(el))) empties[i]!.nested = true;
  });
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
  const keyCandidates: DomReport['keyCandidates'] = [];
  const placeholders = new Set<string>();
  const check = (value: string, where: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    for (const m of text.matchAll(KEY)) {
      if (!m[1] || machineKeys.has(m[1])) continue;
      if (looksLikeKey(m[1])) texts.push({ kind: 'untranslated', text: m[1], where });
      else keyCandidates.push({ text: m[1], where });
    }
    for (const m of text.matchAll(/\[\[[^\]]{0,240}\]\]|\{\{[^}]{0,240}\}\}/g)) placeholders.add(m[0]);
    // A bracket left over (a placeholder longer than 240 characters, or an unbalanced one): the detail starts at the bracket, so the
    // report names the placeholder and not the start of its paragraph.
    const spans = [...text.matchAll(/\[\[[^\]]{0,240}\]\]|\{\{[^}]{0,240}\}\}/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);
    const stray = [...text.matchAll(/\{\{|\}\}|\[\[|\]\]/g)].map((m) => m.index ?? 0).find((at) => !spans.some(([from, to]) => at >= from && at < to));
    if (stray !== undefined) texts.push({ kind: 'untranslated', text: `${stray > 0 ? '…' : ''}${text.slice(stray, stray + 160)}`, where });
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
  return { images, imageUrls: [...imageUrls], empties, errors, texts, keyCandidates, codes: [...codes], links: [...links], roots };
}

// --- Layout: sideways scroll, the tab bar, the safe areas -----------------------------------------------------------------------

/** Insets the page is given (CSS env(safe-area-inset-*)); only Chromium can emulate them (CDP Emulation.setSafeAreaInsetsOverride). */
export type SafeArea = { top: number; bottom: number };
type LayoutOptions = { phone: boolean; safeArea: SafeArea | null };
type LayoutIssue = { type: 'horizontal-overflow' | 'under-tab-bar' | 'under-safe-area'; detail: string };

/**
 * Reads the layout of the rendered page, in the page (plain DOM code). Three findings:
 * - `horizontal-overflow`: the document is wider than the viewport (07 §3 "Horizontal overflow"), or a page-size scroller (at least 90 %
 *   of the viewport wide and 60 % high, the screen's own ScrollView) scrolls sideways. A rail (a horizontal-only scroller) and a table
 *   wrapper (not page-size) scroll sideways by design.
 * - `under-tab-bar` (phones): after every page-size scroller and the window are scrolled to their end, an interactive element whose
 *   visible box intersects the floating tab bar (`shell.tabbar`) by more than 1 px and is hit-tested as the tab bar there: nothing can
 *   scroll it out from under the bar (useTabBarPadding is missing or too short).
 * - `under-safe-area` (phones with emulated insets): at the top of the page an interactive element in the top inset (the status bar and
 *   the camera), and at the end of the scroll one in the bottom inset (the home indicator).
 * Visually hidden elements (1 px boxes, clip), aria-hidden and inert subtrees are not interactive for a person and are skipped.
 */
export async function inspectLayout(options: LayoutOptions): Promise<LayoutIssue[]> {
  const issues: LayoutIssue[] = [];
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));
  const describe = (el: Element) => {
    const id = el.closest('[data-testid]')?.getAttribute('data-testid');
    const tag = el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
    return `${tag}${id ? `[${id}]` : ''}${name ? ` "${name}"` : ''}`;
  };
  const shown = (el: Element) => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    const style = getComputedStyle(el);
    return !(style.clip !== 'auto' && style.position === 'absolute') && style.clipPath !== 'inset(50%)';
  };
  /** The part of an element's box that is not clipped by the viewport or an ancestor that clips. */
  const visibleBox = (el: Element) => {
    const r = el.getBoundingClientRect();
    let top = Math.max(r.top, 0);
    let bottom = Math.min(r.bottom, innerHeight);
    let left = Math.max(r.left, 0);
    let right = Math.min(r.right, innerWidth);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (st.overflowY !== 'visible') {
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      if (st.overflowX !== 'visible') {
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
    }
    return bottom - top > 0 && right - left > 0 ? { top, bottom, left, right } : null;
  };
  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const interactive = () => [...document.querySelectorAll(INTERACTIVE)].filter(shown);

  // Sideways scroll.
  const doc = document.scrollingElement ?? document.documentElement;
  // An element inside a container that clips or scrolls sideways (a rail) cannot widen the page: only the others are named.
  const clippedX = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  if (doc.scrollWidth > innerWidth + 1) {
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && shown(el) && !clippedX(el))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 3)
      .map((el) => `${describe(el)} to ${Math.round(el.getBoundingClientRect().right)} px`);
    issues.push({ type: 'horizontal-overflow', detail: `document ${doc.scrollWidth} px wide at a ${innerWidth} px viewport; widest: ${wide.join('; ') || '-'}` });
  }
  const scrollers = [...document.querySelectorAll('body *')].filter((el) => {
    const st = getComputedStyle(el);
    return /(auto|scroll)/.test(st.overflowY) && el.clientHeight > 100 && el.scrollHeight > el.clientHeight + 1;
  });
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (!/(auto|scroll)/.test(st.overflowX) || !/(auto|scroll)/.test(st.overflowY)) continue;
    if (el.clientWidth < innerWidth * 0.9 || el.clientHeight < innerHeight * 0.6 || el.scrollWidth <= el.clientWidth + 1 || !shown(el)) continue;
    const box = el.getBoundingClientRect();
    const wide = [...el.querySelectorAll('*')]
      .filter((c) => c.getBoundingClientRect().right > box.right + 1 && shown(c))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 2)
      .map((c) => describe(c));
    issues.push({ type: 'horizontal-overflow', detail: `the screen's scroller ${describe(el)} scrolls sideways: ${el.scrollWidth} px content in ${el.clientWidth} px; widest: ${wide.join('; ') || '-'}` });
  }
  if (!options.phone) return issues;

  // Full-bleed is measured against the layout viewport: a phone browser that zooms out to fit a too-wide page (itself an overflow
  // finding) widens innerWidth, not the screen's width.
  const layoutWidth = document.documentElement.clientWidth || innerWidth;
  const reported = new Set<Element>();
  const report = (type: LayoutIssue['type'], el: Element, detail: string) => {
    if (reported.has(el) || reported.size >= 12) return;
    reported.add(el);
    issues.push({ type, detail: `${describe(el)}: ${detail}` });
  };
  // Top inset, at the top of the page (the first screen a person sees).
  const inset = options.safeArea;
  if (inset && inset.top > 0) {
    for (const el of interactive()) {
      const v = visibleBox(el);
      if (!v || v.top >= inset.top - 1) continue;
      // A full-bleed photo or pager (VEH-01's hero, SHOP-02's gallery, the INTRO pager) runs under the status bar by design (09 §7 hero
      // pattern, `scrim.top`): it spans the screen's width and at least a 44 px tap height of it lies below the inset, so a person taps
      // it there. A control (a back button, a chip) under the inset has no such part and stays a finding.
      if (v.right - v.left >= layoutWidth * 0.9 && v.bottom - Math.max(v.top, inset.top) >= 44) continue;
      report('under-safe-area', el, `${Math.round(inset.top - v.top)} px inside the top safe area (${inset.top} px) at the top of the page`);
    }
  }

  // The end of every scroll. A list that loads more at its end grows: scroll again until no scroller grows (bounded), and judge only
  // what sits in scrollers that really are at their end.
  const heights = () => scrollers.map((el) => el.scrollHeight).join(',') + `,${document.documentElement.scrollHeight}`;
  const ends = () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
  };
  for (let round = 0, last = ''; round < 6; round++) {
    ends();
    await frame();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const now = heights();
    if (now === last) break;
    last = now;
  }
  ends();
  await frame();
  const atEnd = (el: Element) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  const isScroller = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1;
  const bar = document.querySelector('[data-testid="shell.tabbar"]');
  const barBox = bar && shown(bar) ? bar.getBoundingClientRect() : null;
  for (const el of interactive()) {
    if (bar?.contains(el)) continue;
    // A scroll container that is focusable for the keyboard (RN Web's ScrollView, a <section tabindex=0>) runs under the floating bar
    // by design (the bar overlays the screen); what matters is its content, which is checked element by element.
    if (isScroller(el)) continue;
    if (scrollers.some((s) => s.contains(el) && !atEnd(s))) continue;
    const v = visibleBox(el);
    if (!v) continue;
    if (barBox && barBox.top < innerHeight) {
      const top = Math.max(v.top, barBox.top);
      const bottom = Math.min(v.bottom, barBox.bottom);
      const left = Math.max(v.left, barBox.left);
      const right = Math.min(v.right, barBox.right);
      if (bottom - top > 1 && right - left > 1) {
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (hit && bar?.contains(hit)) report('under-tab-bar', el, `${Math.round(bottom - top)} px under the tab bar at the end of the scroll`);
      }
    }
    // A full-screen surface (the INTRO pager: the whole width and at least half the height) reaches under the home indicator by design;
    // its controls are checked one by one. A list row is no such surface: the end of a list must clear the inset.
    const fullBleed = v.right - v.left >= layoutWidth * 0.9 && v.bottom - v.top >= innerHeight * 0.5;
    if (inset && inset.bottom > 0 && v.bottom > innerHeight - inset.bottom + 1 && !fullBleed) {
      report('under-safe-area', el, `${Math.round(v.bottom - (innerHeight - inset.bottom))} px inside the bottom safe area (${inset.bottom} px) at the end of the scroll`);
    }
  }
  window.scrollTo(0, 0);
  for (const el of scrollers) el.scrollTop = 0;
  return issues;
}

/**
 * Every translation key of the member app (mobile/src/i18n/locales/<lang>/<namespace>.json: `path`, `namespace:path`, plural bases) and
 * of the admin (web/lang/admin/<lang>/<file>.json: `file.path`). A dotted token of readable text that is one of them is a key printed
 * instead of its text (`raw-key`); the generic `untranslated` check only sees keys with three parts, a colon or a capital.
 */
let knownKeys: Set<string> | null = null;
export function translationKeys(): Set<string> {
  if (knownKeys) return knownKeys;
  const keys = new Set<string>();
  const walk = (node: unknown, prefix: string, add: (path: string) => void) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, prefix ? `${prefix}.${k}` : k, add);
    } else if (prefix) {
      add(prefix);
      const base = prefix.replace(/_(zero|one|two|few|many|other)$/, '');
      if (base !== prefix) add(base);
    }
  };
  const read = (dir: URL, each: (file: string, json: unknown) => void) => {
    try {
      for (const lang of readdirSync(dir)) {
        const sub = new URL(`${lang}/`, dir);
        let files: string[] = [];
        try {
          files = readdirSync(sub).filter((f) => f.endsWith('.json'));
        } catch {
          continue;
        }
        for (const f of files) each(f.replace(/\.json$/, ''), JSON.parse(readFileSync(new URL(f, sub), 'utf8')));
      }
    } catch {
      // Not in this checkout: the check has fewer keys, never a false finding.
    }
  };
  read(new URL('../../../../mobile/src/i18n/locales/', import.meta.url), (ns, json) =>
    walk(json, '', (path) => {
      keys.add(path);
      keys.add(`${ns}:${path}`);
    }),
  );
  read(new URL('../../../lang/admin/', import.meta.url), (file, json) => walk(json, file, (path) => keys.add(path)));
  // Single words are never matched (the candidates have a dot), so only dotted keys matter.
  knownKeys = new Set([...keys].filter((k) => k.includes('.') || k.includes(':')));
  return knownKeys;
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
    for (const link of visitResult.dom.links) {
      state.links.add(link);
      const from = state.linkFrom.get(link) ?? new Set<string>();
      from.add(visitResult.result.path);
      state.linkFrom.set(link, from);
    }
  }
}

async function visitOnce({ context, state, spec, path, expectFinalPath }: VisitOptions): Promise<Visit> {
  const started = Date.now();
  const findings: Finding[] = [];
  const allowed: Allowed[] = [];
  const push = (type: FindingType, detail: string, url?: string) => findings.push({ type, page: spec.id, path, detail, ...(url ? { url: relative(url) } : {}) });
  state.current = { id: spec.id, path };
  const page = await context.newPage();
  if (state.safeArea) {
    // Before the first byte: the app reads env(safe-area-inset-*) in its first layout (ui/safeArea.ts).
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: state.safeArea.top, bottom: state.safeArea.bottom, left: 0, right: 0 } });
  }
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
  // Also every unhandled promise rejection: Chromium and WebKit both report one as a pageerror (WebKit's message starts "Unhandled
  // Promise Rejection:"); the @meta test of crawl/showcase.spec.ts proves it on every project.
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
          (selector) =>
            [...document.querySelectorAll(selector)].some((el) => (el as HTMLElement).checkVisibility() && el.getBoundingClientRect().height > 0),
          spec.rendered ?? '[data-testid$=".root"]',
          { timeout: 25_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!rendered) push('not-rendered', `no screen root (${spec.rendered ?? '[data-testid$=".root"]'}) became visible within 25 s`);
    }
    await network.waitForQuiet({ quietMs: 400, timeoutMs: 20_000 }).catch(() => undefined);
    await scrollThrough(page);
    await network.waitForQuiet({ quietMs: 400, timeoutMs: 15_000 }).catch(() => undefined);
    await loadAllImages(page, 10_000);
    const stable = await waitForStablePage(page, { network, timeoutMs: 15_000 }).catch(() => null);
    for (const src of stable?.imagesFailed ?? []) push('broken-image', 'image failed to decode', src);
    dom = await page.evaluate(inspectDom);
    const layout = await page.evaluate(inspectLayout, { phone: state.phone, safeArea: state.safeArea });

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
        else if (state.role === 'fresh') {
          // A new member has nothing of their own: an empty state is what they must see, as a proper one (project rule "every route ships
          // all states": a sample preview and one action), never an error. Its parts (a sample row inside it) count with it.
          if (empty.nested) allowed.push({ ...finding, reason: 'new member: part of the enclosing empty state' });
          else if (empty.actions > 0) allowed.push({ ...finding, reason: `new member: a proper empty state with ${empty.actions} action(s)` });
          else findings.push({ ...finding, detail: `${finding.detail} (empty state without an action)` });
        } else findings.push(finding);
      }
    }
    for (const issue of layout) push(issue.type, issue.detail);
    const keys = translationKeys();
    for (const candidate of dom.keyCandidates) {
      if (!keys.has(candidate.text)) continue;
      const finding: Finding = { type: 'raw-key', page: spec.id, path, detail: `${candidate.where}: "${candidate.text}"` };
      const rule = allowText.find((a) => a.pattern.test(candidate.text));
      if (rule) allowed.push({ ...finding, reason: rule.reason });
      else findings.push(finding);
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
