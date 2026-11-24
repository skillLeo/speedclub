// R4B-010 and R4B-L02 (client round 4 hunt, Low): words that split without a hyphen (DOM audit High `mid-word-wrap`).
// - DISC-01 "Mitglieder mit ähnlichen Autos" at 200 % (WebKit 390): "@speedclub.editorial" broke as "editori / al". The row now takes
//   ui/MemberRow's handle rules: breakable only after "." or "_", a line of its own with an ellipsis when it cannot fit.
// - SET-18 at 200 % (WebKit 390): a stacked pair kept the half-width cap of the side-by-side pair, a 159 px line narrower than
//   "Gelöschtes" and "kommenden" ("Gelöschte / s", "kommende / n").
// - SET-18 at 360 (Chromium, system text size): "Sicherheits-E-Mail" (bound by word joiners) in a 128 px label column split as
//   "Ma / il"; a pair table whose bound run cannot fit its column now stacks.
// The HOME-02 device name ("sdk_gphone64_arm64" breaking as "ar / m") is a pure string rule, proved in Jest (tests/home/notifications).
// Only splits without a hyphen are this spec's business: "Fahr- / zeug-" (a hyphenation the audit counts outside the house rule) is
// R4B-009's.
import type { Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { runDomAudit } from '../support/dom-audit.mjs';
import { expect, test } from '../support/fixtures';

type Violation = { check: string; element: string; message: string };

/** The mid-word findings of the page whose word was split without a hyphen, as "element: message". */
async function splitWords(page: Page, opts: { theme: string; fontScale: number }, within?: RegExp): Promise<string[]> {
  const report = await runDomAudit(page, opts);
  return (report.violations as Violation[])
    .filter((v) => v.check === 'mid-word-wrap' && /without a hyphen/.test(v.message) && (!within || within.test(v.element)))
    .map((v) => `${v.element}: ${v.message}`);
}

test.describe('R4B-010 words never split without a hyphen at 200 % (WebKit 390, Schwarz)', () => {
  test.beforeEach(({ browserName }) => test.skip(browserName !== 'webkit', 'the hunt saw these in WebKit at 390'));

  test('DISC-01 similar members: a handle breaks after its "." or takes a line of its own', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    await qaGoto('/app/discover', { theme: 'black', fontScale: 2 });
    const section = byTestId('DISC-01.similarMembers');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    expect(await splitWords(page, { theme: 'black', fontScale: 2 }, /DISC-01\.similarMembers/)).toEqual([]);
  });

  test('SET-18 privacy: a stacked pair value has the whole line', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/settings/legal/privacy', { theme: 'black', fontScale: 2 });
    await expect(byTestId('SET-18.body')).toBeVisible();
    await expect(page.getByText('Gelöschtes Mitglied', { exact: false }).first()).toBeAttached();
    expect(await splitWords(page, { theme: 'black', fontScale: 2 })).toEqual([]);
  });
});

test.describe('R4B-L02 SET-18 at 360 (Chromium, system text size)', () => {
  test.beforeEach(({ browserName }) => test.skip(browserName !== 'chromium', 'the lead saw it in Chromium at 360'));

  test('privacy: a pair table with a bound run too wide for its column stacks, so "Sicherheits-E-Mail" stays whole', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await qaGoto('/app/settings/legal/privacy', { theme: 'carbon' });
    await expect(byTestId('SET-18.body')).toBeVisible();
    await expect(page.getByText('Sicherheits-', { exact: false }).first()).toBeAttached();
    expect(await splitWords(page, { theme: 'carbon', fontScale: 1 })).toEqual([]);
  });
});
