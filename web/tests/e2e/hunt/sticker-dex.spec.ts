// QA H1 sticker and STREET DEX on the member web: STK-05's "Eigene Zeile" (umlauts persist after a reload, emoji and over-long text
// refused at the field and never saved), the QR scan of a member's own sticker, and Mein Dex / a Dex card / the sets of the
// showcase member (read, back, reload, offline with the cached copy).
import { useSession, DEMO_SHOWCASE, sessionOf } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { id, open, pathOf } from '../support/flow';
import { buildVehicle, createGarageMember } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';

test.describe('STK-05 Eigene Zeile', () => {
  test('umlauts autosave and persist; emoji and 25 characters are refused and not saved', async ({ page }) => {
    const member = await createGarageMember('hunt');
    const car = await buildVehicle(member.api, { photos: 1 });
    await useSession(page.context(), member.session);
    const field = page.locator('[data-testid="STK-05.customLine"]:visible');
    const openDesigner = async () => {
      await open(page, `/app/stickers/${car.id}/design`);
      await expect(id(page, 'STK-05.controls').or(id(page, 'STK-05.grabber')).first()).toBeVisible();
      // On a phone the options sit in the dock: the grabber opens it, as a finger would.
      if (await id(page, 'STK-05.grabber').isVisible()) await id(page, 'STK-05.grabber').click();
      await expect(field).toBeVisible();
    };
    await openDesigner();
    const saves: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith(`/vehicles/${car.id}/sticker-design`)) saves.push(r.postDataJSON()?.options?.custom_line);
    });

    await field.fill('Größe & Öl – Kehre');
    await field.blur();
    await expect.poll(() => saves.at(-1), { timeout: 15_000 }).toBe('Größe & Öl – Kehre');
    await page.waitForTimeout(500);
    await openDesigner();
    await expect(field).toHaveValue('Größe & Öl – Kehre');

    const before = saves.length;
    await field.fill('Kehre 🏁');
    await field.blur();
    await expect(page.getByText('keine Emojis', { exact: false }).first()).toBeVisible();
    await field.fill('Ä'.repeat(25));
    await field.blur();
    await expect(page.getByText('Höchstens 24 Zeichen.').first()).toBeVisible();
    await page.waitForTimeout(3000);
    const sent = saves.slice(before);
    expect(sent.filter((line) => typeof line === 'string' && (/\p{Extended_Pictographic}/u.test(line) || line.length > 24))).toEqual([]);
    const stored = await member.api.get(`vehicles/${car.id}/sticker-design`);
    expect(JSON.stringify(stored.body)).not.toContain('🏁');
    await member.api.dispose();
  });

  test('the owner who scans the own sticker lands on the own build, signed in', async ({ page }) => {
    const member = await createGarageMember('hunt');
    const car = await buildVehicle(member.api, { photos: 1 });
    await useSession(page.context(), member.session);
    expect(car.qr?.code).toBeTruthy();
    await page.goto(`${BASE_URL}/c/${car.qr?.code}`);
    await expect.poll(() => pathOf(page), { timeout: 20_000 }).toMatch(new RegExp(`/v/${car.slug}$`));
    await member.api.dispose();
  });
});

test.describe('STREET DEX of the showcase member', () => {
  test('Mein Dex, a card and back, the sets, a reload; no error state anywhere', async ({ page }) => {
    await useSession(page.context(), await sessionOf(DEMO_SHOWCASE));
    await open(page, '/app/dex');
    await expect(id(page, 'DEX-01.progress')).toBeVisible();
    const card = page.locator('[data-testid^="DEX-01.card."]:visible').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(id(page, 'DEX-04.root')).toBeVisible();
    await page.goBack();
    await expect(id(page, 'DEX-01.progress')).toBeVisible();
    await open(page, '/app/dex/sets');
    await expect(id(page, 'DEX-05.root')).toBeVisible();
    await page.reload();
    await expect(id(page, 'DEX-05.root')).toBeVisible();
    await expect(page.locator('[data-testid$=".error"]:visible, [data-testid$="Error"]:visible')).toHaveCount(0);
  });

  test('offline, a Dex card seen before stays readable with the offline banner', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\// }]);
    await useSession(context, await sessionOf(DEMO_SHOWCASE));
    await open(page, '/app/dex');
    await expect(id(page, 'DEX-01.progress')).toBeVisible();
    const card = page.locator('[data-testid^="DEX-01.card."]:visible').first();
    // Seen once online: its screen's code and data are in this tab. (A screen whose code never loaded shows the shell's "Du bist
    // offline" with Neu laden, seen in the hunt; Expo's chunk loader logs that failed load, which this harness counts as an error.)
    await card.click();
    await expect(id(page, 'DEX-04.root')).toBeVisible();
    await page.goBack();
    await expect(id(page, 'DEX-01.progress')).toBeVisible();
    await context.setOffline(true);
    await card.click();
    await expect(id(page, 'DEX-04.root')).toBeVisible();
    await expect(page.locator('[data-testid$=".offline"]:visible, [data-testid$=".offlineBanner"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid$=".error"]:visible')).toHaveCount(0);
    await context.setOffline(false);
  });

  test('on the web, Spotten says what it needs instead of a dead camera', async ({ page }) => {
    await useSession(page.context(), await sessionOf(DEMO_SHOWCASE));
    await open(page, '/app/scan');
    await expect(id(page, 'DEX-02.web.state')).toBeVisible();
  });
});
