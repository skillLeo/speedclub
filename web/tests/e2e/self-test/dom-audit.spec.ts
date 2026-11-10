// Proves the DOM audit in both directions: every rule of 07_QA section 3 catches a known violation,
// and a clean page built the way React Native Web builds pages produces none.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { assertNoHighViolations, isAdminUrl, runDomAudit } from '../support/dom-audit.mjs';
import { auditConfig, tokens } from '../support/tokens.mjs';

const color = (name: string, theme = 'carbon'): string => tokens.themes[theme].color[name];
/** A colour token of `theme` that `other` does not have. */
const only = (theme: string, other: string): string => {
  const others = new Set(Object.values(tokens.themes[other].color as Record<string, string>).map((v) => v.toLowerCase()));
  const hit = Object.entries(tokens.themes[theme].color as Record<string, string>).find(([n, v]) => !n.startsWith('qr.') && /^#[0-9a-f]{6}$/i.test(v) && !others.has(v.toLowerCase()));
  if (!hit) throw new Error(`No colour of ${theme} that ${other} lacks`);
  return hit[1];
};

/** The same reset as the Expo export (body overflow hidden), themed with real tokens. */
const page_ = (body: string, css = '', theme = 'carbon'): string => `<!doctype html><html lang="de"><head><style>
  html, body { height: 100%; margin: 0; }
  body { overflow: hidden; background: ${color('bg.canvas', theme)}; color: ${color('text.primary', theme)};
         font: 16px/24px Inter, sans-serif; }
  div, a, span, button, input { box-sizing: border-box; }
  .row { display: flex; flex-direction: row; }
  .btn { display: flex; width: 44px; height: 44px; align-items: center; justify-content: center; padding: 0;
         border: 0; background: transparent; color: inherit; font: 14px/20px Inter, sans-serif; }
  ${css}
</style></head><body>${body}</body></html>`;

async function audit(page: Page, html: string, opts: { theme?: string; fontScale?: number } = {}) {
  await page.setContent(html);
  return runDomAudit(page, opts);
}

const of = (report: Awaited<ReturnType<typeof audit>>, check: string) => report.violations.filter((v) => v.check === check);

test.describe('DOM audit self-test: every rule catches its violation', () => {
  test('horizontal overflow, even though the Expo reset hides body overflow', async ({ page }) => {
    const report = await audit(page, page_('<div style="width:2000px;height:20px"></div>'));
    const found = of(report, 'horizontal-overflow');
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('High');
  });

  test('a control cut off by an overflow:hidden ancestor counts as overflow', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div style="overflow:hidden;width:100vw;height:60px;position:relative">
        <button class="btn" aria-label="Mehr" data-testid="off" style="position:absolute;left:calc(100vw - 20px)"></button></div>`),
    );
    expect(of(report, 'horizontal-overflow').map((v) => v.element)).toEqual([expect.stringContaining('[off]')]);
  });

  test('clipped text: horizontal', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div data-testid="clip" style="overflow:hidden;width:50px;height:24px;white-space:nowrap">Hauptfahrzeug auswählen</div>'),
    );
    const found = of(report, 'clipped-text');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[clip]')]);
    expect(found[0]?.severity).toBe('High');
  });

  test('clipped text: fixed height container at 200 % font', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div data-testid="clip" style="overflow:hidden;width:120px;height:24px">Eine lange Beschreibung, die mehrere Zeilen braucht und abgeschnitten wird</div>'),
    );
    expect(of(report, 'clipped-text').map((v) => v.element)).toEqual([expect.stringContaining('[clip]')]);
  });

  test('clipped text: the clipping ancestor is not the text element', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div data-testid="outer" style="overflow:hidden;width:60px;height:24px"><div style="width:400px">Motorleistung in Kilowatt</div></div>'),
    );
    expect(of(report, 'clipped-text').map((v) => v.element)).toEqual([expect.stringContaining('[outer]')]);
  });

  test('clipped text: a scroller wider than its clipping parent still cuts what it shows', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div data-testid="outer" style="overflow:hidden;width:100px;height:24px">
        <div style="overflow-x:auto;width:300px"><div style="width:600px;white-space:nowrap">Nissan Silvia S15, 2001</div></div></div>`),
    );
    expect(of(report, 'clipped-text').map((v) => v.element)).toEqual([expect.stringContaining('[outer]')]);
  });

  test('truncation without accessible full text is a violation', async ({ page }) => {
    const one = await audit(
      page,
      page_('<div data-testid="t" style="overflow:hidden;width:60px;white-space:nowrap;text-overflow:ellipsis">Hauptfahrzeug auswählen</div>'),
    );
    expect(of(one, 'clipped-text')[0]?.message).toContain('aria-label');
    const clamp = await audit(
      page,
      page_('<div data-testid="t" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:100px">Eine sehr lange Beschreibung, die weit mehr als zwei Zeilen benötigt, um hier zu stehen</div>'),
    );
    expect(of(clamp, 'clipped-text')[0]?.message).toContain('aria-label');
  });

  test('overlapping controls', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div style="position:relative;height:60px">
        <button class="btn" aria-label="Eins" data-testid="a" style="position:absolute;left:0"></button>
        <button class="btn" aria-label="Zwei" data-testid="b" style="position:absolute;left:30px"></button></div>`),
    );
    const found = of(report, 'overlap');
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('High');
  });

  test('touch target below 44x44', async ({ page }) => {
    const report = await audit(page, page_('<button class="btn" aria-label="Klein" data-testid="s" style="width:32px;height:32px"></button>'));
    const found = of(report, 'touch-target');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[s]')]);
    expect(found[0]?.severity).toBe('High');
    expect(found[0]?.message).toContain('32x32');
  });

  test('one short side is enough for a touch-target violation', async ({ page }) => {
    const report = await audit(page, page_('<button class="btn" aria-label="Flach" style="width:200px;height:43px"></button>'));
    expect(of(report, 'touch-target')).toHaveLength(1);
  });

  test('admin (ADR-212): 32 for a standalone control, 24 inside a 40 px table row, and only on the admin', async ({ page }) => {
    const html = page_(`<button class="btn" aria-label="Filter" data-testid="lone" style="width:28px;height:28px"></button>
      <button class="btn" aria-label="Export" data-testid="ok32" style="width:32px;height:32px"></button>
      <table style="border-collapse:collapse"><tbody>
        <tr style="height:40px"><td style="padding:0"><button class="btn" aria-label="Öffnen" data-testid="row24" style="width:24px;height:24px"></button></td>
          <td style="padding:0"><button class="btn" aria-label="Mehr" data-testid="row20" style="width:20px;height:20px"></button></td></tr>
        <tr style="height:64px"><td style="padding:0"><button class="btn" aria-label="Sperren" data-testid="tall24" style="width:24px;height:24px"></button></td></tr>
      </tbody></table>`);
    await page.setContent(html);
    const admin = await runDomAudit(page, { surface: 'admin' });
    expect(of(admin, 'touch-target').map((v) => v.element)).toEqual([
      expect.stringContaining('[lone]'),
      expect.stringContaining('[row20]'),
      expect.stringContaining('[tall24]'),
    ]);
    expect(of(admin, 'touch-target')[0]?.message).toMatch(/below 32x32 \(admin standalone control, ADR-212\)/);
    expect(of(admin, 'touch-target')[1]?.message).toMatch(/below 24x24 \(admin control in a 40 px table row, ADR-212\)/);
    // The same page as a member surface keeps 44 for every control.
    const member = await runDomAudit(page, { surface: 'member' });
    expect(of(member, 'touch-target')).toHaveLength(5);
    // Without `surface` the URL decides: about:blank is no admin page.
    expect(of(await runDomAudit(page), 'touch-target')).toHaveLength(5);
  });

  test('a data-theme frame below <body> is checked against its own theme, and only that one', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<section data-theme="light" data-testid="frame" style="background:${color('bg.canvas', 'light')};color:${color('text.primary', 'light')}">
          <p data-testid="ok" style="margin:0">Hell</p>
          <p data-testid="carbonInLight" style="margin:0;color:${only('carbon', 'light')}">Carbon im hellen Rahmen</p>
        </section>
        <p data-testid="lightOutside" style="margin:0;color:${only('light', 'carbon')}">Hell außerhalb</p>`),
    );
    const found = of(report, 'non-token-colour');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[carbonInLight]'), expect.stringContaining('[lightOutside]')]);
    expect(found[0]?.message).toMatch(/theme "light" \(its frame\)/);
    expect(found[1]?.message).toMatch(/theme "carbon"$/);
  });

  // ADR-222: the sr-only pattern as Tailwind v4 writes it, and a skip link that leaves it on focus.
  const SR_ONLY = `.sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%);
    white-space:nowrap; border-width:0; }
    .skip:focus { position:static; width:auto; height:auto; margin:0; overflow:visible; clip-path:none; display:inline-block;
    padding:12px 16px; font:14px/20px Inter, sans-serif; }`;

  test('visually hidden text: its -1px margins and 1x1 box are a counted exemption, not off-scale spacing', async ({ page }) => {
    const report = await audit(page, page_('<span class="sr" data-testid="sr">Veränderung zum Vorzeitraum:</span><button class="sr" aria-label="Versteckt" data-testid="srBtn"></button>', SR_ONLY));
    expect(of(report, 'off-scale-spacing')).toEqual([]);
    expect(of(report, 'touch-target')).toEqual([]);
    expect(report.exemptions['visually-hidden']).toBe(3);
  });

  test('a 1x1 absolute box that is not clipped is no sr-only element: its spacing is still checked', async ({ page }) => {
    const report = await audit(page, page_('<span data-testid="dot" style="position:absolute;width:1px;height:1px;margin:-1px"></span>'));
    expect(of(report, 'off-scale-spacing').map((v) => v.element)).toEqual(Array(4).fill(expect.stringContaining('[dot]')));
    expect(report.exemptions['visually-hidden']).toBeUndefined();
  });

  test('a skip link is measured focused: 120x44 passes on a member page and the admin, focus goes back', async ({ page }) => {
    const html = page_('<input aria-label="Suche" data-testid="search" style="width:200px;height:44px;margin:0;padding:0;border:0"><a href="#main" class="sr skip" data-testid="skip">Zum Inhalt springen</a><main id="main"></main>', SR_ONLY);
    await page.setContent(html);
    await page.locator('[data-testid="search"]').focus();
    for (const surface of ['member', 'admin'] as const) {
      const report = await runDomAudit(page, { surface });
      expect(of(report, 'touch-target')).toEqual([]);
      expect(report.exemptions['skip-link-focused']).toBe(1);
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('search');
  });

  test('a skip link too small when focused fails the floor of its surface (32 admin, 44 member)', async ({ page }) => {
    await page.setContent(page_('<a href="#main" class="sr skip" data-testid="skip">Zum Inhalt</a><main id="main"></main>', `${SR_ONLY} .skip:focus { padding:4px 8px; }`));
    const admin = await runDomAudit(page, { surface: 'admin' });
    expect(of(admin, 'touch-target').map((v) => v.message)).toEqual([expect.stringMatching(/focused skip link .* is below 32x32 \(ADR-222\)/)]);
    const member = await runDomAudit(page, { surface: 'member' });
    expect(of(member, 'touch-target').map((v) => v.message)).toEqual([expect.stringMatching(/below 44x44 \(ADR-222\)/)]);
  });

  test('a skip link that stays hidden when focused is a touch-target violation', async ({ page }) => {
    const report = await audit(page, page_('<a href="#main" class="sr" data-testid="skip">Zum Inhalt springen</a><main id="main"></main>', SR_ONLY));
    expect(of(report, 'touch-target').map((v) => v.message)).toEqual(['skip link does not become visible when focused (ADR-222)']);
  });

  test('isAdminUrl: /admin and below, nothing else', () => {
    expect(isAdminUrl('http://localhost:8080/admin')).toBe(true);
    expect(isAdminUrl('http://localhost:8080/admin/audit?event=1')).toBe(true);
    expect(isAdminUrl('http://localhost:8080/administration')).toBe(false);
    expect(isAdminUrl('http://localhost:8080/app/admin')).toBe(false);
    expect(isAdminUrl('about:blank')).toBe(false);
  });

  test('a wrapper around a small control does not count unless declared', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div style="padding:16px"><button class="btn" aria-label="Klein" style="width:24px;height:24px"></button></div>'),
    );
    expect(of(report, 'touch-target')).toHaveLength(1);
  });

  test('a declared wrapper with two controls does not count', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div data-qa-hit-wrapper style="width:100px;height:48px" class="row">
        <button class="btn" aria-label="A" style="width:24px;height:24px"></button>
        <button class="btn" aria-label="B" style="width:24px;height:24px"></button></div>`),
    );
    expect(of(report, 'touch-target')).toHaveLength(2);
  });

  test('icon-only control without a name', async ({ page }) => {
    const report = await audit(
      page,
      page_('<button class="btn" data-testid="i"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg></button>'),
    );
    const found = of(report, 'missing-label');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[i]')]);
    expect(found[0]?.severity).toBe('High');
  });

  test('off-scale margin, padding and gap', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div data-testid="m" style="margin-top:13px;padding-left:7px;height:10px"></div><div class="row" style="gap:5px;height:10px"></div>'),
    );
    const messages = of(report, 'off-scale-spacing').map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('margin-top: 13px'),
        expect.stringContaining('padding-left: 7px'),
        expect.stringContaining('row-gap: 5px'),
        expect.stringContaining('column-gap: 5px'),
      ]),
    );
    expect(of(report, 'off-scale-spacing')[0]?.severity).toBe('Medium');
  });

  test('non-token text, background and border colours', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div style="color:#123456;font:16px/24px Inter">Falsche Farbe</div>
        <div style="background:rgb(1,2,3);height:10px"></div>
        <div style="border:1px solid #00ff00;height:10px"></div>`),
    );
    const messages = of(report, 'non-token-colour').map((v) => v.message);
    expect(messages.some((m) => m.startsWith('color:'))).toBe(true);
    expect(messages.some((m) => m.startsWith('background-color:'))).toBe(true);
    expect(messages.filter((m) => m.startsWith('border-'))).toHaveLength(4);
    expect(of(report, 'non-token-colour')[0]?.severity).toBe('Medium');
  });

  test('a colour of another theme is not a token of the active one', async ({ page }) => {
    const report = await audit(page, page_(`<div style="background:${color('bg.canvas', 'light')};height:10px"></div>`));
    expect(of(report, 'non-token-colour')).toHaveLength(1);
    const light = await audit(page, page_(`<div style="background:${color('bg.canvas', 'light')};height:10px"></div>`, '', 'light'), {
      theme: 'light',
    });
    expect(of(light, 'non-token-colour')).toHaveLength(0);
  });

  test('an rgba token with a wrong alpha is not the token', async ({ page }) => {
    const report = await audit(page, page_('<div style="background:rgba(0,0,0,0.5);height:10px"></div>'));
    expect(of(report, 'non-token-colour')).toHaveLength(1);
  });

  for (const theme of ['carbon', 'black', 'light']) {
    test(`qr tokens are only valid inside the QR region (${theme})`, async ({ page }) => {
      // Only a qr.* colour that no general token of the theme shares can prove the rule: qr.fg is pure black, which
      // media.ground (DQ-104) is too, and qr.bg is white, as text.onAccent is. qr.caption belongs to the QR card alone.
      const { colors, qrColors } = auditConfig({ theme });
      const general = new Set(colors.map(({ r, g, b, a }) => `${r},${g},${b},${a}`));
      const qrOnly = qrColors.filter(({ r, g, b, a }) => !general.has(`${r},${g},${b},${a}`));
      expect(qrOnly.map((t) => t.name), 'a qr colour of its own to test with').toContain('qr.caption');
      for (const token of qrOnly) {
        const value = color(token.name, theme);
        const outside = await audit(page, page_(`<div style="background:${value};height:10px"></div>`, '', theme), { theme });
        expect(of(outside, 'non-token-colour'), `${token.name} outside`).toHaveLength(1);
        const inside = await audit(
          page,
          page_(`<div data-qa-exempt="qr"><div style="background:${value};height:10px"></div></div>`, '', theme),
          { theme },
        );
        expect(of(inside, 'non-token-colour'), `${token.name} inside`).toHaveLength(0);
        expect(inside.exemptions.qr).toBe(1);
      }
    });
  }

  test('font-size/line-height pair not in the type scale', async ({ page }) => {
    const report = await audit(page, page_('<div style="font:16px/20.5px Inter">Text</div><div style="font:15px/24px Inter">Text</div>'));
    const found = of(report, 'non-scale-font');
    expect(found).toHaveLength(2);
    expect(found[0]?.severity).toBe('Medium');
  });

  test('line-height normal is not a pair', async ({ page }) => {
    const report = await audit(page, page_('<div style="font-size:16px;line-height:normal">Text</div>'));
    expect(of(report, 'non-scale-font')).toHaveLength(1);
  });

  test('a font outside the tokens is reported', async ({ page }) => {
    const report = await audit(page, page_('<div style="font:16px/24px Georgia">Text</div>'));
    expect(of(report, 'non-scale-font')[0]?.message).toContain('Georgia');
  });

  test('image without explicit dimensions or aspect ratio', async ({ page }) => {
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const report = await audit(
      page,
      page_(`<img src="${pixel}" alt="" data-testid="img" style="width:100px"><div data-testid="bg" style="background-image:url(${pixel});width:100px;height:auto;padding-top:0"><span>Text</span></div>`),
    );
    const found = of(report, 'image-without-aspect');
    expect(found.map((v) => v.element)).toEqual(expect.arrayContaining([expect.stringContaining('[img]'), expect.stringContaining('[bg]')]));
    expect(found[0]?.severity).toBe('Medium');
  });

  test('an unknown exemption is reported, so the exception list cannot grow silently', async ({ page }) => {
    const report = await audit(page, page_('<div data-qa-exempt="everything" style="height:10px"></div>'));
    expect(of(report, 'unknown-exemption')).toHaveLength(1);
  });

  test('assertNoHighViolations throws on High and lists them', async ({ page }) => {
    const report = await audit(page, page_('<button class="btn" aria-label="Klein" style="width:10px;height:10px"></button>'));
    expect(report.counts.High).toBeGreaterThan(0);
    expect(() => assertNoHighViolations(report)).toThrow(/touch-target/);
  });
});

