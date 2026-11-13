// M4.8 (09 §7.1) on the member web: ONB-01…03 at /app/onboarding (Weiter pages on, the last page says "Los geht’s" and ends on Start,
// Überspringen from any page, `?page=` opens a page), the AUTH-01 overlay held by `?splash=hold`, and the two ways the e2e flows and
// the visual matrix never meet either of them: an automated browser on /app gets Start, with no splash overlay over it.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { qaUrl } from '../support/qa.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;

test.describe('ONB-01…03 onboarding', () => {
  test('pages on with Weiter and ends on Start with Los geht’s', async ({ page }) => {
    await page.goto(qaUrl('/app/onboarding'));
    await expect(id(page, 'ONB-01.root')).toBeVisible();
    await expect(id(page, 'ONB-01.title')).toHaveText('Deine Garage. Jedes Detail.');
    await expect(id(page, 'ONB-01.skip')).toBeVisible();
    await id(page, 'ONB-01.next').click();
    await expect(id(page, 'ONB-02.root')).toBeVisible();
    await id(page, 'ONB-02.next').click();
    await expect(id(page, 'ONB-03.next')).toHaveText('Los geht’s');
    await id(page, 'ONB-03.next').click();
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    expect(pathOf(page)).toMatch(/^\/app\/?$/);
  });

  test('opens the page ?page= names, and Überspringen ends on Start from there', async ({ page }) => {
    await page.goto(qaUrl('/app/onboarding?page=2'));
    await expect(id(page, 'ONB-02.root')).toBeVisible();
    await expect(id(page, 'ONB-02.title')).toBeInViewport();
    await id(page, 'ONB-02.skip').click();
    await expect(id(page, 'HOME-01.root')).toBeVisible();
  });

  test('shows the live components with their Beispiel badge', async ({ page }) => {
    await page.goto(qaUrl('/app/onboarding?page=3'));
    await expect(id(page, 'ONB-03.root')).toBeVisible();
    await expect(page.locator('[data-testid="ONB-03.qr"]')).toBeVisible();
    await expect(page.locator('[data-testid="ONB-03.live"]').getByText('Beispiel')).toBeVisible();
  });
});

test.describe('AUTH-01 splash overlay', () => {
  test('?splash=hold keeps the overlay at the end of its reveal, with the logo and no spinner', async ({ page }) => {
    await page.goto(qaUrl('/app/?splash=hold'));
    await expect(page.locator('[data-testid="AUTH-01.root"]')).toBeVisible();
    await expect(page.locator('[data-testid="AUTH-01.logo"]')).toBeVisible();
    await expect(page.locator('[data-testid="AUTH-01.root"] [role="progressbar"]')).toHaveCount(0);
  });

  test('an automated browser on /app lands on Start: no onboarding, no overlay', async ({ page }) => {
    await page.goto('/app/');
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    expect(pathOf(page)).toMatch(/^\/app\/?$/);
    await expect(page.locator('[data-testid="AUTH-01.root"]')).toHaveCount(0);
  });
});
