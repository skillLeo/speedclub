// Axe on the M1.5 screens, no serious or critical issue on the whole page: AUTH-02…09, PROF-01 (member and guest),
// PROF-03, SET-01, SET-10, SET-17 and SET-18, in the three themes on a phone and in carbon on desktop, plus the
// states a member reaches by acting: the inline errors of AUTH-04, the session dialog and the sign-out dialog.
// Chromium only (playwright.config.ts): axe's results do not depend on the engine.
import { apiLogin, applyAuth, DEMO_EMPTY_MEMBER, demoMemberPassword, endSessionOnServer, useSession } from '../support/auth.mjs';
import { resetAuthLimits } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { THEMES } from '../support/tokens.mjs';

type Screen = { name: string; path: string; auth: string; ready: string };

const SCREENS: Screen[] = [
  { name: 'AUTH-02 welcome', path: '/app/welcome', auth: 'guest', ready: 'AUTH-02.root' },
  { name: 'AUTH-03 sign-in', path: '/app/sign-in', auth: 'guest', ready: 'AUTH-03.root' },
  { name: 'AUTH-04 sign-up', path: '/app/sign-up', auth: 'guest', ready: 'AUTH-04.root' },
  { name: 'AUTH-05 verify', path: '/app/verify-email?email=nina.neu%40speedclub.test', auth: 'guest', ready: 'AUTH-05.root' },
  { name: 'AUTH-06 forgot', path: '/app/forgot-password', auth: 'guest', ready: 'AUTH-06.root' },
  { name: 'AUTH-07 reset', path: '/app/reset-password?email=nina.neu%40speedclub.test', auth: 'guest', ready: 'AUTH-07.root' },
  { name: 'AUTH-08 username', path: '/app/username', auth: 'member-username', ready: 'AUTH-08.root' },
  { name: 'AUTH-09 profile setup', path: '/app/profile-setup', auth: 'member-profile', ready: 'AUTH-09.root' },
  { name: 'PROF-01 member', path: '/app/profile', auth: 'member', ready: 'PROF-01.name' },
  { name: 'PROF-01 empty garage', path: '/app/profile', auth: 'member-empty', ready: 'PROF-01.garage.empty' },
  { name: 'PROF-01 guest', path: '/app/profile', auth: 'guest', ready: 'PROF-01.guest' },
  { name: 'PROF-03 edit', path: '/app/profile/edit', auth: 'member', ready: 'PROF-03.root' },
  { name: 'SET-01 settings', path: '/app/settings', auth: 'member', ready: 'SET-01.signOut' },
  { name: 'SET-10 appearance', path: '/app/settings/appearance', auth: 'guest', ready: 'SET-10.options' },
  { name: 'SET-17 legal list', path: '/app/settings/legal', auth: 'guest', ready: 'SET-17.list' },
  { name: 'SET-18 legal document', path: '/app/settings/legal/privacy', auth: 'guest', ready: 'SET-18.root' },
];

const CELLS = [
  ...THEMES.map((theme) => ({ theme, width: 390, height: 844 })),
  { theme: 'carbon', width: 1280, height: 800 },
];

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto, byTestId }) => {
        await applyAuth(context, screen.auth);
        await page.setViewportSize({ width, height });
        await qaGoto(screen.path, { theme });
        await expect(byTestId(screen.ready)).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

test('AUTH-04 with its inline errors', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/sign-up');
  await byTestId('AUTH-04.cta.primary').click();
  await expect(byTestId('AUTH-04.privacyAccepted.error')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('SET-01 with the sign-out dialog open', async ({ page, context, qaGoto, byTestId }) => {
  await applyAuth(context, 'member');
  await qaGoto('/app/settings');
  await byTestId('SET-01.signOut').click();
  await expect(byTestId('SET-01.signOutDialog')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('the session dialog after a session ended elsewhere', async ({ page, context, qaGoto, byTestId, expectFailedResponses }) => {
  // The ended session answers 401 to every member request the reloaded page sends: auth/me, and the garage strip's
  // me/vehicles when PROF-01 asks before the session is cleared.
  expectFailedResponses([
    { status: 401, url: /\/api\/v1\/auth\/me$/ },
    { status: 401, url: /\/api\/v1\/me\/vehicles(\?.*)?$/ },
  ]);
  await resetAuthLimits();
  await useSession(context, await apiLogin(DEMO_EMPTY_MEMBER, demoMemberPassword()));
  await qaGoto('/app/profile');
  await expect(byTestId('PROF-01.name')).toBeVisible();
  await endSessionOnServer(context);
  await page.reload();
  await expect(byTestId('AUTH.sessionNotice')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});