test.describe('DOM audit self-test: exemptions for one kind of element', () => {
  // ADR-149: FS-1 puts the Welcome logo's top at 28 % of the height.
  test('brand-position frees the margins of the AUTH-02 logo slot only, and is counted', async ({ page }) => {
    const slot = await audit(page, page_('<div data-testid="AUTH-02.logoSlot" data-qa-exempt="brand-position" style="margin-top:236.32px;height:40px"></div>'));
    expect(slot.violations).toEqual([]);
    expect(slot.exemptions['brand-position']).toBe(1);

    const logo = await audit(page, page_('<div data-testid="AUTH-02.logo" data-qa-exempt="brand-position" style="margin-top:236.32px;height:40px"></div>'));
    expect(logo.violations).toEqual([]);
  });

  test('brand-position keeps paddings and gaps on the scale', async ({ page }) => {
    const report = await audit(
      page,
      page_('<div data-testid="AUTH-02.logoSlot" data-qa-exempt="brand-position" style="margin-top:236.32px;padding-top:13px;height:40px"></div>'),
    );
    expect(of(report, 'off-scale-spacing').map((v) => v.message)).toEqual([expect.stringContaining('padding-top')]);
  });

  test('brand-position anywhere else is an unknown exemption and frees nothing', async ({ page }) => {
    const report = await audit(page, page_('<div data-testid="AUTH-03.logo" data-qa-exempt="brand-position" style="margin-top:236.32px;height:40px"></div>'));
    expect(of(report, 'unknown-exemption')).toHaveLength(1);
    expect(of(report, 'unknown-exemption')[0]?.severity).toBe('Medium');
    expect(of(report, 'off-scale-spacing')).toHaveLength(1);
    expect(report.exemptions['brand-position']).toBeUndefined();
  });

  // ADR-150: the initials follow the circle, not the font scale.
  const avatar = (size: number, font: string, text = 'LS', radius = '9999px') =>
    page_(`<div style="width:${size}px;height:${size}px;border-radius:${radius};display:flex;align-items:center;justify-content:center;background:${color('bg.raised')}">
      <div data-qa-exempt="fixed-glyph" style="font:${font};color:${color('text.secondary')}">${text}</div></div>`);

  test('fixed-glyph keeps an avatar\'s initials at their scale-1 pair at 200 %, and is counted', async ({ page }) => {
    const title = tokens.typography['title.m'];
    const report = await audit(page, avatar(tokens.size.avatar.xl, `600 ${title.size}px/${title.lineHeight}px Inter`), { fontScale: 2 });
    expect(report.violations).toEqual([]);
    expect(report.exemptions['fixed-glyph']).toBe(1);
    const one = tokens.typography.caption;
    const small = await audit(page, avatar(tokens.size.avatar.xs, `500 ${one.size}px/${one.lineHeight}px Inter`, 'Ö'), { fontScale: 2 });
    expect(small.violations).toEqual([]);
  });

  test('fixed-glyph still needs a pair of the type scale', async ({ page }) => {
    const report = await audit(page, avatar(tokens.size.avatar.xl, '600 21px/27px Inter'), { fontScale: 2 });
    expect(of(report, 'non-scale-font').map((v) => v.message)).toEqual([expect.stringContaining('fixed-glyph')]);
    // A scaled pair is not a fixed glyph either.
    const title = tokens.typography['title.m'];
    const scaled = await audit(page, avatar(tokens.size.avatar.xl, `600 ${title.size * 2}px/${title.lineHeight * 2}px Inter`), { fontScale: 2 });
    expect(of(scaled, 'non-scale-font')).toHaveLength(1);
  });

  test('fixed-glyph on anything but an avatar\'s initials is an unknown exemption and frees nothing', async ({ page }) => {
    const label = tokens.typography.label;
    const font = `600 ${label.size}px/${label.lineHeight}px Inter`;
    for (const html of [
      avatar(tokens.size.avatar.xl, font, 'Lukas'), // a word, not initials
      avatar(tokens.size.avatar.xl, font, 'LS', '8px'), // a square, not a circle
      avatar(48, font), // no avatar size
      page_(`<div data-qa-exempt="fixed-glyph" style="font:${font}">LS</div>`),
    ]) {
      const report = await audit(page, html, { fontScale: 2 });
      expect(of(report, 'unknown-exemption')).toHaveLength(1);
      expect(of(report, 'non-scale-font')).toHaveLength(1);
      expect(report.exemptions['fixed-glyph']).toBeUndefined();
    }
  });

  test('an inactive tab kept mounted with visibility:hidden (+ aria-hidden, no pointer events) is not audited', async ({ page }) => {
    // b83fcf0: web tabs stay mounted; the hidden one overlaps the shown one exactly.
    const tab = (hidden: boolean) =>
      `<div ${hidden ? 'aria-hidden="true" style="visibility:hidden;pointer-events:none;position:absolute;inset:0"' : 'style="position:absolute;inset:0"'}>
        <button class="btn" aria-label="Weiter" style="position:absolute;left:10px;top:10px"></button><div style="width:30px;overflow:hidden;white-space:nowrap;font:16px/24px Inter">Abgeschnittener Text hier</div></div>`;
    const report = await audit(page, page_(`<div style="position:relative;height:200px">${tab(true)}${tab(false)}</div>`));
    expect(of(report, 'overlap')).toEqual([]);
    expect(of(report, 'clipped-text')).toHaveLength(1);
  });

  test('a focusable scroll region under a fixed bar is no control: no overlap, no touch target, counted', async ({ page }) => {
    const html = page_(`<div tabindex="0" style="overflow-y:auto;height:844px;width:390px"><div style="height:800px"></div></div>
      <div style="position:fixed;left:0;bottom:0;width:390px;height:64px" class="row"><button class="btn" aria-label="Start"></button></div>`);
    const report = await audit(page, html);
    expect(of(report, 'overlap')).toEqual([]);
    expect(of(report, 'touch-target')).toEqual([]);
    expect(report.exemptions['focusable-scroller']).toBe(1);
    // A named region (SettingsPage) is the same thing.
    const region = await audit(page, html.replace('tabindex="0" style', 'tabindex="0" role="region" aria-label="Einstellungen" style'));
    expect(of(region, 'overlap')).toEqual([]);
    // With a role it is a control again.
    const asButton = await audit(page, html.replace('tabindex="0" style', 'tabindex="0" role="button" style'));
    expect(of(asButton, 'overlap').length).toBeGreaterThan(0);
  });

  // ADR-145 + design-QA ruling (M2.8): a tab label in a 72 cell stops at 1.15, below the `tab` token's own cap of 1.3.
  const tabBar = (cell: number, font: string, { container = 'shell.tabbar', exempt = true } = {}) =>
    page_(`<div data-testid="${container}"><div role="tablist" class="row">
      <div role="tab" aria-selected="true" aria-label="Nachrichten" tabindex="0" style="width:${cell}px;height:56px;display:flex;align-items:center;justify-content:center">
        <div ${exempt ? 'data-qa-exempt="tab-label"' : ''} style="font:${font};color:${color('text.secondary')}">Nachrichten</div>
      </div></div></div>`);
  const tabAt = (scale: number) => {
    const tab = tokens.typography.tab;
    return `600 ${tab.size * scale}px/${tab.lineHeight * scale}px Inter`;
  };

  test('tab-label lets a 72 px tab-bar label keep the tab pair at 1.15 at 200 %, and is counted', async ({ page }) => {
    const report = await audit(page, tabBar(72, tabAt(1.15)), { fontScale: 2 });
    expect(report.violations).toEqual([]);
    expect(report.exemptions['tab-label']).toBe(1);
    // Without the exemption the same label is off the scale at 200 % (the token's own cap is 1.3).
    const plain = await audit(page, tabBar(72, tabAt(1.15), { exempt: false }), { fontScale: 2 });
    expect(of(plain, 'non-scale-font')).toHaveLength(1);
  });

  test('tab-label accepts only the capped tab pair, not the scaled one or another token', async ({ page }) => {
    const scaled = await audit(page, tabBar(72, tabAt(1.3)), { fontScale: 2 });
    expect(of(scaled, 'non-scale-font').map((v) => v.message)).toEqual([expect.stringContaining('tab-label')]);
    const label = tokens.typography.label;
    const other = await audit(page, tabBar(72, `600 ${label.size * 2}px/${label.lineHeight * 2}px Inter`), { fontScale: 2 });
    expect(of(other, 'non-scale-font')).toHaveLength(1);
    // At scale 1 the cap does nothing: the pair is the token's.
    const one = await audit(page, tabBar(72, tabAt(1)), { fontScale: 1 });
    expect(one.violations).toEqual([]);
  });

  test('tab-label outside a 72 px cell of the tab bar is an unknown exemption and frees nothing', async ({ page }) => {
    for (const html of [
      tabBar(90, tabAt(1.15)), // a wider cell keeps the token's cap
      tabBar(72, tabAt(1.15), { container: 'shell.rail' }), // the rail is not the tab bar
      page_(`<div data-qa-exempt="tab-label" style="font:${tabAt(1.15)}">Nachrichten</div>`),
    ]) {
      const report = await audit(page, html, { fontScale: 2 });
      expect(of(report, 'unknown-exemption')).toHaveLength(1);
      expect(of(report, 'non-scale-font')).toHaveLength(1);
      expect(report.exemptions['tab-label']).toBeUndefined();
    }
  });
});

