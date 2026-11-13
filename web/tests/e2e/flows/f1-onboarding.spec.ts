// F1 Onboarding (02_PRODUCT_SPEC §4) on the member web at /app, against the real API: Welcome → Konto erstellen →
// code from the local mailbox → username → profile setup → garage, and the edges of §3.1 and F1: an address that has an
// account, wrong and expired codes, the resend timer, an app closed in the middle, the way back after the auth sheet,
// the password rules, forgot + reset with the code and with the link, a session that ended elsewhere, and sign-out.
//
// Every account is new and ends in E2E_DOMAIN; the global teardown deletes them all (support/backend.mjs). Demo members
// are only signed in, never changed. Responses a test provokes on purpose (a wrong code is a 422) are named per test
// through expectFailedResponses; any other failed response still fails the test.
// Native counterpart: mobile/e2e/maestro/f1-onboarding.yaml. The notification primer (AUTH-10) is native and P2.
import type { Locator, Page, Response } from '@playwright/test';
import { apiLogin, applyAuth, endSessionOnServer, useSession } from '../support/auth.mjs';
import { ageCodes, createMember, E2E_DOMAIN, latestMail, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { buildVehicle, createGarageMember, GARAGE_PASSWORD } from '../support/garage.mjs';
import { BASE_URL, QA_NOW, qaUrl } from '../support/qa.mjs';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let sequence = 0;
/** A new address for every account: tests never share one, and runs never collide. */
const address = (label: string): string => `f1.${label}.${RUN}.${++sequence}@${E2E_DOMAIN}`;
const freshUsername = (): string => `f1${RUN}${++sequence}`.slice(0, 24);
/** Ten characters and more, not in the common list, not the address. */
const PASSWORD = `Ladeluft-${RUN}-Kurve`;

/**
 * A finished account of the test's own for the sign-in form. A browser signing in as a seeded member is a new device, and its
 * "new device" row stays unread in that member's notifications, so the Start dot of every screen the visual matrix takes of
 * them would depend on whether e2e ran first (nina.neu, member-empty). Seeded members are signed in with apiLogin only.
 */
async function freshMember(label: string): Promise<{ email: string; username: string }> {
  const member = { email: address(label), username: freshUsername() };
  await createMember(member.email, member.username, PASSWORD);
  await resetAuthLimits([member.email]);
  return member;
}

// The copy of mobile/src/i18n/locales/de/auth.json, as it renders. A word joiner (U+2060) after the hyphen keeps "E-Mail"
// and "6-stellig" on one line (DQ-147); "E-Mail-Adresse" carries it too (joinShortCompounds, M4.1 fix round 7) and may still
// break at its second hyphen. So may AUTH-05's title, which at 200 % is wider than a phone (DQ-252), and the verify notice's sentence.
const WJ = String.fromCharCode(0x2060);
/** verify.titleNoMail: AUTH-05 when no mail was just sent. */
const VERIFY_TITLE_NO_MAIL = `Bestätige deine E-${WJ}Mail-Adresse`;
/** verifyNotice.body: the row's text in the desktop layout. */
const VERIFY_NOTICE = `Bestätige deine E-${WJ}Mail-Adresse, um Autos zu veröffentlichen, anderen zu folgen und zu schreiben.`;
/**
 * verifyNotice.short: the row's text below the desktop layout, as at this suite's 390 (DQ-250). On the web the row's accessible
 * name is its visible text (RowBody: voice control must find what it sees, WCAG 2.5.3), so here it is this plus the action.
 */
const VERIFY_NOTICE_SHORT = `E-${WJ}Mail bestätigen`;
const VERIFY_NOTICE_ACTION = 'Code eingeben';
const INVALID_CODE = 'Das hat nicht gepasst. Prüfe den Code oder fordere einen neuen an.';
const INVALID_WITH_PASSWORD = 'Code oder Passwort stimmen nicht. Prüfe beides oder fordere einen neuen Code an.';
const INVALID_CREDENTIALS = `E-${WJ}Mail-Adresse oder Passwort stimmen nicht.`;
const RESEND = 'Neuen Code anfordern';
/** verify.resendWait with formatClock: "1:00" to "0:01". */
const RESEND_WAIT = /^Einen neuen Code kannst du in [01]:\d\d anfordern\.$/;

/** The API path as the browser logs it, for expectFailedResponses. */
const api = (path: string): RegExp => new RegExp(`/api/v1/${path.replace(/[/.]/g, '\\$&')}(\\?.*)?$`);

/** The rendered element with this testID; screens under the top of a stack stay in the DOM, hidden. */
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const isPost = (path: string) => (r: Response) => r.url().startsWith(`${BASE_URL}/api/v1/${path}`) && r.request().method() === 'POST';
/** Whether any field on the page, on a screen in front or behind, still holds this text. */
const fieldHolds = (page: Page, text: string): Promise<boolean> =>
  page.evaluate((wanted) => [...document.querySelectorAll('input, textarea')].some((field) => (field as HTMLInputElement).value.includes(wanted)), text);

const wrongCode = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** The reset mail's link (M2.7): WEB-07 /email/reset with `#code=…&email=…` in the fragment. */
const RESET_LINK = /https?:\/\/\S+\/email\/reset#\S*code=\d{6}\S*/;

/**
 * Opens the mail's WEB-07 link like a desktop browser: the page moves the fragment onto "Im Browser fortfahren" and clears its own
 * address bar, and that button opens AUTH-07 with the same fragment, which AUTH-07 reads and clears in turn.
 */
async function openResetLink(page: Page, link: string, code: string, email: string): Promise<void> {
  await page.goto(link);
  await expect(page.locator('[data-testid="WEB-07.root"][data-action="reset"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash, { message: 'WEB-07 clears the fragment from the address bar' }).toBe('');
  const browser = page.getByTestId('WEB-07.browser');
  const href = new URL((await browser.getAttribute('href')) ?? '', BASE_URL);
  expect(href.pathname).toBe('/app/reset-password');
  const fragment = new URLSearchParams(href.hash.slice(1));
  expect(fragment.get('code')).toBe(code);
  expect(fragment.get('email')).toBe(email);
  // SEC-P2-03: outside staging and production (local, lan: this harness) the app button is the bare scheme, without the code.
  await expect(page.getByTestId('WEB-07.app')).toHaveAttribute('href', 'speedclub://reset-password');
  await browser.click();
}

async function codeFor(email: string, previous: string | null = null): Promise<string> {
  const mail = await waitForMail(email, (m) => m.code !== null && m.code !== previous);
  return mail.code as string;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(qaUrl(path));
}

/** Closes the tab and opens the app again in the same browser: cookies and storage stay, the JavaScript state does not. */
async function relaunch(page: Page, path: string): Promise<Page> {
  const context = page.context();
  await page.close();
  const next = await context.newPage();
  await open(next, path);
  return next;
}

/**
 * This browser signed in to the account on an earlier visit: the session cookie, and the member the web app cached then
 * (src/api/queries/auth.ts). The cache is seeded only while the app has none of its own, so a relaunch later in the test
 * starts from what the app itself stored, as a reopened app does.
 */
async function signedInBefore(page: Page, email: string): Promise<void> {
  await resetAuthLimits([email]);
  const session = await apiLogin(email, PASSWORD);
  await page.context().addCookies(session.cookies);
  await page.context().addInitScript((value) => {
    try {
      if (localStorage.getItem('sc.sessionMember') === null) localStorage.setItem('sc.sessionMember', value);
    } catch {
      // Storage blocked: the app starts as a guest, and the first assertion says so.
    }
  }, session.cachedMember);
}

/** The account as the server sees it, with the cookies of this browser. */
async function meOf(page: Page): Promise<{ status: number; data?: Record<string, unknown> }> {
  const response = await page.request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Accept: 'application/json', Referer: `${BASE_URL}/app/` },
  });
  return { status: response.status(), data: response.ok() ? (await response.json()).data : undefined };
}

