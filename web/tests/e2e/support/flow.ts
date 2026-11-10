// Shared pieces of the Phase 2 flow specs (F5 messaging, F6, F7, F8, the M2.7 signature flow): the app's own copy read from its
// locale files, locators, a second signed-in browser, pictures of overlays for design QA, API helpers for test members and a
// TOTP generator for SET-05 / AUTH-11. Specs still import `test` and `expect` from ./fixtures.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test';
import { useSession } from './auth.mjs';
import { watchPageErrors, type ExpectedFailure } from './fixtures';
import { createGarageMember, expectStatus } from './garage.mjs';
import { routeCsrfCookie } from './csrf-limit.mjs';
import { BASE_URL, makeContextDeterministic, QA_LOCALES, QA_TIMEZONE, qaUrl, type QaOptions } from './qa.mjs';

export type Member = Awaited<ReturnType<typeof createGarageMember>>;

const LOCALES = new URL('../../../../mobile/src/i18n/locales/', import.meta.url);
const catalogues = new Map<string, Record<string, unknown>>();

/**
 * The app's copy from mobile/src/i18n/locales/<locale>/<namespace>.json, with i18next's {{name}} values and _one/_other plurals,
 * so a spec follows the keys and not sentences of its own (the copy review edits the sentences).
 */