test.describe('DOM audit self-test: font scale', () => {
  test('at scale 2 the expected sizes are doubled', async ({ page }) => {
    const report = await audit(page, page_('<div style="font:32px/48px Inter">Text</div>'), { fontScale: 2 });
    expect(of(report, 'non-scale-font')).toHaveLength(0);
  });

  test('at scale 2 text that did not scale is reported', async ({ page }) => {
    const report = await audit(page, page_('<div style="font:16px/24px Inter">Text</div>'), { fontScale: 2 });
    expect(of(report, 'non-scale-font')).toHaveLength(1);
  });

  test('tab and badge stay capped at maxFontScale', async ({ page }) => {
    const capped = tokens.typography.tab;
    const size = capped.size * capped.maxFontScale;
    const line = capped.lineHeight * capped.maxFontScale;
    const ok = await audit(page, page_(`<div style="font:${size}px/${line}px Inter">Tab</div>`), { fontScale: 2 });
    expect(of(ok, 'non-scale-font')).toHaveLength(0);
    const uncapped = await audit(page, page_(`<div style="font:${capped.size * 2}px/${capped.lineHeight * 2}px Inter">Tab</div>`), {
      fontScale: 2,
    });
    expect(of(uncapped, 'non-scale-font')).toHaveLength(1);
  });
});