async function fillSignUp(page: Page, email: string, password: string): Promise<void> {
  await id(page, 'AUTH-04.email').fill(email);
  await id(page, 'AUTH-04.password').fill(password);
  for (const consent of ['ageConfirmed', 'termsAccepted', 'privacyAccepted']) await id(page, `AUTH-04.${consent}`).click();
}

/** AUTH-04 to AUTH-05. Returns the answer of auth/register. */
async function register(page: Page, email: string, password = PASSWORD): Promise<Response> {
  await resetAuthLimits();
  await fillSignUp(page, email, password);
  const answer = page.waitForResponse(isPost('auth/register'));
  await id(page, 'AUTH-04.cta.primary').click();
  const response = await answer;
  expect(response.status(), 'auth/register').toBe(202);
  await expect(id(page, 'AUTH-05.root')).toBeVisible();
  return response;
}

/**
 * M4.6: Welcome no longer carries a password button (09 §7.2 AUTH-02). The password ways stay one step further: "Mit E-Mail
 * fortfahren" → AUTH-12 "Mit Passwort anmelden" → AUTH-03, and its "Registrieren" → AUTH-04.
 */
async function welcomeToPasswordSignIn(page: Page): Promise<void> {
  await id(page, 'AUTH-02.provider.email').click();
  await expect(id(page, 'AUTH-12.root')).toBeVisible();
  await id(page, 'AUTH-12.withPassword').click();
  await expect(id(page, 'AUTH-03.root')).toBeVisible();
}

async function welcomeToSignUp(page: Page): Promise<void> {
  await welcomeToPasswordSignIn(page);
  await id(page, 'AUTH-03.toSignUp').click();
}

/** AUTH-03 with the given credentials. Returns the answer of auth/login. */
async function signIn(page: Page, email: string, password: string): Promise<Response> {
  await id(page, 'AUTH-03.email').fill(email);
  await id(page, 'AUTH-03.password').fill(password);
  const answer = page.waitForResponse(isPost('auth/login'));
  await id(page, 'AUTH-03.cta.primary').click();
  return answer;
}

async function chooseUsername(page: Page, username: string): Promise<void> {
  await id(page, 'AUTH-08.username').fill(username);
  await expect(id(page, 'AUTH-08.available')).toBeVisible();
  await id(page, 'AUTH-08.cta.primary').click();
  await expect(id(page, 'AUTH-09.root')).toBeVisible();
}

