// A9 client company data (client round 6, item 1, ADR-540): exactly the client's steps on the account he uses, admin.demo@speedclub.test
// as the showcase seeder leaves it (DemoShowcaseSeeder, DEMO_STAFF_PASSWORD and, when set, DEMO_STAFF_TOTP_SECRET from the environment or
// web/.env; never logged). He signs in through ADM-01 (and ADM-02 when the account has TOTP), opens Governance › Organisation, fills every
// field with German company data the way Germans type it, presses Speichern, confirms with his password, reloads (the values stay) and
// opens /impressum, which shows them.
//
// Before the fix the account was an Admin: ADM-52 showed read-only fields and "Nur ein Owner …" and no Speichern (this test failed at the
// Save step). The seeder now makes it an Owner (ADR-540: he owns the platform).
//
// Chromium only (one TOTP code per 30 s step for the one account). Cleanup: the org versions this test wrote are removed and the org cache
// is forgotten, so the legal placeholders stay as they were. Local server only.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { admin, DESKTOP, realClock, toast } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { id } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';
import { totpCode } from '../support/totp.mjs';

const run = promisify(execFile);
const ARTISAN = fileURLToPath(new URL('../../../artisan', import.meta.url));
const ENV_FILE = new URL('../../../.env', import.meta.url);
const EMAIL = 'admin.demo@speedclub.test';

/** The client's company data, as typed (spaces in the VAT ID, the phone with "(0)", umlauts). */
const COMPANY: Record<string, string> = {
  company_name: 'Schnellbau Fahrzeugkultur GmbH',
  legal_form: 'GmbH',
  street: 'Musterstraße 12',
  postal_city: '10115 Berlin',
  representative: 'Jürgen Müller-Lüdenscheidt',
  responsible_person: 'Jürgen Müller-Lüdenscheidt',
  contact_email: 'kontakt@schnellbau-fahrzeugkultur.de',
  phone: '+49 (0) 30 1234567',
  support_email: 'hilfe@schnellbau-fahrzeugkultur.de',
  privacy_email: 'datenschutz@schnellbau-fahrzeugkultur.de',
  dsa_email: 'dsa@schnellbau-fahrzeugkultur.de',
  report_email: 'meldung@schnellbau-fahrzeugkultur.de',
  register_court: 'Amtsgericht Charlottenburg',
  register_number: 'HRB 123456 B',
  vat_id: 'DE 123 456 789',
  supervisory_authority: 'Landesamt für Bürger- und Ordnungsangelegenheiten Berlin',
};

/** A value from the environment or web/.env. Never logged. */
function envValue(name: string): string | null {
  if (process.env[name]) return process.env[name] ?? null;
  let text = '';
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    return null;
  }
  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  const value = line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  return value ? value : null;
}

