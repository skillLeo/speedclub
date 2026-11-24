// A5 Shop admin (ADM-66 Shop-Produkte, ADM-67 Shop-Banner; M5.5, m5.5-contract §5), Chromium at 1280 like the other admin flows. The
// content editor (shop.manage) opens Shop-Produkte from the nav, creates a product (hidden, with a chip), is told what blocks "Anzeigen"
// (a photo and, for the online shop, the product address: no store domain on a local host), sees a refused save keep the input
// (review SF-1), uploads a photo that is too small (refused
// in the page) and a fitting one (the 4:5 tile appears and the member preview shows the product), switches the way to buy to the
// sticker designer, shows the product (audited `shop.product_shown`), then deletes it with the recent password (⚿): it leaves the list
// and is listed under "Nur gelöschte". On Shop-Banner they create an inactive banner from a 1920 × 1280 photo and delete it again
// (typed confirm word). The moderator has no nav entry and gets the 403 page.
// The flow's own product and banner are deleted at the end; the seeded samples and the seeded active banner are not touched.
import { fileURLToPath } from 'node:url';
import { admin, choose, confirmPassword, DESKTOP, pageProps, realClock, serverLang, staffContext } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, id } from '../support/flow';

const SEED = (name: string): string => fileURLToPath(new URL(`../../../../design/seed-photos/${name}`, import.meta.url));
type ProductProps = { product: { id: string; visible: boolean; missing: string[]; images: { id: string }[] } | null; activity: { action: string }[] };
type BannerProps = { banners: { id: string; title: string; active: boolean }[] };