test.describe('F1 onboarding', () => {
  test('from Welcome to the garage, past a wrong code and a reserved name, then sign-out', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('auth/email/verify') }]);
    const email = address('happy');
    await open(page, '/app/welcome');
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    await welcomeToSignUp(page);
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/sign-up');

    const registered = await register(page, email);
    expect((await registered.json()).data).toEqual({ next: 'verify_email', email, resend_after_seconds: 60 });
    expect(pathOf(page)).toBe('/app/verify-email');
    await expect(id(page, 'AUTH-05.subtitle')).toContainText(email);
    // The password typed on AUTH-04 is still held for this address, so the code alone is enough.
    await expect(id(page, 'AUTH-05.password')).toHaveCount(0);

    const code = await codeFor(email);
    await id(page, 'AUTH-05.code').fill(wrongCode(code));
    await expect(id(page, 'AUTH-05.code.error')).toHaveText(INVALID_CODE);
    await expect(id(page, 'AUTH-05.code')).toHaveValue('');
    await id(page, 'AUTH-05.code').fill(code);
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/username');
    // A step of onboarding has no way back, only sign-out.
    await expect(id(page, 'AUTH-08.header.back')).toHaveCount(0);

    const name = id(page, 'AUTH-08.username');
    await name.fill('admin');
    await expect(id(page, 'AUTH-08.username.error')).toHaveText('Dieser Name ist reserviert. Wähle einen anderen.');
    await name.fill('Lukas.SC');
    await expect(id(page, 'AUTH-08.username.error')).toHaveText('Dieser Name ist schon vergeben. Wähle einen anderen.');
    await name.fill('a..b');
    await expect(id(page, 'AUTH-08.rules.shape')).toHaveAttribute('aria-label', /noch nicht erfüllt$/);
    const username = freshUsername();
    await chooseUsername(page, username);
    expect(pathOf(page)).toBe('/app/profile-setup');

    await id(page, 'AUTH-09.displayName').fill('Jonas Becker');
    await id(page, 'AUTH-09.city').fill('Hamburg');
    await id(page, 'AUTH-09.cta.primary').click();
    // "Erstes Auto hinzufügen": the garage, with the wizard on top of it.
    await expect(id(page, 'GAR-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/add-vehicle/new/vehicle');
    await id(page, 'GAR-03.header.back').click();
    // The garage lies under the wizard and may count as visible before the wizard has left: wait for both.
    await expect(id(page, 'GAR-03.root')).toHaveCount(0);
    await expect(id(page, 'GAR-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/garage');

    const me = await meOf(page);
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ email, username, display_name: 'Jonas Becker', city: 'Hamburg', email_verified: true, next_step: null });

    // Sign-out from the settings list: back to Welcome, and a reload stays signed out without asking the server.
    await id(page, 'tab.profile').click();
    await expect(id(page, 'PROF-01.name')).toHaveText('Jonas Becker');
    await id(page, 'PROF-01.settings').click();
    await id(page, 'SET-01.signOut').click();
    await expect(id(page, 'SET-01.signOutDialog')).toBeVisible();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/welcome');
    expect((await meOf(page)).status).toBe(401);
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/me')) asked.push(r.url());
    });
    await open(page, '/app/profile');
    await expect(id(page, 'PROF-01.guest')).toBeVisible();
    expect(asked).toEqual([]);
  });

  test('an address that has an account gets the same answer, and its owner a notice', async ({ page, browserName }) => {
    // One owner per engine: the notice budget is per address and both engines run at once.
    const owner = browserName === 'webkit' ? 'kenji.r34@speedclub.test' : 'sara.gti@speedclub.test';
    await resetAuthLimits([owner]);
    const before = await latestMail(owner);
    await open(page, '/app/sign-up');
    const registered = await register(page, owner);
    expect((await registered.json()).data).toEqual({ next: 'verify_email', email: owner, resend_after_seconds: 60 });
    await expect(id(page, 'AUTH-05.title')).toHaveText('Schau in dein Postfach');
    // The address breaks only after "@" and dots (U+200B, DQ-130), which Playwright drops from the text it compares.
    await expect(id(page, 'AUTH-05.subtitle')).toHaveText(
      `Wir haben dir eine E-${WJ}Mail an ${owner} geschickt. Gib den 6-${WJ}stelligen Code daraus hier ein. Steht kein Code darin, folge den Hinweisen in der E-${WJ}Mail.`,
    );

    const notice = await waitForMail(owner, (m) => !before || m.at > before.at || (m.at === before.at && m.html !== before.html));
    expect(notice.code, 'a known address gets no code').toBeNull();
    expect(notice.text).toContain('/app/sign-in#email=');
    expect(notice.text).toContain('/app/forgot-password#email=');

    // The ways out of §4 F1: Anmelden, and from there Passwort vergessen, both with the address filled in.
    await id(page, 'AUTH-05.toSignIn').click();
    await expect(id(page, 'AUTH-03.email')).toHaveValue(owner);
    await id(page, 'AUTH-03.forgot').click();
    await expect(id(page, 'AUTH-06.email')).toHaveValue(owner);
  });

  test('the notice links open sign-in and forgot-password with the address filled in, and leave it out of the address bar', async ({ page }) => {
    // AccountExistsMail links /app/sign-in#email=… and /app/forgot-password#email=… (ADR-138, m2.5-review.md item 12).
    const owner = 'lukas.sc@speedclub.test';
    for (const [path, field] of [
      ['/app/sign-in', 'AUTH-03.email'],
      ['/app/forgot-password', 'AUTH-06.email'],
    ] as const) {
      await page.goto(qaUrl(`${path}#email=${encodeURIComponent(owner)}`, { theme: 'carbon', locale: 'de' }));
      await expect(id(page, field)).toHaveValue(owner);
      await expect.poll(() => new URL(page.url()).hash, { message: `${path} clears the fragment` }).toBe('');
      expect(page.url()).not.toContain('email');
      expect(page.url()).not.toContain('lukas.sc');
    }
  });

  test('an expired code is refused, and the resend timer hands out a new one', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('auth/email/verify') }]);
    // Fake timers from here on, on top of the frozen date: the 60 seconds of the timer pass on request.
    await page.clock.install({ time: new Date(QA_NOW) });
    const email = address('expired');
    await open(page, '/app/sign-up');
    await register(page, email);

    // DQ-121: the wait stands as a sentence of its own under the button, whose label stays the same.
    const resend = id(page, 'AUTH-05.resend');
    const wait = id(page, 'AUTH-05.resendWait');
    await expect(resend).toHaveText(RESEND);
    await expect(resend).toHaveAttribute('aria-disabled', 'true');
    await expect(wait).toHaveText(RESEND_WAIT);

    const first = await codeFor(email);
    await ageCodes(email, 'email_verification');
    await id(page, 'AUTH-05.code').fill(first);
    await expect(id(page, 'AUTH-05.code.error')).toHaveText(INVALID_CODE);

    await page.clock.runFor(61_000);
    await expect(wait).toHaveCount(0);
    await expect(resend).toHaveText(RESEND);
    await expect(resend).not.toHaveAttribute('aria-disabled', 'true');
    const resent = page.waitForResponse(isPost('auth/email/resend'));
    await resend.click();
    expect((await resent).status()).toBe(202);
    await expect(id(page, 'AUTH-05.resentToast')).toBeVisible();
    await expect(id(page, 'AUTH-05.resentToast')).toContainText(`Wenn ein neuer Code möglich ist, kommt er gleich per E-${WJ}Mail.`);
    await expect(wait).toHaveText(RESEND_WAIT);
    await expect(resend).toHaveAttribute('aria-disabled', 'true');

    const second = await codeFor(email, first);
    await id(page, 'AUTH-05.code').fill(second);
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
  });

  // "A closed app resumes at the next open step, and so does signing in again", one test per step (RISK-3: as one test it
  // ran close to its 60 s ceiling on a loaded WebKit). Each step starts from an account the server holds at that step.
  test('a closed app resumes: after the code, at the username step', async ({ page }) => {
    const email = address('resume');
    await open(page, '/app/sign-up');
    await register(page, email);
    await id(page, 'AUTH-05.code').fill(await codeFor(email));
    await expect(id(page, 'AUTH-08.root')).toBeVisible();

    const app = await relaunch(page, '/app/');
    await expect(id(app, 'AUTH-08.root')).toBeVisible();
    expect(pathOf(app)).toBe('/app/username');
  });

  test('a closed app resumes: signing out of the username step and in again returns to it', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: api('auth/login') }]);
    const email = address('resume-signin');
    await createMember(email, '', PASSWORD, 'username');
    await signedInBefore(page, email);
    await open(page, '/app/');
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/username');

    // Sign-out from the step, then a wrong password and an unknown address read the same.
    await id(page, 'AUTH-08.signOut').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/sign-in');
    await resetAuthLimits([email]);
    expect((await signIn(page, email, 'Falsches-Passwort-42')).status()).toBe(401);
    await expect(id(page, 'AUTH-03.notice')).toHaveText(INVALID_CREDENTIALS);
    expect((await signIn(page, address('nobody'), PASSWORD)).status()).toBe(401);
    await expect(id(page, 'AUTH-03.notice')).toHaveText(INVALID_CREDENTIALS);
    expect((await signIn(page, email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/username');
  });

  test('a closed app resumes: after the username, at the profile setup', async ({ page }) => {
    const email = address('resume-name');
    await createMember(email, '', PASSWORD, 'username');
    await signedInBefore(page, email);
    await open(page, '/app/');
    await expect(id(page, 'AUTH-08.root')).toBeVisible();

    await chooseUsername(page, freshUsername());
    const app = await relaunch(page, '/app/garage');
    await expect(id(app, 'AUTH-09.root')).toBeVisible();
    expect(pathOf(app)).toBe('/app/profile-setup');
  });

  test('a closed app resumes: Überspringen finishes the profile setup, and the next open is Home', async ({ page }) => {
    const email = address('resume-skip');
    await createMember(email, freshUsername(), PASSWORD, 'profile');
    await signedInBefore(page, email);
    await open(page, '/app/garage');
    await expect(id(page, 'AUTH-09.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/profile-setup');

    // "Überspringen" finishes the step with an empty PATCH and lands in the garage.
    const skipped = page.waitForRequest((r) => r.url().includes('/api/v1/me/profile') && r.method() === 'PATCH');
    await id(page, 'AUTH-09.skip').click();
    expect((await skipped).postDataJSON()).toEqual({});
    await expect(id(page, 'GAR-01.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');

    const app = await relaunch(page, '/app/');
    await expect(id(app, 'HOME-01.root')).toBeVisible();
    expect(pathOf(app)).toMatch(/^\/app\/?$/);
  });

  test('the auth sheet brings a guest back to what they wanted', async ({ page }) => {
    // "Fahrzeug hinzufügen" in the sidebar: a guest's garage itself has no "+" since M1.6, only its sign-in invitation.
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/app/garage');
    await id(page, 'shell.sidebar.addVehicle').click();
    await expect(id(page, 'shell.authRequired')).toBeVisible();
    await id(page, 'shell.authRequired.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/add-vehicle/new/vehicle');

    const member = await freshMember('sheet');
    expect((await signIn(page, member.email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'GAR-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/add-vehicle/new/vehicle');
  });

  test('the garage invitation brings a guest back to the garage', async ({ page }) => {
    await open(page, '/app/garage');
    await id(page, 'GAR-01.guest.action').click();
    await expect(id(page, 'shell.authRequired')).toBeVisible();
    await id(page, 'shell.authRequired.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/garage');

    const member = await freshMember('invitation');
    expect((await signIn(page, member.email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'GAR-01.empty')).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');
  });

  test('a returnTo from a link never leaves the app', async ({ page }) => {
    const member = await freshMember('returnto');
    await open(page, `/app/sign-in?returnTo=${encodeURIComponent('//evil.example/steal')}`);
    expect((await signIn(page, member.email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    expect(new URL(page.url()).origin).toBe(BASE_URL);
    expect(pathOf(page)).toMatch(/^\/app\/?$/);
  });

  test('password rules read as rules, and the common list answers from the server', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('auth/register') }]);
    await open(page, '/app/sign-up');
    const rule = (key: string) => id(page, `AUTH-04.rules.${key}`);
    await expect(rule('length')).toHaveAttribute('aria-label', 'Mindestens 10 Zeichen: noch nicht erfüllt');
    await expect(rule('common')).toHaveAttribute('aria-label', 'Kein gängiges Passwort (prüfen wir beim Absenden)');

    // Nothing filled in: every field says what it needs, the first one has focus, and nothing is sent.
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/register')) sent.push(r.url());
    });
    await id(page, 'AUTH-04.cta.primary').click();
    await expect(id(page, 'AUTH-04.email.error')).toHaveText(`Gib deine E-${WJ}Mail-Adresse ein.`);
    await expect(id(page, 'AUTH-04.password.error')).toHaveText('Gib dein Passwort ein.');
    await expect(id(page, 'AUTH-04.ageConfirmed.error')).toHaveText('Bestätige, dass du mindestens 16 Jahre alt bist.');
    await expect(id(page, 'AUTH-04.termsAccepted.error')).toHaveText('Akzeptiere die AGB, um weiterzumachen.');
    await expect(id(page, 'AUTH-04.privacyAccepted.error')).toHaveText('Bestätige, dass du die Datenschutzerklärung gelesen hast.');
    await expect(id(page, 'AUTH-04.email')).toBeFocused();
    expect(sent).toEqual([]);

    const email = address('rules');
    await id(page, 'AUTH-04.email').fill(email);
    await id(page, 'AUTH-04.password').fill('kurz');
    await expect(rule('length')).toHaveAttribute('aria-label', 'Mindestens 10 Zeichen: noch nicht erfüllt');
    await id(page, 'AUTH-04.password').fill(email);
    await expect(rule('length')).toHaveAttribute('aria-label', 'Mindestens 10 Zeichen: erfüllt');
    await expect(rule('notEmail')).toHaveAttribute('aria-label', `Nicht deine E-${WJ}Mail-Adresse: noch nicht erfüllt`);
    await id(page, 'AUTH-04.password').fill('liverpool1');
    await expect(rule('notEmail')).toHaveAttribute('aria-label', `Nicht deine E-${WJ}Mail-Adresse: erfüllt`);

    // Show and hide.
    await expect(id(page, 'AUTH-04.password')).toHaveAttribute('type', 'password');
    await id(page, 'AUTH-04.password.toggle').click();
    // React Native Web drops the attribute for plain text.
    await expect(id(page, 'AUTH-04.password')).not.toHaveAttribute('type', 'password');
    await expect(id(page, 'AUTH-04.password')).toHaveValue('liverpool1');
    await id(page, 'AUTH-04.password.toggle').click();
    await expect(id(page, 'AUTH-04.password')).toHaveAttribute('type', 'password');

    for (const consent of ['ageConfirmed', 'termsAccepted', 'privacyAccepted']) await id(page, `AUTH-04.${consent}`).click();
    await resetAuthLimits();
    const answer = page.waitForResponse(isPost('auth/register'));
    await id(page, 'AUTH-04.cta.primary').click();
    expect((await answer).status()).toBe(422);
    await expect(id(page, 'AUTH-04.password.error')).toBeVisible();
    await expect(id(page, 'AUTH-04.password.error')).not.toHaveText('');
    await expect(id(page, 'AUTH-04.notice')).toHaveCount(0);
    expect(pathOf(page)).toBe('/app/sign-up');
  });

  test('a started form asks before it is left', async ({ page }) => {
    await open(page, '/app/welcome');
    await welcomeToSignUp(page);
    await id(page, 'AUTH-04.email').fill('jonas.becker@example.de');
    await id(page, 'AUTH-04.header.back').click();
    await expect(id(page, 'AUTH-04.discard')).toBeVisible();
    await id(page, 'AUTH-04.discard.keep').click();
    await expect(id(page, 'AUTH-04.email')).toHaveValue('jonas.becker@example.de');
    await id(page, 'AUTH-04.header.back').click();
    await id(page, 'AUTH-04.discard.discard').click();
    // AUTH-03 replaced itself with AUTH-04, so back leads to AUTH-12, the step before it.
    await expect(id(page, 'AUTH-12.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/auth/email');
  });

  // BH-34: a sibling link takes the address along, so that alone asks nothing. What it would lose still asks.
  test('a footer link asks only about what it would lose', async ({ page }) => {
    const email = 'jonas.becker@example.de';
    await open(page, '/app/sign-in');
    await id(page, 'AUTH-03.email').fill(email);
    await id(page, 'AUTH-03.toSignUp').click();
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
    await expect(id(page, 'AUTH-03.discard')).toHaveCount(0);
    await expect(id(page, 'AUTH-04.email')).toHaveValue(email);

    await id(page, 'AUTH-04.email').fill(`neu.${email}`);
    await id(page, 'AUTH-04.toSignIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    await expect(id(page, 'AUTH-04.discard')).toHaveCount(0);
    await expect(id(page, 'AUTH-03.email')).toHaveValue(`neu.${email}`);

    // A typed password stays behind, so this asks, and Verwerfen goes on with the address.
    await id(page, 'AUTH-03.password').fill(PASSWORD);
    await id(page, 'AUTH-03.toSignUp').click();
    await expect(id(page, 'AUTH-03.discard')).toBeVisible();
    await id(page, 'AUTH-03.discard.keep').click();
    await expect(id(page, 'AUTH-03.password')).toHaveValue(PASSWORD);
    await id(page, 'AUTH-03.toSignUp').click();
    await id(page, 'AUTH-03.discard.discard').click();
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
    await expect(id(page, 'AUTH-04.email')).toHaveValue(`neu.${email}`);

    // So does a ticked consent on the other side.
    await id(page, 'AUTH-04.termsAccepted').click();
    await id(page, 'AUTH-04.toSignIn').click();
    await expect(id(page, 'AUTH-04.discard')).toBeVisible();
    await id(page, 'AUTH-04.discard.keep').click();
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
  });

  test('a forced password change at sign-in goes straight through, whatever was typed', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 403, url: api('auth/login') }]);
    const email = 'jonas.becker@example.de';
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'password_change_required', message: 'Für dein Konto ist ein neues Passwort nötig.', next: 'reset_password', email, errors: {} }),
      }),
    );
    await open(page, '/app/sign-in');
    await signIn(page, email, PASSWORD);
    await expect(id(page, 'AUTH-07.root')).toBeVisible();
    await expect(id(page, 'AUTH-03.discard')).toHaveCount(0);
    await expect(id(page, 'AUTH-07.email')).toHaveValue(email);
    expect(pathOf(page)).toBe('/app/reset-password');
  });

  // BH-31: the server keeps the first password of an open registration (ADR-133) and answers a wrong one with invalid_code
  // (ADR-135), so after a second registration the password the app holds can be the wrong one.
  test('registering again with another password: the second refusal asks for it, and the first password works', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('auth/email/verify') }]);
    const email = address('again');
    await open(page, '/app/sign-up');
    await register(page, email);
    const code = await codeFor(email);

    await page.goBack();
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
    await id(page, 'AUTH-04.password').fill(`${PASSWORD}-zwei`);
    await resetAuthLimits();
    const again = page.waitForResponse(isPost('auth/register'));
    await id(page, 'AUTH-04.cta.primary').click();
    expect((await again).status()).toBe(202);
    await expect(id(page, 'AUTH-05.root')).toBeVisible();
    await expect(id(page, 'AUTH-05.password')).toHaveCount(0);

    // The first refusal reads as a mistyped code, as ever.
    await id(page, 'AUTH-05.code').fill(code);
    await expect(id(page, 'AUTH-05.code.error')).toHaveText(INVALID_CODE);
    await expect(id(page, 'AUTH-05.code')).toHaveValue('');
    await expect(id(page, 'AUTH-05.password')).toHaveCount(0);

    await id(page, 'AUTH-05.code').fill(code);
    await expect(id(page, 'AUTH-05.code.error')).toHaveText(INVALID_WITH_PASSWORD);
    await expect(id(page, 'AUTH-05.code')).toHaveValue(code);
    await expect(id(page, 'AUTH-05.password')).toBeVisible();

    await id(page, 'AUTH-05.password').fill(PASSWORD);
    await id(page, 'AUTH-05.cta.primary').click();
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
  });

  // BH-32: a sign-in sends no mail, so AUTH-05 claims none, and nothing holds back the way to a new code.
  test('signing in with an expired code: the screen says what to do, and a new code is one press away', async ({ page }) => {
    const email = address('later');
    await open(page, '/app/sign-up');
    await register(page, email);
    await ageCodes(email, 'email_verification');
    await id(page, 'AUTH-05.toSignIn').click();
    await expect(id(page, 'AUTH-03.email')).toHaveValue(email);
    await resetAuthLimits([email]);
    expect((await signIn(page, email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'AUTH-05.root')).toBeVisible();

    await expect(id(page, 'AUTH-05.title')).toHaveText(VERIFY_TITLE_NO_MAIL);
    await expect(id(page, 'AUTH-05.subtitle')).toContainText('Der Code gilt 10 Minuten.');
    await expect(id(page, 'AUTH-05.subtitle')).toContainText(email);
    await expect(id(page, 'AUTH-05.subtitle')).not.toContainText('geschickt');
    await expect(id(page, 'AUTH-05.resendWait')).toHaveCount(0);
    await expect(id(page, 'AUTH-05.resend')).not.toHaveAttribute('aria-disabled', 'true');
    const resent = page.waitForResponse(isPost('auth/email/resend'));
    await id(page, 'AUTH-05.resend').click();
    expect((await resent).status()).toBe(202);
    await expect(id(page, 'AUTH-05.resentToast')).toBeVisible();
  });

  // BH-29: 02_PRODUCT_SPEC §3.1, ADR-139. The code guards what puts something in front of others, not looking around.
  test('an unverified member browses, is asked to verify, and a scanned sticker comes back after the steps', async ({ page }) => {
    // A sticker of a build made for this test: a scan of a seeded code would count on the QR-02 the visual matrix takes.
    const owner = await createGarageMember('f1sticker');
    const sticker = await buildVehicle(owner.api, { photos: 1 });
    const email = address('browse');
    await open(page, '/app/sign-up');
    await register(page, email);
    const code = await codeFor(email);
    await id(page, 'AUTH-05.toSignIn').click();
    await resetAuthLimits([email]);
    expect((await signIn(page, email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'AUTH-05.root')).toBeVisible();

    // A member-only screen still leads here, and back leads to Home.
    await open(page, '/app/garage');
    await expect(id(page, 'AUTH-05.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/verify-email');
    await id(page, 'AUTH-05.header.back').click();
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await expect(id(page, 'shell.verifyNotice')).toBeVisible();

    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.title')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover');
    await expect(id(page, 'shell.verifyNotice.text')).toHaveText(VERIFY_NOTICE_SHORT);
    await expect(id(page, 'shell.verifyNotice')).toContainText(VERIFY_NOTICE_ACTION);
    await expect(id(page, 'shell.verifyNotice.action')).toHaveRole('button');
    await expect(id(page, 'shell.verifyNotice.action')).toHaveAccessibleName(`${VERIFY_NOTICE_SHORT} ${VERIFY_NOTICE_ACTION}`);
    // The desktop layout has the room for the whole sentence, and the name follows what is shown.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(id(page, 'shell.verifyNotice.text')).toHaveText(VERIFY_NOTICE);
    await expect(id(page, 'shell.verifyNotice.action')).toHaveAccessibleName(`${VERIFY_NOTICE} ${VERIFY_NOTICE_ACTION}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(id(page, 'shell.verifyNotice.text')).toHaveText(VERIFY_NOTICE_SHORT);

    await open(page, `/app/v/${sticker.slug}`);
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    await expect(id(page, 'shell.verifyNotice')).toBeVisible();

    await page.goto(`/C/${sticker.qr?.code}`);
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/v/${sticker.slug}`);

    await id(page, 'shell.verifyNotice.action').click();
    await expect(id(page, 'AUTH-05.root')).toBeVisible();
    await id(page, 'AUTH-05.code').fill(code);
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    await chooseUsername(page, freshUsername());
    await id(page, 'AUTH-09.skip').click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/v/${sticker.slug}`);
    await expect(id(page, 'shell.verifyNotice')).toHaveCount(0);
  });

  // BH-33: a shared computer, and the API gone for a moment as the member signs out.
  test('a sign-out the server did not hear goes out again, and leaves nothing a guest could use', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: api('auth/logout') }]);
    const email = address('logout');
    await createMember(email, freshUsername(), PASSWORD);
    await resetAuthLimits([email]);
    await open(page, '/app/sign-in');
    expect((await signIn(page, email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    await page.route('**/api/v1/auth/logout', (route) => route.abort('internetdisconnected'));
    await id(page, 'tab.profile').click();
    await id(page, 'PROF-01.settings').click();
    await id(page, 'SET-01.signOut').click();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    expect((await meOf(page)).status, 'the session is still valid on the server').toBe(200);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sc.logoutPending'))).toBe('1');
    await page.unroute('**/api/v1/auth/logout');

    // The next start sends the logout again, and no guest request carries the cookie meanwhile.
    const home = page.waitForRequest((r) => r.url().includes('/api/v1/home/new-builds'));
    const logout = page.waitForResponse(isPost('auth/logout'));
    await open(page, '/app/');
    expect((await logout).status()).toBe(204);
    expect((await (await home).allHeaders()).cookie ?? '').not.toContain('speed-club-session');
    await expect.poll(async () => (await meOf(page)).status).toBe(401);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sc.logoutPending'))).toBeNull();
  });

  // BH-28: one browser, one cookie. A tab follows when another one changes the member, and keeps nothing of the previous one.
  test('a second tab follows when the first changes the member', async ({ page, context }) => {
    const first = address('tab-one');
    const second = address('tab-two');
    const firstName = freshUsername();
    const secondName = freshUsername();
    await createMember(first, firstName, PASSWORD);
    await createMember(second, secondName, PASSWORD);
    await resetAuthLimits([first, second]);
    await open(page, '/app/sign-in');
    expect((await signIn(page, first, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    const other = await context.newPage();
    await open(other, '/app/profile/edit');
    await expect(id(other, 'PROF-03.username')).toHaveValue(firstName);
    await id(other, 'PROF-03.city').fill('Hamburg');

    await page.bringToFront();
    await id(page, 'tab.profile').click();
    await id(page, 'PROF-01.settings').click();
    await id(page, 'SET-01.signOut').click();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    await welcomeToPasswordSignIn(page);
    expect((await signIn(page, second, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    // Nothing had to bring the other tab to the front. Its form reloaded, with the new member's values and without the typed text.
    await expect(id(other, 'PROF-03.username')).toHaveValue(secondName);
    expect(await fieldHolds(other, 'Hamburg')).toBe(false);
    const me = await meOf(page);
    expect(me.data).toMatchObject({ username: secondName, city: null });

    // What is on disk belongs to the member whose cookie this is.
    await id(other, 'PROF-03.city').fill('Bremen');
    await expect
      .poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('sc.queryCache') ?? '{}').owner))
      .toBe(me.data?.id);
    await page.bringToFront();
    await open(page, '/app/profile');
    await expect(id(page, 'PROF-01.name')).toContainText(secondName);
    await expect(page.getByText(firstName)).toHaveCount(0);
    await other.close();
  });

  test('forgot and reset with the code: neutral answers, the new password works, the old one does not', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: api('auth/login') }]);
    const email = address('reset');
    await createMember(email, freshUsername(), PASSWORD);
    await resetAuthLimits([email]);

    // An address without an account reads exactly like one with.
    await open(page, '/app/sign-in');
    const nobody = address('unknown');
    await id(page, 'AUTH-03.email').fill(nobody);
    await id(page, 'AUTH-03.forgot').click();
    await expect(id(page, 'AUTH-06.email')).toHaveValue(nobody);
    await id(page, 'AUTH-06.cta.primary').click();
    await expect(id(page, 'AUTH-06.sent')).toBeVisible();
    const sentTitle = await id(page, 'AUTH-06.title').textContent();

    await open(page, `/app/forgot-password?email=${encodeURIComponent(email)}`);
    await expect(id(page, 'AUTH-06.email')).toHaveValue(email);
    await id(page, 'AUTH-06.cta.primary').click();
    await expect(id(page, 'AUTH-06.sent')).toBeVisible();
    await expect(id(page, 'AUTH-06.title')).toHaveText(sentTitle ?? '');
    await expect(id(page, 'AUTH-06.subtitle')).toHaveText(`Gehört ${email} zu einem Konto, ist eine E-${WJ}Mail mit Code unterwegs.`);
    const code = await codeFor(email);
    expect(await latestMail(nobody), 'no mail to an address without an account').toBeNull();

    await id(page, 'AUTH-06.cta.primary').click();
    await expect(id(page, 'AUTH-07.root')).toBeVisible();
    await expect(id(page, 'AUTH-07.email')).toHaveValue(email);
    const fresh = `${PASSWORD}-neu`;
    await id(page, 'AUTH-07.code').fill(code);
    await id(page, 'AUTH-07.password').fill(fresh);
    await id(page, 'AUTH-07.passwordRepeat').fill(`${fresh}x`);
    await id(page, 'AUTH-07.cta.primary').click();
    await expect(id(page, 'AUTH-07.passwordRepeat.error')).toHaveText('Die beiden Passwörter stimmen nicht überein.');
    await id(page, 'AUTH-07.passwordRepeat').fill(fresh);
    const reset = page.waitForResponse(isPost('auth/password/reset'));
    await id(page, 'AUTH-07.cta.primary').click();
    expect((await reset).status()).toBe(200);
    await expect(id(page, 'AUTH-07.successToast')).toBeVisible();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    await expect(id(page, 'AUTH-03.email')).toHaveValue(email);

    expect((await signIn(page, email, PASSWORD)).status()).toBe(401);
    await expect(id(page, 'AUTH-03.notice')).toHaveText(INVALID_CREDENTIALS);
    expect((await signIn(page, email, fresh)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    expect(pathOf(page)).toMatch(/^\/app\/?$/);
  });

  test('the reset link from the mail fills the form and leaves no code in the address bar', async ({ page }) => {
    const email = address('link');
    await createMember(email, freshUsername(), PASSWORD);
    await resetAuthLimits([email]);
    const asked = await page.request.post(`${BASE_URL}/api/v1/auth/password/forgot`, {
      data: { email },
      headers: { Accept: 'application/json' },
    });
    expect(asked.status()).toBe(202);
    const mail = await waitForMail(email, (m) => m.code !== null);
    // Since M2.7 the mail links to WEB-07 /email/reset with the code in the fragment, never in a query (ADR-138).
    const link = RESET_LINK.exec(mail.text)?.[0];
    expect(link, 'the mail carries the reset link').toBeTruthy();
    expect(link).not.toContain('?');

    await openResetLink(page, link as string, mail.code as string, email);
    await expect(id(page, 'AUTH-07.root')).toBeVisible();
    await expect(id(page, 'AUTH-07.email')).toHaveValue(email);
    await expect(id(page, 'AUTH-07.code')).toHaveValue(mail.code as string);
    await expect.poll(() => new URL(page.url()).hash, { message: 'the code leaves the address bar' }).toBe('');
    expect(page.url()).not.toContain(mail.code as string);

    const fresh = `${PASSWORD}-link`;
    await id(page, 'AUTH-07.password').fill(fresh);
    await id(page, 'AUTH-07.passwordRepeat').fill(fresh);
    await id(page, 'AUTH-07.cta.primary').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect((await signIn(page, email, fresh)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
  });

  test('a reset while signed in ends this session too, quietly, and sign-in follows', async ({ page }) => {
    const email = address('signedin');
    const username = freshUsername();
    await createMember(email, username, PASSWORD);
    await resetAuthLimits([email]);
    await useSession(page.context(), await apiLogin(email, PASSWORD));
    await open(page, '/app/profile');
    // Without a display name the username is the name.
    await expect(id(page, 'PROF-01.name')).toHaveText(username);

    const asked = await page.request.post(`${BASE_URL}/api/v1/auth/password/forgot`, {
      data: { email },
      headers: { Accept: 'application/json' },
    });
    expect(asked.status()).toBe(202);
    const mail = await waitForMail(email, (m) => m.code !== null);
    const link = RESET_LINK.exec(mail.text)?.[0];
    expect(link, 'the mail carries the reset link').toBeTruthy();

    // The mail link opened in the signed-in browser: WEB-07, then AUTH-07 stays, and the member stays signed in until the reset.
    await openResetLink(page, link as string, mail.code as string, email);
    await expect(id(page, 'AUTH-07.root')).toBeVisible();
    await expect(id(page, 'AUTH-07.email')).toHaveValue(email);
    expect((await meOf(page)).status).toBe(200);

    const fresh = `${PASSWORD}-signedin`;
    await id(page, 'AUTH-07.password').fill(fresh);
    await id(page, 'AUTH-07.passwordRepeat').fill(fresh);
    const reset = page.waitForResponse(isPost('auth/password/reset'));
    await id(page, 'AUTH-07.cta.primary').click();
    expect((await reset).status()).toBe(200);

    // Sign-in with the address, the success toast, and no "Sitzung abgelaufen" for a session the member just ended.
    await expect(id(page, 'AUTH-07.successToast')).toBeVisible();
    await expect(id(page, 'AUTH-07.successToast')).toContainText('Dein Passwort ist geändert. Melde dich jetzt mit dem neuen Passwort an.');
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/sign-in');
    await expect(id(page, 'AUTH-03.email')).toHaveValue(email);
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('sc.sessionMember')), 'the cached member is gone').toBeNull();
    expect((await meOf(page)).status).toBe(401);
    // Nothing sends the member home in the meantime.
    await page.waitForTimeout(500);
    expect(pathOf(page)).toBe('/app/sign-in');
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);

    expect((await signIn(page, email, fresh)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
  });
});

async function expectOwnProfile(page: Page, username: string): Promise<void> {
  // Without a display name PROF-01.name shows the username, and there is no second line for it.
  await expect(id(page, 'PROF-01.name')).toHaveText(username);
  await expect(id(page, 'PROF-01.username')).toHaveCount(0);
}

/**
 * A member on PROF-01 whose session then ends on the server: an account of its own (freshMember), whose sign-in form comes next.
 */
async function sessionEndedElsewhere(page: Page): Promise<{ email: string; username: string }> {
  const member = await freshMember('ended');
  await useSession(page.context(), await apiLogin(member.email, PASSWORD));
  await open(page, '/app/profile');
  await expectOwnProfile(page, member.username);
  await endSessionOnServer(page.context());
  await page.reload();
  return member;
}

/**
 * The ended session answers 401 to every member request of the reloaded page: auth/me, and what PROF-01 asks before that answer is in:
 * me/vehicles, and me/settings (the AI entries read the account's AI switch, features/ai/availability.ts, M3.7).
 */
const SESSION_ENDED = [
  { status: 401, url: api('auth/me') },
  { status: 401, url: api('me/vehicles') },
  { status: 401, url: api('me/settings') },
];

test.describe('a session that ended elsewhere', () => {
  test('offers to sign in again and comes back to the same place', async ({ page, expectFailedResponses }) => {
    expectFailedResponses(SESSION_ENDED);
    const member = await sessionEndedElsewhere(page);
    await expect(id(page, 'AUTH.sessionNotice')).toBeVisible();
    await expect(id(page, 'AUTH.sessionNotice.title')).toHaveText('Deine Sitzung ist abgelaufen');
    await id(page, 'AUTH.sessionNotice.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/profile');

    await resetAuthLimits([member.email]);
    expect((await signIn(page, member.email, PASSWORD)).status()).toBe(200);
    await expectOwnProfile(page, member.username);
    expect(pathOf(page)).toBe('/app/profile');
  });

  test('or lets the member go on as a guest', async ({ page, expectFailedResponses }) => {
    expectFailedResponses(SESSION_ENDED);
    await sessionEndedElsewhere(page);
    await id(page, 'AUTH.sessionNotice.guest').click();
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);
    await expect(id(page, 'PROF-01.guest')).toBeVisible();
    expect(pathOf(page)).toBe('/app/profile');
  });
});

// BH-30: the form stays until the member chooses, and its text comes back only for the same member.
test.describe('a session that ended under a form', () => {
  const TEXT = 'Winterprojekt: Getriebe neu gelagert, Ölkühler getauscht.';

  async function dirtyEditor(page: Page) {
    const owner = await createGarageMember('held');
    const vehicle = await buildVehicle(owner.api, { draft: true, photos: 0 });
    await useSession(page.context(), owner.session);
    await open(page, `/app/garage/${vehicle.id}/basics`);
    await id(page, 'GAR-05.description').fill(TEXT);
    return { owner, vehicle };
  }

  /** Speichern hears that the session is over. The form stays behind the dialog, and nothing can be saved. */
  async function saveAfterTheEnd(page: Page) {
    await endSessionOnServer(page.context());
    await id(page, 'GAR-05.cta.primary').click();
    await expect(id(page, 'AUTH.sessionNotice')).toBeVisible();
    expect(await fieldHolds(page, TEXT)).toBe(true);
  }

  test('the same member comes back to the form with the text, and Speichern works', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\/vehicles\// }]);
    const { owner, vehicle } = await dirtyEditor(page);
    await saveAfterTheEnd(page);

    await id(page, 'AUTH.sessionNotice.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);
    await resetAuthLimits([owner.email]);
    expect((await signIn(page, owner.email, GARAGE_PASSWORD)).status()).toBe(200);

    await expect(id(page, 'GAR-05.description')).toHaveValue(TEXT);
    await expect.poll(() => pathOf(page)).toBe(`/app/garage/${vehicle.id}/basics`);
    // The editor that was there, not a second one over it.
    await expect(page.locator('[data-testid="GAR-05.description"]')).toHaveCount(1);
    await expect(id(page, 'GAR-05.restricted')).toHaveCount(0);

    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/v1/vehicles/${vehicle.id}`) && r.request().method() === 'PATCH');
    await id(page, 'GAR-05.cta.primary').click();
    expect((await saved).status()).toBe(200);
    // The session of the sign-in above: the one the test started with has ended.
    const stored = await page.request.get(`${BASE_URL}/api/v1/vehicles/${vehicle.id}`, {
      headers: { Accept: 'application/json', Referer: `${BASE_URL}/app/` },
    });
    expect((await stored.json()).data.description).toBe(TEXT);
  });

  test('another member never sees the text', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\/vehicles\// }]);
    await dirtyEditor(page);
    await saveAfterTheEnd(page);

    await id(page, 'AUTH.sessionNotice.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);
    const other = await freshMember('other');
    expect((await signIn(page, other.email, PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/?$/);
    await expect.poll(() => fieldHolds(page, TEXT)).toBe(false);
  });

  test('going on as a guest lets the form go, and leaves for Welcome', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\/vehicles\// }]);
    await dirtyEditor(page);
    await saveAfterTheEnd(page);

    await id(page, 'AUTH.sessionNotice.guest').click();
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    await expect(id(page, 'GAR-05.discard')).toHaveCount(0);
    await expect.poll(() => pathOf(page)).toBe('/app/welcome');
    expect(await fieldHolds(page, TEXT)).toBe(false);
  });

  test('leaving the sign-in without signing in asks again', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\/vehicles\// }]);
    await dirtyEditor(page);
    await saveAfterTheEnd(page);

    await id(page, 'AUTH.sessionNotice.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    await expect(id(page, 'AUTH.sessionNotice')).toHaveCount(0);
    await id(page, 'AUTH-03.header.back').click();
    await expect(id(page, 'AUTH.sessionNotice')).toBeVisible();
    await expect(id(page, 'GAR-05.description')).toHaveValue(TEXT);
    await expect(id(page, 'GAR-05.cta.primary')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('server errors keep the form and say so', () => {
  const serverError = { code: 'server_error', message: 'Auf unserer Seite ist etwas schiefgelaufen. Bitte versuch es noch einmal.' };

  test('sign-in: a server error, then the limiter with its wait', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([
      { status: 500, url: api('auth/login') },
      { status: 429, url: api('auth/login') },
    ]);
    let next: { status: number; headers?: Record<string, string>; body: object } = { status: 500, body: serverError };
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({ status: next.status, headers: next.headers, contentType: 'application/json', body: JSON.stringify(next.body) }),
    );
    await open(page, '/app/sign-in');
    await signIn(page, 'jonas.becker@example.de', PASSWORD);
    await expect(id(page, 'AUTH-03.notice')).toHaveText(serverError.message);
    await expect(id(page, 'AUTH-03.email')).toHaveValue('jonas.becker@example.de');

    next = { status: 429, headers: { 'Retry-After': '42' }, body: { code: 'rate_limited', message: 'Zu viele Versuche.' } };
    await id(page, 'AUTH-03.cta.primary').click();
    await expect(id(page, 'AUTH-03.notice')).toHaveText(/^Zu viele Versuche\. Versuch es in 4[12] Sekunden noch einmal\.$/);
    await expect(id(page, 'AUTH-03.cta.primary')).toHaveAttribute('aria-disabled', 'true');
  });

  test('sign-up without a connection keeps what was typed', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: api('auth/register') }]);
    await page.route('**/api/v1/auth/register', (route) => route.abort('internetdisconnected'));
    await open(page, '/app/sign-up');
    const email = 'jonas.becker@example.de';
    await fillSignUp(page, email, PASSWORD);
    await id(page, 'AUTH-04.cta.primary').click();
    await expect(id(page, 'AUTH-04.notice')).toHaveText('Keine Verbindung. Prüfe dein Netz und versuch es noch einmal.');
    await expect(id(page, 'AUTH-04.email')).toHaveValue(email);
    expect(pathOf(page)).toBe('/app/sign-up');
  });

  test('username: the live check can fail without blocking the step', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 500, url: api('usernames/check') }]);
    await applyAuth(context, 'member-username');
    await page.route('**/api/v1/usernames/check?*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify(serverError) }),
    );
    await open(page, '/app/username');
    await id(page, 'AUTH-08.username').fill('jonas.e46');
    await expect(id(page, 'AUTH-08.checkFailed')).toHaveText(
      'Wir konnten den Namen gerade nicht prüfen. Das holen wir nach, wenn du weitermachst.',
    );
    await expect(id(page, 'AUTH-08.available')).toHaveCount(0);
  });

  test('profile setup: a 422 lands on its field, a 500 above the form', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([
      { status: 422, url: api('me/profile') },
      { status: 500, url: api('me/profile') },
    ]);
    await applyAuth(context, 'member-profile');
    let next: { status: number; body: object } = {
      status: 422,
      body: { code: 'validation_failed', message: 'Bitte prüfe deine Eingaben.', errors: { display_name: ['Dieser Name enthält Zeichen, die wir nicht zeigen können.'] } },
    };
    await page.route('**/api/v1/me/profile', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: next.status, contentType: 'application/json', body: JSON.stringify(next.body) })
        : route.fallback(),
    );
    await open(page, '/app/profile-setup');
    await id(page, 'AUTH-09.displayName').fill('Jonas Becker');
    await id(page, 'AUTH-09.cta.primary').click();
    await expect(id(page, 'AUTH-09.displayName.error')).toHaveText('Dieser Name enthält Zeichen, die wir nicht zeigen können.');
    await expect(id(page, 'AUTH-09.notice')).toHaveCount(0);

    next = { status: 500, body: serverError };
    await id(page, 'AUTH-09.skip').click();
    await expect(id(page, 'AUTH-09.notice')).toHaveText(serverError.message);
    expect(pathOf(page)).toBe('/app/profile-setup');
  });
});