/** The newest org version id before the test, and removing every org version after it. */
async function orgVersions(action: 'read' | 'restore', after = 0): Promise<number> {
  if (!['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname)) throw new Error('A9 removes org versions only on a local server');
  const code =
    action === 'read'
      ? `echo (int) DB::table('config_versions')->where('key', 'org')->max('id');`
      : `DB::table('config_versions')->where('key', 'org')->where('id', '>', ${after})->delete(); App\\Services\\Privacy\\OrgIdentity::forget(); app(App\\Services\\AppConfig\\AppConfig::class)->flush(); echo 0;`;
  const { stdout } = await run(process.env.SPEEDCLUB_PHP ?? 'php', [ARTISAN, 'tinker', `--execute=${code}`], { timeout: 60_000 });
  return Number(stdout.trim().split('\n').pop() ?? '0');
}

async function signIn(page: Page, password: string, secret: string | null): Promise<void> {
  await page.goto('/admin/login');
  await id(page, 'ADM-01.email').fill(EMAIL);
  await id(page, 'ADM-01.password').fill(password);
  await id(page, 'ADM-01.submit').click();
  const challenge = id(page, 'ADM-02.form');
  const enrol = id(page, 'ADM-03.skip');
  const shell = page.getByTestId('shell.nav.settings');
  await expect(challenge.or(enrol).or(shell).first()).toBeVisible({ timeout: 20_000 });
  if (await challenge.isVisible()) {
    if (secret === null) throw new Error(`${EMAIL} asks for a code but DEMO_STAFF_TOTP_SECRET is not set`);
    await id(page, 'ADM-02.code').fill(totpCode(secret));
    await id(page, 'ADM-02.submit').click();
  } else if (await enrol.isVisible()) {
    // 2FA für Admin-Konten Optional and no TOTP yet: "Später einrichten" (the client's account has TOTP on staging).
    await enrol.click();
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

test.describe('A9 client company data', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'one account, one TOTP step: Chromium only');
    await page.setViewportSize(DESKTOP);
  });

  test('admin.demo saves every company field, the values stay after a reload, /impressum shows them', async ({ page, expectFailedResponses }) => {
    test.setTimeout(240_000);
    // The sign-in step that ends the guest session answers 409 with X-Inertia-Location (a full page load, StaffAuthChanged), which the
    // browser logs as a failed resource: from the password step without TOTP, from the code step with it.
    expectFailedResponses([
      { status: 409, url: /\/admin\/login$/ },
      { status: 409, url: /\/admin\/two-factor-challenge$/ },
    ]);
    const password = envValue('DEMO_STAFF_PASSWORD');
    test.skip(password === null, 'needs DEMO_STAFF_PASSWORD (web/.env) and the showcase staff account');
    const secret = envValue('DEMO_STAFF_TOTP_SECRET');
    const before = await orgVersions('read');

    try {
      await test.step('sign in as the client and open Governance › Organisation', async () => {
        await signIn(page, password as string, secret);
        await realClock(page);
        await page.getByTestId('shell.nav.settings').click();
        await expect(id(page, 'ADM-52.group.company')).toBeVisible();
        // The client's bug: an Admin account reads the data and cannot save it.
        await expect(id(page, 'ADM-52.view-only'), `${EMAIL} must be an Owner (ADR-540): it sees "Nur ein Owner …"`).toHaveCount(0);
        await expect(id(page, 'ADM-52.save')).toBeVisible();
      });

      await test.step('fill every field as typed and save with the password', async () => {
        for (const [field, value] of Object.entries(COMPANY)) await id(page, `ADM-52.field.${field}`).fill(value);
        await expect(id(page, 'ADM-52').getByRole('alert')).toHaveCount(0);
        await id(page, 'ADM-52.save').click();
        await expect(id(page, 'ADM-52.confirm')).toBeVisible();
        await expect(id(page, 'ADM-52.confirm.reason'), 'ADR-540: no reason field').toHaveCount(0);
        await id(page, 'ADM-52.confirm.confirm').click();
        await expect(id(page, 'shell.password')).toBeVisible();
        await id(page, 'shell.password.input').fill(password as string);
        await id(page, 'shell.password.submit').click();
        await expect(toast(page, admin('settings', 'flash.saved'))).toBeVisible();
        await expect(id(page, 'ADM-52.confirm')).toBeHidden();
      });

      await test.step('reload: every value is kept (the VAT ID normalised)', async () => {
        await page.reload();
        for (const [field, value] of Object.entries(COMPANY)) {
          await expect(id(page, `ADM-52.field.${field}`)).toHaveValue(field === 'vat_id' ? 'DE123456789' : value);
        }
      });

      await test.step('/impressum shows the company data', async () => {
        await page.goto('/impressum');
        const body = id(page, 'WEB-08.root');
        for (const text of ['Schnellbau Fahrzeugkultur GmbH', 'Musterstraße 12', '10115 Berlin', 'Amtsgericht Charlottenburg', 'HRB 123456 B', 'DE123456789']) {
          await expect(body).toContainText(text);
        }
        await expect(body).not.toContainText('[[Firmenname]]');
      });
    } finally {
      await orgVersions('restore', before);
    }
  });
});