export function copy(locale: 'de' | 'en', namespace: string, key: string, values: Record<string, string | number> = {}): string {
  const file = `${locale}/${namespace}`;
  let catalogue = catalogues.get(file);
  if (!catalogue) {
    catalogue = JSON.parse(readFileSync(new URL(`${file}.json`, LOCALES), 'utf8')) as Record<string, unknown>;
    catalogues.set(file, catalogue);
  }
  const lookup = (path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
  const count = values.count;
  const found = (count === undefined ? undefined : lookup(`${key}_${count === 1 ? 'one' : 'other'}`)) ?? lookup(key);
  if (typeof found !== 'string') throw new Error(`No ${locale} copy for ${namespace}:${key}`);
  return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}
export const de = (namespace: string, key: string, values?: Record<string, string | number>): string => copy('de', namespace, key, values);
export const en = (namespace: string, key: string, values?: Record<string, string | number>): string => copy('en', namespace, key, values);

/** The rendered element with this testID; screens under the top of a stack stay in the DOM, hidden. */
export const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
/** The pressable of a ListRow, MoreSheet or ActionSheet row (ui/ListRow.tsx: the root holds the testID, `.body` the role). */
export const row = (page: Page, testId: string): Locator => id(page, `${testId}.body`);
export const anyWithId = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]`);
export const pathOf = (page: Page): string => new URL(page.url()).pathname;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An API path as the browser logs it, for expectFailedResponses. `[id]` matches one path segment. */
export const apiPath = (path: string): RegExp => new RegExp(`/api/v1/${escape(path).replace(/\\\[id\\\]/g, '[^/?]+')}(\\?.*)?$`);
/** A web path (Blade or SPA document), for expectFailedResponses. */
export const webPath = (path: string): RegExp => new RegExp(`${escape(path)}(\\?.*)?$`);

/** A response of this method on exactly this API path (`[id]` matches one segment). */
export const isCall = (method: string, path: string) => {
  const pattern = new RegExp(`^/api/v1/${escape(path).replace(/\\\[id\\\]/g, '[^/]+')}$`);
  return (r: Response): boolean => r.request().method() === method && pattern.test(new URL(r.url()).pathname);
};

/** Goes to a path with the qa overrides (carbon, de unless given) and the fixed clock. */
export const open = (page: Page, path: string, options: QaOptions = {}): Promise<Response | null> =>
  page.goto(qaUrl(path, { theme: 'carbon', locale: 'de', ...options }));

export type Sinks = { pageErrors: string[]; blockedRequests: string[]; expected: ExpectedFailure[] };

/**
 * A second browser signed in as another member (or a guest's for `null`), set up like the fixture's own: fixed clock, no third
 * parties, and its page errors and blocked requests count for this test.
 */
export async function browserOf(
  browser: Browser,
  member: Member | null,
  sinks: Sinks,
  viewport = { width: 390, height: 844 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
    locale: QA_LOCALES.de,
    timezoneId: QA_TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await makeContextDeterministic(context, { onBlocked: (url: string) => sinks.blockedRequests.push(url) });
  await routeCsrfCookie(context);
  if (member) await useSession(context, member.session);
  const page = await context.newPage();
  watchPageErrors(page, sinks.pageErrors, sinks.expected);
  return { context, page };
}

const FLOW_SHOTS = (phase: number): URL => new URL(`../../../../docs/reports/visual/phase-${phase}/flows/`, import.meta.url);

/**
 * A picture of an overlay or a state the matrix cannot hold open (a sheet opened by a tap, a screen after a POST), for design QA:
 * attached to the report, and on Chromium saved once under docs/reports/visual/phase-<phase>/flows/<name>__<w>x<h>__carbon__de.png
 * (phase 2 unless given).
 */
export async function flowShot(page: Page, testInfo: TestInfo, name: string, { phase = 2 }: { phase?: number } = {}): Promise<void> {
  // No hover state on the picture.
  await page.mouse.move(0, 0);
  const body = await page.screenshot({ animations: 'disabled' });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (testInfo.project.name !== 'chromium') return;
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const dir = FLOW_SHOTS(phase);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: new URL(`${name}__${width}x${height}__carbon__de.png`, dir).pathname, animations: 'disabled' });
}

/** Test members in one call, one per label (part of the address, for reading the database). */
export async function members<const L extends readonly string[]>(...labels: L): Promise<{ -readonly [K in keyof L]: Member }> {
  const made: Member[] = [];
  for (const label of labels) made.push(await createGarageMember(label));
  return made as { -readonly [K in keyof L]: Member };
}

/** A real name, so a picture for design QA reads like the app does with real members. */
export async function named(member: Member, displayName: string, city = 'Köln'): Promise<void> {
  expectStatus(await member.api.patch('me/profile', { display_name: displayName, city }), 200, `PATCH me/profile of ${member.username}`);
}

export async function follow(by: Member, username: string): Promise<void> {
  expectStatus(await by.api.post(`users/${username}/follow`), 200, `${by.username} follows ${username}`);
}

/** A client id as the app makes them (UUIDs, `[A-Za-z0-9-]{8,64}`). */
export const clientId = (): string => randomUUID();

/** `from` starts a conversation with `to` through the API, the way MSG-03 does; answers {conversation, message}. */
export async function startConversation(
  from: Member,
  to: string,
  body: string,
  { vehicleId }: { vehicleId?: string } = {},
): Promise<{ conversation: { id: string; folder: string; request_pending: boolean }; message: { id: string } }> {
  const answer = await from.api.post('conversations', {
    recipient: to,
    ...(vehicleId ? { vehicle_id: vehicleId } : {}),
    message: { type: 'text', body },
    client_id: clientId(),
  });
  if (answer.status !== 201 && answer.status !== 200) throw new Error(`POST conversations ${from.username} → ${to}: HTTP ${answer.status} ${JSON.stringify(answer.body).slice(0, 400)}`);
  return answer.body.data;
}

/** `from` writes into an existing conversation through the API. */
export async function sendText(from: Member, conversationId: string, body: string): Promise<{ id: string }> {
  return expectStatus(
    await from.api.post(`conversations/${conversationId}/messages`, { type: 'text', body, client_id: clientId() }),
    201,
    `POST conversations/${conversationId}/messages by ${from.username}`,
  ).data;
}

/** The conversations of a member's folder, as the server lists them. */
export async function inbox(member: Member, folder: 'chats' | 'requests' | 'archived' = 'chats'): Promise<
  { id: string; folder: string; other: { username: string } | null; muted_until: string | null; pinned_at: string | null; archived_at: string | null; request_pending: boolean; unread_count: number }[]
> {
  return expectStatus(await member.api.get(`conversations?folder=${folder}&per_page=50`), 200, `GET conversations?folder=${folder} of ${member.username}`).data;
}

/** The thread as `member` sees it, newest first. */
export async function thread(member: Member, conversationId: string): Promise<{ id: string; client_id: string | null; type: string; body: string | null; is_mine: boolean }[]> {
  return expectStatus(await member.api.get(`conversations/${conversationId}/messages?limit=50`), 200, `GET thread of ${member.username}`).data;
}

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=-]/g, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`"${char}" is not base32`);
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * The RFC 6238 code (SHA-1, 6 digits, 30 s) of a base32 secret for the time step `offset` steps from now, on the real clock: the
 * server checks it on its own clock, not the browser's fixed one. The server accepts ±1 step and each step once (a later step
 * only), so a second code in the same test takes `offset: 1`.
 */
export function totp(secret: string, offset = 0, at = Date.now()): string {
  const step = Math.floor(at / 1000 / 30) + offset;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const start = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(start) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** A hex token colour as the browser computes it ("rgb(11, 11, 12)"), for comparing computed styles. */
export function rgbOf(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