test.describe('A5 Shop admin', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('create → photo → designer → show (audited) → delete ⚿ · banner create/delete · moderator refused', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const stamp = Date.now().toString(36);
    const title = `E2E Clubshirt ${stamp}`;
    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'content-editor', { fresh: true });
    await realClock(page);

    // 1. Shop-Produkte from the nav, then "Neues Produkt".
    await page.goto('/admin');
    await id(page, 'shell.nav.shop-products').click();
    await expect(page).toHaveURL(/\/admin\/shop\/products$/);
    await expect(id(page, 'ADM-66.table')).toBeVisible();
    await id(page, 'ADM-66.new').click();
    await expect(id(page, 'ADM-66R.form')).toBeVisible();
    await expect(id(page, 'ADM-66R.photos-later')).toBeVisible();

    // 2. A client check first (no price), then the product: title, Kleidung, 24,90, one chip.
    await id(page, 'ADM-66R.title').fill(title);
    await id(page, 'ADM-66R.save').click();
    await expect(page.getByText(admin('shop', 'form.price_invalid'))).toBeVisible();
    await id(page, 'ADM-66R.price').fill('24,90');
    await expect(page.getByText(admin('shop', 'form.price_reads', { price: '24,90 €' }))).toBeVisible();
    await choose(page, id(page, 'ADM-66R.form'), admin('shop', 'form.category'), serverLang('enums', 'shop_category.apparel'));
    await id(page, 'ADM-66R.variant.add').click();
    await id(page, 'ADM-66R.variant.label').fill('M');
    await id(page, 'ADM-66R.save').click();
    await expect(page).toHaveURL(/\/admin\/shop\/products\/[0-9a-z]{26}$/);
    const productId = /\/products\/([0-9a-z]{26})$/.exec(page.url())![1]!;
    const path = `/admin/shop/products/${productId}`;
    await expect(id(page, 'ADM-66R.status')).toHaveText(admin('shop', 'products.visibility.hidden'));
    await expect(id(page, 'ADM-66R.missing')).toContainText(admin('shop', 'visibility.missing.image'));
    await expect(id(page, 'ADM-66R.missing')).toContainText(admin('shop', 'visibility.missing.shopify_url'));
    await expect(id(page, 'ADM-66R.visible').getByRole('switch')).toBeDisabled();
    await expect(id(page, 'ADM-66R.preview.none')).toBeVisible();

    // 2b. Review SF-1: a refused save (422 on the slug) keeps every edit next to the server's message; Save stays enabled.
    const storedSlug = await id(page, 'ADM-66R.slug').inputValue();
    await id(page, 'ADM-66R.price').fill('19,90');
    await id(page, 'ADM-66R.slug').fill('kein slug');
    await id(page, 'ADM-66R.save').click();
    await expect(id(page, 'ADM-66R.form-error')).toBeVisible();
    await expect(id(page, 'ADM-66R.slug')).toHaveAttribute('aria-invalid', 'true');
    const slugError = (await id(page, 'ADM-66R.slug').getAttribute('aria-describedby'))?.split(' ').find((ref) => ref.endsWith('-error'));
    expect(slugError, 'the slug field points at its error message').toBeTruthy();
    await expect(page.locator(`[id="${slugError}"]`)).toBeVisible();
    await expect(id(page, 'ADM-66R.price')).toHaveValue('19,90');
    await expect(id(page, 'ADM-66R.slug')).toHaveValue('kein slug');
    await expect(id(page, 'ADM-66R.save')).toBeEnabled();
    expect((await pageProps<{ product: { price_cents: number; slug: string } }>(context, path)).product).toMatchObject({ price_cents: 2490, slug: storedSlug });
    // Back to the stored values: nothing unsaved any more.
    await id(page, 'ADM-66R.price').fill('24,90');
    await id(page, 'ADM-66R.slug').fill(storedSlug);
    await expect(id(page, 'ADM-66R.save')).toBeDisabled();

    // 3. Photos: 1920 × 1280 cannot hold a 1080 × 1350 crop (refused in the page), 1536 × 1920 can.
    await page.locator('[data-testid="ADM-66R.photos.file"]').setInputFiles(SEED('nissan-z33-01.jpg'));
    await expect(id(page, 'ADM-66R.photos.error')).toContainText('1.920 × 1.280');
    await page.locator('[data-testid="ADM-66R.photos.file"]').setInputFiles(SEED('bmw-g82-01.jpg'));
    await expect(id(page, 'ADM-66R.photos.list.item')).toHaveCount(1, { timeout: 30_000 });
    await expect(id(page, 'ADM-66R.preview.frame')).toContainText(title);
    await expect(id(page, 'ADM-66R.preview.frame')).toContainText('24,90');
    await expect(id(page, 'ADM-66R.missing')).not.toContainText(admin('shop', 'visibility.missing.image'));

    // 4. Through the sticker designer: nothing missing any more, "Anzeigen" (audited).
    await id(page, 'ADM-66R.mode').getByRole('radio', { name: serverLang('enums', 'shop_purchase_mode.sticker_designer') }).click();
    await id(page, 'ADM-66R.save').click();
    await expect(id(page, 'ADM-66R.missing')).toHaveCount(0);
    await expect(id(page, 'ADM-66R.preview.buy')).toHaveText(admin('shop', 'preview.buy_designer'));
    await id(page, 'ADM-66R.visible').getByRole('switch').click();
    await expect(id(page, 'ADM-66R.status')).toHaveText(admin('shop', 'products.visibility.visible'));
    const shown = await pageProps<ProductProps>(context, path);
    expect(shown.product?.visible).toBe(true);
    expect(shown.activity.map((entry) => entry.action)).toEqual(expect.arrayContaining(['shop.product_created', 'shop.image_added', 'shop.product_updated', 'shop.product_shown']));

    // 5. Löschen ⚿: the password first, then back on the list without it; "Nur gelöschte" lists it.
    await id(page, 'ADM-66R.delete').click();
    await id(page, 'ADM-66R.delete-dialog.confirm').click();
    await confirmPassword(page);
    await expect(page).toHaveURL(/\/admin\/shop\/products$/);
    await expect(id(page, 'ADM-66.table')).not.toContainText(title);
    await page.goto('/admin/shop/products?filter[trashed]=only&filter[q]=' + encodeURIComponent(title));
    await expect(id(page, 'ADM-66.table.row')).toHaveCount(1);
    await expect(id(page, 'ADM-66.table.row')).toContainText(admin('shop', 'products.visibility.deleted'));

    // 6. Shop-Banner: a new banner starts inactive; delete it again (typed word; the password is still fresh).
    const bannerTitle = `E2E Banner ${stamp}`;
    await page.goto('/admin/shop/banners');
    await expect(id(page, 'ADM-67')).toBeVisible();
    const before = (await pageProps<BannerProps>(context, '/admin/shop/banners')).banners.find((banner) => banner.active)?.id ?? null;
    await id(page, 'ADM-67.new').click();
    await expect(id(page, 'ADM-67.drawer')).toBeVisible();
    await page.locator('[data-testid="ADM-67.file"]').setInputFiles(SEED('toyota-a80-01.jpg'));
    await expect(id(page, 'ADM-67.crop')).toBeVisible();
    await id(page, 'ADM-67.title').fill(bannerTitle);
    await id(page, 'ADM-67.save').click();
    await expect(id(page, 'ADM-67.drawer')).toBeHidden({ timeout: 30_000 });
    const row = id(page, 'ADM-67.row').filter({ hasText: bannerTitle });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('ADM-67.row.status')).toHaveText(admin('shop', 'banners.inactive'));
    const after = (await pageProps<BannerProps>(context, '/admin/shop/banners')).banners;
    expect(after.find((banner) => banner.active)?.id ?? null).toBe(before);
    await row.getByTestId('ADM-67.delete').click();
    await id(page, 'ADM-67.delete-dialog.typed').fill(admin('ui', 'confirm.typed_word'));
    await id(page, 'ADM-67.delete-dialog.confirm').click();
    await expect(id(page, 'ADM-67.row').filter({ hasText: bannerTitle })).toHaveCount(0);

    // 7. The moderator: no nav entry, the 403 page.
    const { context: moderator, page: moderatorPage } = await browserOf(
      browser,
      null,
      { pageErrors, blockedRequests, expected: [{ status: 403, url: /\/admin\/shop\/(products|banners)$/ }] },
      DESKTOP,
    );
    try {
      await staffContext(moderator, 'moderator');
      await realClock(moderatorPage);
      await moderatorPage.goto('/admin');
      await expect(id(moderatorPage, 'ADM-06')).toBeVisible();
      await expect(moderatorPage.locator('[data-testid="shell.nav.shop-products"]')).toHaveCount(0);
      await expect(moderatorPage.locator('[data-testid="shell.nav.shop-banners"]')).toHaveCount(0);
      for (const target of ['/admin/shop/products', '/admin/shop/banners']) {
        const refused = await moderatorPage.goto(target);
        expect(refused?.status()).toBe(403);
        await expect(id(moderatorPage, 'ADM-05')).toHaveAttribute('data-status', '403');
      }
    } finally {
      await moderator.close();
    }
  });
});
