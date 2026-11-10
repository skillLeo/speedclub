// Shared pieces of the admin flow specs (A1–A4): the admin's and the server's German copy read from their files, a staff fixture's own
// session, the real clock on admin pages, the password dialog (ADR-215), Reka selects, toasts, the page data of an Inertia page and the
// XSRF header for a direct request. Specs still import `test` and `expect` from ./fixtures.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { id } from './flow';
import { BASE_URL } from './qa.mjs';
import { staffRun, staffSignIn } from './staff.mjs';

export const DESKTOP = { width: 1280, height: 800 };
const WEB = fileURLToPath(new URL('../../../', import.meta.url));

/** The admin's German copy (web/lang/admin/de/<file>.json, laravel-vue-i18n) with its `:name` values. */
export function admin(file: string, key: string, values: Record<string, string> = {}): string {
  const catalogue = JSON.parse(readFileSync(`${WEB}lang/admin/de/${file}.json`, 'utf8')) as Record<string, unknown>;
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
  if (typeof found !== 'string') throw new Error(`No admin copy ${file}:${key}`);
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`:${name}`, value), found);
}

/** The server's German copy (web/lang/de/moderation.php) of the mails, read through PHP so a copy edit never breaks a spec. */
let moderationLang: Record<string, unknown> | null = null;
export function serverCopy(key: string): string {
  moderationLang ??= JSON.parse(
    execFileSync(process.env.SPEEDCLUB_PHP ?? 'php', ['-r', 'echo json_encode(require "lang/de/moderation.php");'], { cwd: WEB, encoding: 'utf8' }),
  ) as Record<string, unknown>;
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], moderationLang);
  if (typeof found !== 'string') throw new Error(`No server copy moderation.${key}`);
  return found;
}
/** The server's German copy of any lang/de/<file>.php (content.brand.hero_contrast …), read through PHP like serverCopy. */
const serverFiles = new Map<string, Record<string, unknown>>();
export function serverLang(file: string, key: string, values: Record<string, string> = {}): string {
  let catalogue = serverFiles.get(file);
  if (!catalogue) {
    catalogue = JSON.parse(
      execFileSync(process.env.SPEEDCLUB_PHP ?? 'php', ['-r', `echo json_encode(require "lang/de/${file}.php");`], { cwd: WEB, encoding: 'utf8' }),
    ) as Record<string, unknown>;
    serverFiles.set(file, catalogue);
  }
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
  if (typeof found !== 'string') throw new Error(`No server copy ${file}.${key}`);
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`:${name}`, value), found);
}

/**
 * A lock across the Playwright workers (and both browser projects) for a flow that changes something every client sees at once, such as
 * the live branding (A3): the other project's run of the same flow waits instead of publishing over it. Like support/start-lock.mjs: a
 * directory per lock and server port, owned by a process; a holder that is gone (a crashed worker) is taken over.
 */
export async function withFlowLock<T>(name: string, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `speedclub-e2e-${name}-lock-${new URL(BASE_URL).port || 'default'}`);
  const owner = join(dir, 'owner');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(owner, String(process.pid));
      break;
    } catch {
      let pid = NaN;
      try {
        pid = Number(readFileSync(owner, 'utf8'));
      } catch {
        // Between mkdir and the owner file.
      }
      let alive = true;
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
      }
      if (!alive) rmSync(dir, { recursive: true, force: true });
      if (Date.now() > deadline) throw new Error(`The ${name} lock (${dir}) was not free within ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  try {
    return await work();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The fixed part of a mail line before its first `:placeholder`. */
export const lead = (line: string): string => line.split(/:[a-z_]+/)[0]?.trim() ?? line;

/** A staff fixture of this browser project, signed in once per worker in a session of its own. */
const signedIn = new Map<string, Promise<Parameters<BrowserContext['addCookies']>[0]>>();
export async function staffContext(context: BrowserContext, label: string): Promise<{ name: string }> {
  const run = await staffRun();
  const account = run.accounts[label];
  if (!account) throw new Error(`No staff fixture ${label}`);
  let cookies = signedIn.get(label);
  if (!cookies) {
    cookies = staffSignIn(run, label);
    signedIn.set(label, cookies);
  }
  await context.addCookies(await cookies);
  return { name: account.name };
}

/**
 * The real clock on this page, and the qa overrides with it. A running clock, not a fixed one: Vue drops a handler when the event's
 * first-seen time (`Date.now()`) is not later than the handler's attach time, so under a frozen Date the second Vue listener on an
 * event's path never runs, and a Reka select inside a dialog no longer opens. The end of a measure is "now + n days" on the device, and
 * the server refuses an end in its past.
 */
export async function realClock(page: Page): Promise<string> {
  await page.clock.setSystemTime(new Date());
  return new Date().toISOString();
}

/** ADR-215: a ⚿ action asks for the password first when the last confirmation is older than 5 minutes (always, in a new session). */
export async function confirmPassword(page: Page): Promise<void> {
  const run = await staffRun();
  await expect(id(page, 'shell.password'), 'the action must ask for the password first (staff.recent-password, ADR-215)').toBeVisible();
  await id(page, 'shell.password.input').fill(run.password);
  await id(page, 'shell.password.submit').click();
  await expect(id(page, 'shell.password')).toBeHidden();
}

/** A Reka select inside `scope` by its field label, then one of its options. */
export async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const trigger = scope.getByRole('combobox', { name: new RegExp(`^${label}`) });
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

export const toast = (page: Page, text: string): Locator => page.locator('[data-testid="toast.success"]:visible').filter({ hasText: text });

/** The props an admin page renders with (Inertia's data-page script), read over HTTP in this staff session. */
export async function pageProps<T>(context: BrowserContext, path: string): Promise<T> {
  const response = await context.request.get(path, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
  expect(response.status(), `GET ${path}`).toBe(200);
  const json = /<script data-page="[^"]*" type="application\/json">([\s\S]*?)<\/script>/.exec(await response.text())?.[1];
  if (!json) throw new Error(`${path} rendered no page data`);
  return (JSON.parse(json) as { props: T }).props;
}

/** The admin's XSRF token of a staff session, for a direct request the page would never send. */
export const xsrfOf = async (context: BrowserContext): Promise<string> =>
  decodeURIComponent((await context.cookies()).find((c) => c.name === 'XSRF-TOKEN' && c.path === '/admin')?.value ?? '');

/**
 * Confirms the staff session's password directly (the endpoint behind the password dialog), so a direct request that follows is
 * judged by its own rules and not answered with the password prompt.
 */
export async function confirmPasswordDirectly(context: BrowserContext): Promise<void> {
  const run = await staffRun();
  const answer = await context.request.post('/admin/user/confirm-password', {
    headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(context) },
    data: { password: run.password },
    maxRedirects: 0,
  });
  expect([200, 201, 204], `POST /admin/user/confirm-password answered ${answer.status()}`).toContain(answer.status());
}