test.describe('DOM audit self-test: no false positives', () => {
  const clean = page_(
    `
    <!-- framework wrappers: nested views with zero margins and token backgrounds -->
    <div style="position:absolute;inset:0;pointer-events:none;visibility:hidden"></div>
    <div class="fill" style="height:100%">
      <div class="fill" style="display:none">
        <!-- a hidden tab screen full of violations must not count -->
        <button style="width:2px;height:2px;margin:3px;background:#123456"></button>
      </div>
      <div inert style="height:0">
        <button style="width:2px;height:2px"></button>
      </div>
      <div class="fill scroll" data-testid="scroller">
        <div style="padding:20px">
          <!-- type scale and tokens -->
          <div style="font:700 28px/34px Inter;letter-spacing:-0.4px">Garage</div>
          <div style="font:400 14px/20px Inter;color:${color('text.secondary')}">Sekundär</div>
          <div style="font:700 40px/44px 'Barlow Semi Condensed';overflow:hidden;height:44px">Skyline</div>

          <!-- intentional numberOfLines truncation with accessible full text -->
          <div aria-label="Ein sehr langer Fahrzeugname, der abgeschnitten wird"
               style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100px;font:400 14px/20px Inter">
            Ein sehr langer Fahrzeugname, der abgeschnitten wird</div>
          <div title="Eine lange Beschreibung, die mehrere Zeilen braucht und über zwei Zeilen hinausgeht"
               style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:120px;font:400 14px/20px Inter">
            Eine lange Beschreibung, die mehrere Zeilen braucht und über zwei Zeilen hinausgeht</div>

          <!-- auto and percentage margins are layout results, not spacing -->
          <div style="margin:0 auto;width:133px;height:8px"></div>
          <div style="margin-left:7%;height:8px"></div>

          <!-- buttons, with a hit area of 44 from different sources -->
          <div class="row" style="gap:8px;margin-top:16px;position:relative">
            <button class="btn" aria-label="Normal"></button>
            <button class="btn" aria-label="Unsichtbarer Hit-Slop" style="width:36px;height:36px;position:relative">
              <span style="position:absolute;inset:-4px;display:block"></span>
            </button>
            <button class="btn pseudo" aria-label="Pseudo-Hit-Slop" style="width:36px;height:36px"></button>
            <div data-qa-hit-wrapper style="width:48px;height:48px">
              <button class="btn" aria-label="Deklarierter Wrapper" style="width:24px;height:24px"></button>
            </div>
            <label style="display:flex;width:120px;height:44px;font:400 14px/20px Inter;align-items:center">
              <input type="checkbox" style="margin:0;width:22px;height:22px"> Label
            </label>
          </div>

          <!-- RN Web Switch: native input with opacity 0 over a visual -->
          <div data-qa-hit-wrapper class="row" style="width:100px;height:56px;position:relative;margin-top:16px">
            <div style="width:51px;height:31px;background:${color('accent.fill')};position:relative">
              <input type="checkbox" role="switch" aria-label="Schalter" style="position:absolute;inset:0;opacity:0;margin:0;width:100%;height:100%">
            </div>
          </div>

          <!-- nested control inside a card: the ancestor/descendant pair is axe's business -->
          <div role="button" tabindex="0" aria-label="Karte" style="height:88px;position:relative;margin-top:16px;background:${color('bg.surface')}">
            <button class="btn" aria-label="Merken" style="position:absolute;right:8px;top:8px"></button>
          </div>

          <!-- inline link within a sentence -->
          <p style="margin:16px 0 0;font:400 14px/20px Inter">Mit dem Fortfahren akzeptierst du die <a href="#x" style="color:${color('accent.fg')}">Datenschutzerklärung</a> von uns.</p>

          <!-- images with explicit size: attributes, aspect ratio, RN Web absolute fill, background -->
          <img alt="" width="16" height="16" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          <div style="aspect-ratio:4/3;width:100%;position:relative;overflow:hidden">
            <img alt="" style="position:absolute;inset:0;width:100%;height:100%" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          </div>
          <div style="width:40px;height:40px;position:relative">
            <div style="position:absolute;inset:0;background-image:url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)"></div>
          </div>

          <!-- text on a photo uses onPhoto tokens, the photo surface itself is exempt -->
          <div data-qa-exempt="photo" style="height:64px;background:#5a6b7c;position:relative">
            <div style="color:${color('onPhoto.primary')};background:${color('onPhoto.chipBg')};font:600 11px/13px Inter">Hauptfahrzeug</div>
          </div>

          <!-- QR card keeps its black on white -->
          <div data-qa-exempt="qr" style="background:${color('qr.bg')};color:${color('qr.fg')};padding:16px;font:400 13px/18px Inter">
            <svg width="64" height="64" viewBox="0 0 2 2"><rect width="1" height="1" fill="#000"/></svg>
            <div style="color:${color('qr.caption')}">speedclub.de/c/7H2K</div>
          </div>

          <!-- safe-area inset on the element that carries it -->
          <div data-qa-exempt="safe-area" style="padding-bottom:47px"></div>
          <div data-qa-exempt="hairline" style="margin-top:1px;border-top:1px solid ${color('border.subtle')}"></div>

          <!-- horizontal chip scroller reaching beyond the viewport -->
          <div class="row" style="overflow-x:auto;width:100%;margin-top:16px">
            <button class="btn" aria-label="Chip" style="flex:none;width:2000px">Sehr breit</button>
          </div>

          <!-- off-canvas slide: all of it outside the clip box -->
          <div style="overflow:hidden;width:100px;height:24px;position:relative">
            <div style="position:absolute;left:400px;white-space:nowrap">Nächstes Bild</div>
          </div>

          <!-- row that scrolls under the tab bar, plus enough height to scroll -->
          <div style="height:1200px"></div>
          <a href="#row" class="btn" style="width:100%" aria-label="Zeile am Ende"></a>
        </div>
      </div>
      <!-- pinned tab bar over the scroller, translucent token background -->
      <div class="row" style="position:fixed;left:0;right:0;bottom:0;height:64px;background:${color('tabBar.background')}">
        <a href="#h" role="tab" aria-selected="true" class="btn" aria-label="Home"></a>
        <a href="#d" role="tab" aria-selected="false" class="btn" aria-label="Discover"></a>
      </div>
    </div>
    <!-- a row deliberately behind the tab bar at load, inside the scroller -->
    <style>.fill { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .scroll { overflow-y: auto; overflow-x: hidden; }
      .pseudo { position: relative; }
      .pseudo::before { content: ''; position: absolute; left: -4px; top: -4px; width: 44px; height: 44px; }
    </style>`,
    '',
  );

  test('a clean page in RN Web structure has zero violations', async ({ page }) => {
    const report = await audit(page, clean);
    expect(report.violations).toEqual([]);
    expect(report.counts).toEqual({ High: 0, Medium: 0 });
    expect(report.exemptions.photo).toBe(1);
    expect(report.exemptions.qr).toBe(1);
    expect(report.exemptions['inline-text-link']).toBe(1);
    expect(report.scanned.interactive).toBeGreaterThan(10);
  });

  test('a row under a pinned bar does not count, two rows inside one scroller do', async ({ page }) => {
    const underBar = await audit(
      page,
      page_(`<div style="height:100%;overflow-y:auto">
        <a href="#a" class="btn" style="width:100%;margin-top:64px" aria-label="Zeile"></a><div style="height:2000px"></div></div>
        <a href="#b" class="btn" style="position:fixed;top:60px;left:0" aria-label="Fixiert"></a>`),
    );
    expect(of(underBar, 'overlap')).toHaveLength(0);
    expect(underBar.exemptions['overlap-resolved-by-scrolling']).toBe(1);

    const inScroller = await audit(
      page,
      page_(`<div style="height:100%;overflow-y:auto;position:relative">
        <a href="#a" class="btn" style="position:absolute;top:0;left:0" aria-label="Eins"></a>
        <a href="#b" class="btn" style="position:absolute;top:0;left:20px" aria-label="Zwei"></a>
        <div style="height:2000px"></div></div>`),
    );
    expect(of(inScroller, 'overlap')).toHaveLength(1);
  });

  test('a carousel card past the edge is scrolled away, not cut, even when body overflows for another reason', async ({ page }) => {
    // PROF-01's garage strip at 430: the next card peeks, and an unrelated box makes body 12 px wider than the viewport.
    const report = await audit(
      page,
      page_(`<div style="position:relative;width:100vw;height:200px">
        <div style="position:absolute;left:calc(100vw - 98px);width:110px;height:20px"></div>
        <div data-testid="strip" style="overflow-x:auto;width:100vw"><div class="row" style="width:200vw">
          <div style="flex:none;width:80vw;font:16px/24px Inter">Nissan Skyline GT-R R34</div>
          <div style="flex:none;width:80vw;font:16px/24px Inter;white-space:nowrap">Nissan Silvia S15, 2001</div>
        </div></div></div>`),
    );
    expect(of(report, 'clipped-text')).toEqual([]);
  });

  test('a control clipped away by its container does not overlap', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div style="position:relative;height:60px">
        <div style="overflow:hidden;width:44px;height:44px;position:absolute;left:0">
          <button class="btn" aria-label="Innen" style="width:44px"></button></div>
        <button class="btn" aria-label="Daneben" style="position:absolute;left:44px"></button></div>`),
    );
    expect(of(report, 'overlap')).toHaveLength(0);
  });
});
