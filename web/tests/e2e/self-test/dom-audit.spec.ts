// Proves the DOM audit in both directions: every rule of 07_QA section 3 catches a known violation,
// and a clean page built the way React Native Web builds pages produces none.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { assertNoHighViolations, isAdminUrl, runDomAudit } from '../support/dom-audit.mjs';
import { DESKTOP_MIN_WIDTH, auditConfig, tokens } from '../support/tokens.mjs';

/** Where the web applies the desktop type sizes (layout.breakpoints.desktop). */
const DESKTOP: number = DESKTOP_MIN_WIDTH;

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

/** Where the layout broke the cell's text: its characters grouped by line, "Fahr / zeuge,". */
const textLines = (page: Page, id: string): Promise<string> =>
  page.locator(`[data-testid="${id}"]`).evaluate((el) => {
    const node = el.firstChild as Text;
    const range = document.createRange();
    let out = '';
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < node.data.length; i++) {
      const char = node.data.charAt(i);
      // A space at a line end hangs (no box of its own): it belongs to no line.
      if (/\s/.test(char)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const boxes = [...range.getClientRects()].filter((b) => b.width > 0);
      if (boxes.length === 0) continue;
      // The lowest box is the glyph; Chromium reports the generated hyphen of a break above with the character after it.
      const glyph = boxes.reduce((low, b) => (b.top > low.top ? b : low));
      if (out !== '' && glyph.top - last > glyph.height / 2) out += ' / ';
      else if (out !== '' && /\s/.test(node.data.charAt(i - 1))) out += ' ';
      last = Math.max(last, glyph.top);
      out += char;
    }
    return out;
  });

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

  test('a ThemeScope brand stage (data-theme-scope) is checked against its scope theme, not the page theme (DQ-1045)', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<section data-theme-scope="carbon" data-testid="stage" style="background:${color('bg.canvas', 'carbon')};color:${color('text.primary', 'carbon')}">
          <p data-testid="ok" style="margin:0;color:${only('carbon', 'light')}">Carbon auf der Bühne</p>
          <p data-testid="offPalette" style="margin:0;color:rgb(1, 2, 3)">Keine Farbe der Palette</p>
        </section>`),
      { theme: 'light' },
    );
    const found = of(report, 'non-token-colour');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[offPalette]')]);
    expect(found[0]?.message).toMatch(/theme "carbon" \(its frame\)/);
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
      const { colors, qrColors } = auditConfig({ theme, viewportWidth: 390 });
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
    const title = tokens.typography['title.2'];
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
    const title = tokens.typography['title.2'];
    const scaled = await audit(page, avatar(tokens.size.avatar.xl, `600 ${title.size * 2}px/${title.lineHeight * 2}px Inter`), { fontScale: 2 });
    expect(of(scaled, 'non-scale-font')).toHaveLength(1);
  });

  test('fixed-glyph on anything but an avatar\'s initials is an unknown exemption and frees nothing', async ({ page }) => {
    const label = tokens.typography['body.strong'];
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

  // ADR-145 + design-QA ruling (M2.8): a tab label in a 72 cell stops at 1.15, below the `web.tab` token's own cap of 1.3.
  const tabBar = (cell: number, font: string, { container = 'shell.tabbar', exempt = true } = {}) =>
    page_(`<div data-testid="${container}"><div role="tablist" class="row">
      <div role="tab" aria-selected="true" aria-label="Nachrichten" tabindex="0" style="width:${cell}px;height:56px;display:flex;align-items:center;justify-content:center">
        <div ${exempt ? 'data-qa-exempt="tab-label"' : ''} style="font:${font};color:${color('text.secondary')}">Nachrichten</div>
      </div></div></div>`);
  const tabAt = (scale: number) => {
    const tab = tokens.typography['web.tab'];
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
    const label = tokens.typography['body.strong'];
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

test.describe('DOM audit self-test: mid-word wrap (09 §4.2, DQ-801)', () => {
  // How React Native Web sets a Text: it breaks a word that does not fit instead of letting it overflow.
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const numeral = "font:600 40px/40px 'Archivo Condensed'";
  const cell = (token: string, width: number, extra = '', attrs = '') =>
    `<div style="width:${width}px"><div data-testid="value" ${attrs} style="${rnText};${numeral};${extra}">${token}</div></div>`;

  for (const token of ['2002', 'AWD', '1.725', '3,9']) {
    test(`a short token broken over two lines is High: "${token}"`, async ({ page }) => {
      const report = await audit(page, page_(cell(token, 24)));
      const found = of(report, 'mid-word-wrap');
      expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[value]')]);
      expect(found[0]?.severity).toBe('High');
      expect(found[0]?.message).toContain(`"${token}" breaks inside the word`);
    });
  }

  test('the same token where it fits is fine', async ({ page }) => {
    const report = await audit(page, page_(cell('2002', 200)));
    expect(of(report, 'mid-word-wrap')).toEqual([]);
  });

  test('words that wrap at their spaces are not this check; a long word broken without a hyphen is (DQ-925)', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div style="width:120px;${rnText};font:600 30px/34px 'Archivo SemiExpanded'" data-testid="name">Golf GTI</div>
        <div style="width:120px;${rnText};font:400 15px/22px Inter" data-testid="long">Fahrwerksabstimmungsprotokoll</div>`),
    );
    // Before DQ-925 the check looked at short tokens only, and this break by overflow-wrap went unseen.
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([expect.stringContaining('[long]')]);
    expect(of(report, 'mid-word-wrap')[0]?.message).toContain('"Fahrwerksabstimmungsprotokoll" across two lines without a hyphen');
  });

  test('a measurement mirror and visually hidden text are not measured', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none">${cell('2002', 24)}</div>
        <div aria-hidden="true" style="pointer-events:none">${cell('1.725', 24)}</div>
        <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${cell('AWD', 24)}</span>`),
    );
    expect(of(report, 'mid-word-wrap')).toEqual([]);
  });

  test('an aria-hidden token that is on screen and in the flow is still checked', async ({ page }) => {
    const report = await audit(page, page_(`<div aria-hidden="true">${cell('2002', 24)}</div>`));
    expect(of(report, 'mid-word-wrap')).toHaveLength(1);
  });

  test('a token with an explicit break opportunity or break-anywhere styling is intent, counted as such', async ({ page }) => {
    const report = await audit(
      page,
      page_(`${cell('Prüf&shy;stand', 24)}${cell('AB&#8203;CD', 24)}${cell('1.725', 24, 'word-break:break-all')}${cell('3,9', 24, 'line-break:anywhere')}`),
    );
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(report.exemptions['mid-word-intent']).toBe(4);
  });

  test('a token whose only child elements are <wbr> is intent; any other child element is not a leaf (N-4)', async ({ page }) => {
    const report = await audit(page, page_(`${cell('AB<wbr>CD', 24)}${cell('20<wbr>02', 24)}${cell('<span>2002</span><wbr>', 24)}`));
    // The third cell is no leaf; its inner span is one, without a break opportunity, so it is reported.
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('"2002" breaks inside the word')]);
    expect(report.exemptions['mid-word-intent']).toBe(2);
  });

  test('a short token that wraps at its own hyphen is a finding (07 §3)', async ({ page }) => {
    const report = await audit(page, page_(`${cell('GT-R', 24)}${cell('E-Auto', 24)}`));
    expect(of(report, 'mid-word-wrap')).toHaveLength(2);
    expect(report.exemptions['mid-word-intent']).toBeUndefined();
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });
});

test.describe('DOM audit self-test: house hyphenation is intent (DQ-181), nothing else is', () => {
  // The house rule as web/resources/css/public.css and mobile/src/ui/Text.tsx (WEB_HYPHENATION) set it, on an RN Web Text.
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const house = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:10 4 4;-webkit-hyphenate-limit-before:4;-webkit-hyphenate-limit-after:4';
  const body = 'font:400 16px/24px Inter';
  const cell = (id: string, word: string, width: number, style: string, lang = 'de') =>
    `<div style="width:${width}px"><div data-testid="${id}" lang="${lang}" style="${rnText};${body};${style}">${word}</div></div>`;
  /** The advance of `text` in the cell's font on this engine, so a cell is exactly as narrow as a case needs. */
  const advance = async (page: Page, text: string): Promise<number> => {
    await page.setContent(page_(''));
    return page.evaluate(
      ({ text, font }) => {
        const ctx = document.createElement('canvas').getContext('2d');
        if (!ctx) throw new Error('no 2d canvas');
        ctx.font = font;
        return ctx.measureText(text).width;
      },
      { text, font: '400 16px Inter' },
    );
  };

  test('"Nachrichten" and "Mitteilungen" hyphenated in a narrow cell are the exemption hyphenation, not a finding', async ({ page }) => {
    // "Nach-" fits 60 but not "Nachrich-"; "Mittei-" fits 70 but not "Mitteilun-" (Inter 16): one dictionary break each.
    const report = await audit(page, page_(`${cell('n', 'Nachrichten', 60, house)}${cell('m', 'Mitteilungen', 70, house)}`));
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    // Counted only for a token that did wrap: both cells broke and both breaks were hyphenations.
    expect(report.exemptions['hyphenation']).toBe(2);
    expect(report.exemptions['mid-word-intent']).toBeUndefined();
  });

  test('the same words under hyphens manual or none, broken by overflow-wrap, are findings', async ({ page }) => {
    const report = await audit(
      page,
      page_(
        `${cell('n', 'Nachrichten', 60, 'hyphens:manual;-webkit-hyphens:manual;overflow-wrap:anywhere')}` +
          `${cell('m', 'Mitteilungen', 70, 'hyphens:manual;-webkit-hyphens:manual;overflow-wrap:anywhere')}` +
          `${cell('x', 'Nachrichten', 60, 'hyphens:none;-webkit-hyphens:none')}`,
      ),
    );
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([
      expect.stringContaining('[n]'),
      expect.stringContaining('[m]'),
      expect.stringContaining('[x]'),
    ]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('"2002" and "AWD" under hyphens auto are still findings (DQ-801): only letters hyphenate', async ({ page }) => {
    const numeral = "font:600 40px/40px 'Archivo Condensed'";
    const report = await audit(
      page,
      page_(
        `<div style="width:24px"><div data-testid="year" lang="de" style="${rnText};${numeral};${house}">2002</div></div>` +
          `<div style="width:24px"><div data-testid="drive" lang="de" style="${rnText};${numeral};${house}">AWD</div></div>`,
      ),
    );
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([
      expect.stringContaining('"2002" breaks inside the word'),
      expect.stringContaining('"AWD" breaks inside the word'),
    ]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('a word under 10 letters is a finding, even where the element allows shorter words', async ({ page }) => {
    // "Nachricht" (9) in the house cell, and in a cell whose own limits would let the engine hyphenate it ("Nach-richt").
    const report = await audit(
      page,
      page_(`${cell('house', 'Nachricht', 50, house)}${cell('lax', 'Nachricht', 50, 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:5 2 2')}`),
    );
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([expect.stringContaining('[house]'), expect.stringContaining('[lax]')]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('a hyphenation that leaves fewer than 4 letters on a side is a finding', async ({ page }) => {
    // An element with looser limits lets the engine break "Mitteilun-gen" (3 after the break); the house rule needs 4.
    const width = Math.ceil(await advance(page, 'Mitteilun-')) + 2;
    const lax = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:5 2 2;-webkit-hyphenate-limit-before:2;-webkit-hyphenate-limit-after:2';
    const report = await audit(page, page_(cell('short', 'Mitteilungen', width, lax)));
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([expect.stringContaining('[short]')]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('a long word under hyphens auto that overflow-wrap breaks without a hyphen is a finding', async ({ page }) => {
    // No dictionary for the language (zxx): the engine cannot hyphenate, and overflow-wrap breaks "Nachri|chten", 6 and 5
    // letters, both sides long enough. Without a visible hyphen it is a break inside the word.
    const width = Math.ceil(await advance(page, 'Nachri')) + 1;
    expect(await advance(page, 'Nachric')).toBeGreaterThan(width);
    const report = await audit(page, page_(cell('plain', 'Nachrichten', width, house, 'zxx')));
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([expect.stringContaining('[plain]')]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('the same words where they fit are no wrap and no exemption', async ({ page }) => {
    const report = await audit(page, page_(`${cell('n', 'Nachrichten', 200, house)}${cell('m', 'Mitteilungen', 200, house)}`));
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });
});

test.describe('DOM audit self-test: mid-word wrap in running text (DQ-923, DQ-925)', () => {
  // An RN Web Text inside an RN Web View (a flex item), the way Text.tsx renders running text, at the cell's width.
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const house = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:10 4 4;-webkit-hyphenate-limit-before:4;-webkit-hyphenate-limit-after:4';
  const body = 'font:400 16px/24px Inter';
  const cell = (id: string, text: string, width: number, style = '', lang = 'de') =>
    `<div style="display:flex;flex-direction:column;width:${width}px"><div data-testid="${id}" lang="${lang}" style="${rnText};${body};${style}">${text}</div></div>`;
  const advance = async (page: Page, text: string): Promise<number> => {
    await page.setContent(page_(''));
    return page.evaluate(
      ({ text, font }) => {
        const ctx = document.createElement('canvas').getContext('2d');
        if (!ctx) throw new Error('no 2d canvas');
        ctx.font = font;
        return ctx.measureText(text).width;
      },
      { text, font: '400 16px Inter' },
    );
  };
  /** How many lines an element's text takes, so a case proves it wrapped at all. */
  const linesOf = (page: Page, id: string): Promise<number> =>
    page.locator(`[data-testid="${id}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));

  test('"Google Play" in a flex item narrower than "Google": the word breaks without a hyphen, High (DQ-923)', async ({ page }) => {
    const width = Math.floor(await advance(page, 'Googl')) + 1;
    const report = await audit(page, page_(cell('store', 'Bei Google Play laden', width)));
    const found = of(report, 'mid-word-wrap');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[store]')]);
    expect(found[0]?.severity).toBe('High');
    expect(found[0]?.message).toContain('the word "Google" across two lines without a hyphen');
  });

  test('"Unbedenklichkeitsbescheinigung" in a sentence, broken by overflow-wrap under hyphens manual: a finding (DQ-925)', async ({ page }) => {
    const report = await audit(page, page_(cell('doc', 'Die Unbedenklichkeitsbescheinigung liegt vor.', 140, 'hyphens:manual;-webkit-hyphens:manual')));
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('"Unbedenklichkeitsbescheinigung"')]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('a long word under hyphens auto without a dictionary (overflow-wrap, no hyphen) is a finding in running text too', async ({ page }) => {
    const width = Math.ceil(await advance(page, 'Nachri')) + 1;
    const report = await audit(page, page_(cell('plain', 'Neue Nachrichten', width, house, 'zxx')));
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('the word "Nachrichten" across two lines without a hyphen')]);
  });

  test('dictionary hyphenation under the house rule in a sentence is the exemption hyphenation, not a finding', async ({ page }) => {
    // As the leaf cases: "Nach-" fits 60, "Mittei-" fits 70, and the word before goes on its own line.
    const report = await audit(page, page_(`${cell('n', 'Deine Nachrichten', 60, house)}${cell('m', 'Alle Mitteilungen', 70, house)}`));
    expect(await linesOf(page, 'n')).toBeGreaterThanOrEqual(3);
    expect(await linesOf(page, 'm')).toBeGreaterThanOrEqual(3);
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(report.exemptions['hyphenation']).toBe(2);
  });

  test('a visible hyphen outside the house rule is still a finding: a 9-letter word, a split that leaves 3', async ({ page }) => {
    const lax = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:5 2 2;-webkit-hyphenate-limit-before:2;-webkit-hyphenate-limit-after:2';
    const width = Math.ceil(await advance(page, 'Mitteilun-')) + 2;
    const report = await audit(page, page_(`${cell('short', 'Alle Mitteilungen', width, lax)}${cell('nine', 'Eine Nachricht', 50, lax)}`));
    const found = of(report, 'mid-word-wrap');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[short]'), expect.stringContaining('[nine]')]);
    for (const v of found) expect(v.message).toContain('outside the house rule as the engine counts it (hyphenate-limit-chars)');
  });

  test('an e-mail and a URL broken only at their own break points (ZWSP after "@" and "/", before ".") are no word breaks', async ({ page }) => {
    const mail = 'lukas.sc@​speedclub​.test';
    const url = 'speedclub.test/​v/​nissan​-skyline';
    const width = Math.ceil(Math.max(await advance(page, 'lukas.sc@'), await advance(page, 'speedclub.test/'), await advance(page, 'nissan'))) + 4;
    const report = await audit(page, page_(`${cell('mail', mail, width)}${cell('url', url, width)}`));
    expect(await linesOf(page, 'mail')).toBeGreaterThanOrEqual(2);
    expect(await linesOf(page, 'url')).toBeGreaterThanOrEqual(2);
    expect(of(report, 'mid-word-wrap')).toEqual([]);
  });

  test('the same e-mail without break points, broken between two letters, is a finding', async ({ page }) => {
    const width = Math.ceil(await advance(page, 'lukas.sc@spee')) + 1;
    const report = await audit(page, page_(cell('mail', 'lukas.sc@speedclub.test', width)));
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('the word "speedclub" across two lines')]);
  });

  test('break-anywhere styling is intent; mirrors, visually hidden and rotated text are not read', async ({ page }) => {
    const width = Math.floor(await advance(page, 'Googl')) + 1;
    const report = await audit(
      page,
      page_(
        `${cell('any', 'Bei Google Play laden', width, 'word-break:break-all')}` +
          `<div aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none">${cell('mirror', 'Bei Google Play laden', width)}</div>` +
          `<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${cell('sr', 'Bei Google Play laden', width)}</span>` +
          `<div style="transform:rotate(90deg);width:200px">${cell('turned', 'Bei Google Play laden', 200)}</div>`,
      ),
    );
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(report.exemptions['mid-word-intent']).toBe(1);
  });

  test('words that fit their lines, and breaks at spaces, are no finding and no exemption', async ({ page }) => {
    const report = await audit(page, page_(cell('fit', 'Bei Google Play laden, die Unbedenklichkeitsbescheinigung liegt vor', 400)));
    expect(await linesOf(page, 'fit')).toBeGreaterThanOrEqual(2);
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });
});

test.describe('DOM audit self-test: hyphenation as the engine counts it (MF-R4-3)', () => {
  // The house rule on an RN Web Text, as in the running-text block above.
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const house = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:10 4 4;-webkit-hyphenate-limit-before:4;-webkit-hyphenate-limit-after:4';
  const lax = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:5 2 2;-webkit-hyphenate-limit-before:2;-webkit-hyphenate-limit-after:2';
  const cell = (id: string, text: string, width: number, style: string) =>
    `<div style="display:flex;flex-direction:column;width:${width}px"><div data-testid="${id}" lang="de" style="${rnText};font:400 16px/24px Inter;${style}">${text}</div></div>`;
  const advance = async (page: Page, text: string): Promise<number> => {
    await page.setContent(page_(''));
    return page.evaluate((t) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('no 2d canvas');
      ctx.font = '400 16px Inter';
      return ctx.measureText(t).width;
    }, text);
  };
  const linesOf = textLines;
  /** A cell that fits `head` plus the generated hyphen and the rest on the next line, and no later hyphenation point. */
  const widthFor = async (page: Page, head: string, rest: string) => Math.ceil(Math.max(await advance(page, `${head}-`), await advance(page, rest))) + 2;

  // The engine-legal breaks of the r5 capture: both installed engines read hyphenate-limit-chars and count the attached punctuation
  // (probe of 2026-11-11, Chromium 156 and WebKit 27.2). Each word alone (a short-token leaf, or running text when longer than 12) and
  // after "die" (running text): the engine's own break, a visible hyphen, the exemption.
  for (const [id, head, rest, word] of [
    ['fahr', 'Fahr', 'zeuge,', 'Fahrzeuge,'],
    ['commu', 'Commu', 'nity', 'Community-Richtlinien'],
    ['aufneh', 'aufneh', 'men,', 'aufnehmen,'],
    ['mitglie', 'Mitglie', 'der,', 'Mitglieder,'],
    ['einspr', 'Einsprü', 'che;', 'Einsprüche;'],
    ['zurueck', 'zurückneh', 'men.', 'zurücknehmen.'],
    ['pruefPunct', 'Prüf', 'stand.', 'Prüfstand.'],
  ] as const) {
    test(`"${head}- / ${rest}" under the house rule is the engine's own hyphenation: the exemption, not a finding`, async ({ page }) => {
      const width = await widthFor(page, head, rest);
      const report = await audit(page, page_(`${cell(`${id}-alone`, word, width, house)}${cell(`${id}-text`, `die ${word}`, width, house)}`));
      // The case is real only when the engine broke exactly there (alone) and inside the word at all (after "die").
      expect((await linesOf(page, `${id}-alone`)).startsWith(`${head} / ${rest}`)).toBe(true);
      expect((await linesOf(page, `${id}-text`)).replace(/^die( \/)? /, '')).toContain(' / ');
      expect(of(report, 'mid-word-wrap')).toEqual([]);
      expect(report.exemptions['hyphenation']).toBeGreaterThanOrEqual(2);
    });
  }

  test('a part joined by a word joiner belongs to the segment: "SS-\u2060La- / dern" (10 with the joiner) is the engines\' own break', async ({ page }) => {
    // GAR-02's "GT-SS-\u2060Ladern": both engines count "SS-\u2060Ladern" from the break after "GT-", the joiner included, and hyphenate
    // "La-dern"; "X-\u2060Ladern" (9) they never hyphenate (probe of 2026-11-11).
    // Running text: a short-token leaf stays letters with attached punctuation only (a hyphen inside it is a finding, 07 §3).
    const width = await widthFor(page, 'SS-\u2060La', 'dern');
    const report = await audit(page, page_(cell('joinedText', 'die SS-\u2060Ladern', width, house)));
    // WebKit gives the joiner a box of its own, Chromium none: compared without it.
    expect((await linesOf(page, 'joinedText')).replace(/\u2060/g, '')).toBe('die / SS-La / dern');
    expect(of(report, 'mid-word-wrap')).toEqual([]);
    expect(of(report, 'name-hyphen-break')).toEqual([]);
    expect(report.exemptions['hyphenation']).toBe(1);
  });

  test('"Am Prüfstand" (9, no punctuation): neither engine hyphenates it; overflow-wrap breaks it without a hyphen (High)', async ({ page }) => {
    // Both engines read hyphenate-limit-chars: the word minimum of 10 counts "Prüfstand." (above) but not this.
    expect(await page.evaluate(() => CSS.supports('hyphenate-limit-chars', '10 4 4'))).toBe(true);
    const width = await widthFor(page, 'Prüf', 'stand');
    const report = await audit(page, page_(cell('pruef', 'Am Prüfstand', width, house)));
    expect(await linesOf(page, 'pruef')).toBe('Am / Prüfs / tand');
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('"Prüfs / tand" breaks the word "Prüfstand" across two lines without a hyphen')]);
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });

  test('an engine without hyphenate-limit-chars has no word minimum: "Nach- / richt" is then its own hyphenation (model, MF-R4-3)', async ({ page }) => {
    // The lax cell lets both installed engines break "Nach-richt" (4 and 5). Audited as such an engine would count (the audit reads
    // CSS.supports, stubbed here for hyphenate-limit-chars only), it is the exemption; as the installed engines count, a finding.
    const html = page_(cell('nine', 'Eine Nachricht', 50, lax));
    const real = await audit(page, html);
    expect(await linesOf(page, 'nine')).toBe('Eine / Nach / richt');
    expect(of(real, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('(counted here: 9 in the word, 4 before, 5 after)')]);
    await page.setContent(html);
    await page.evaluate(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((property: string, value?: string) =>
        property === 'hyphenate-limit-chars' ? false : value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports;
    });
    const older = await runDomAudit(page);
    expect(of(older, 'mid-word-wrap')).toEqual([]);
    expect(older.exemptions['hyphenation']).toBe(1);
  });

  test('attached punctuation is counted: "Mitteilun- / gen." keeps 4 after the break (exemption), "Mitteilun- / gen" 3 (High)', async ({ page }) => {
    // Lax limits let the engine break after "Mitteilun" in both cells; the audit applies the house limits (4 after) as counted.
    const width = Math.ceil(await advance(page, 'Mitteilun-')) + 2;
    const report = await audit(page, page_(`${cell('dot', 'Mitteilungen.', width, lax)}${cell('bare', 'Mitteilungen', width, lax)}`));
    expect(await linesOf(page, 'dot')).toBe('Mitteilun / gen.');
    expect(await linesOf(page, 'bare')).toBe('Mitteilun / gen');
    expect(of(report, 'mid-word-wrap').map((v) => v.element)).toEqual([expect.stringContaining('[bare]')]);
    expect(report.exemptions['hyphenation']).toBe(1);
  });

  test('opening punctuation counts before the break: "(Ver- / träge)" keeps 4 (exemption), "Ver- / träge" leaves 3 (High)', async ({ page }) => {
    // Each cell fits its first syllable with the hyphen and the rest, not "Verträ-"; alone (leaf) and after "die" (running text).
    const paren = await widthFor(page, '(Ver', 'träge)');
    const bare = await widthFor(page, 'Ver', 'träge');
    const report = await audit(
      page,
      page_(
        `${cell('paren', '(Verträge)', paren, lax)}${cell('bare', 'Verträge', bare, lax)}` +
          `${cell('parenText', 'die (Verträge)', paren, lax)}${cell('bareText', 'die Verträge', bare, lax)}`,
      ),
    );
    expect(await linesOf(page, 'paren')).toBe('(Ver / träge)');
    expect(await linesOf(page, 'bare')).toBe('Ver / träge');
    expect(await linesOf(page, 'parenText')).toBe('die / (Ver / träge)');
    expect(await linesOf(page, 'bareText')).toBe('die / Ver / träge');
    const found = of(report, 'mid-word-wrap');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[bare]'), expect.stringContaining('[bareText]')]);
    expect(found[1]?.message).toContain('"Ver- / träge" hyphenates "Verträge" outside the house rule as the engine counts it (hyphenate-limit-chars)');
    expect(found[1]?.message).toContain('(counted here: 8 in the word, 3 before, 5 after)');
    expect(report.exemptions['hyphenation']).toBe(2);
  });

  test('a break without a hyphen between two letters stays High under hyphens auto (no dictionary, zxx)', async ({ page }) => {
    const width = Math.ceil(await advance(page, 'Nachri')) + 1;
    const html = `<div style="display:flex;flex-direction:column;width:${width}px"><div data-testid="plain" lang="zxx" style="${rnText};font:400 16px/24px Inter;${house}">Neue Nachrichten,</div></div>`;
    const report = await audit(page, page_(html));
    const found = of(report, 'mid-word-wrap');
    expect(found.map((v) => v.message)).toEqual([expect.stringContaining('breaks the word "Nachrichten" across two lines without a hyphen')]);
    expect(found[0]?.severity).toBe('High');
    expect(report.exemptions['hyphenation']).toBeUndefined();
  });
});

test.describe('DOM audit self-test: a word wider than its line keeps its finding, with the reason (SF-R4-1)', () => {
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const lax = 'hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:5 2 2;-webkit-hyphenate-limit-before:2;-webkit-hyphenate-limit-after:2';
  const cell = (id: string, text: string, width: number, style = '', padding = 0) =>
    `<div style="display:flex;flex-direction:column;width:${width}px;padding:0 ${padding}px"><div data-testid="${id}" lang="de" style="${rnText};font:400 16px/24px Inter;${style}">${text}</div></div>`;
  const advance = async (page: Page, text: string): Promise<number> => {
    await page.setContent(page_(''));
    return page.evaluate((t) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('no 2d canvas');
      ctx.font = '400 16px Inter';
      return ctx.measureText(t).width;
    }, text);
  };

  test('"Mönchengladbach" wider than its bubble: High, and the message says the word is wider than its line', async ({ page }) => {
    // The line box is the content box: the cell's padding (8 + 8) narrows it below the word.
    const word = await advance(page, 'Mönchengladbach');
    const width = Math.floor(word) - 8 + 16;
    const report = await audit(page, page_(cell('bubble', 'Bei einem Spezialisten in Mönchengladbach.', width, 'hyphens:manual;-webkit-hyphens:manual', 8)));
    const found = of(report, 'mid-word-wrap');
    expect(found.map((v) => v.message)).toEqual([expect.stringContaining('the word "Mönchengladbach" across two lines without a hyphen (word wider than its line: ')]);
    expect(found[0]?.severity).toBe('High');
    expect(found[0]?.message).toMatch(/\(word wider than its line: [\d.]+ px word, [\d.]+ px line\)$/);
  });

  test('a short token wider than its cell ("QXMB"): High, with the same reason', async ({ page }) => {
    const width = Math.floor(await advance(page, 'QXM')) + 2;
    const report = await audit(page, page_(cell('code', 'QXMB', width)));
    expect(of(report, 'mid-word-wrap').map((v) => v.message)).toEqual([expect.stringContaining('"QXMB" breaks inside the word over 2 lines (word wider than its line: ')]);
  });

  test('a hyphenation outside the house rule in a word that fits its line: High, without that reason', async ({ page, browserName }) => {
    // "Alle Mitteilun-" fits, "Mitteilungen" alone fits too: the word could have gone to the next line whole. WebKit hyphenates it
    // there ("Alle Mitteilun- / gen"); Chromium moves it whole (layout probe of 2026-11-11), so it has nothing to report. The width
    // comparison is engine-independent; the reason-bearing side is proven in both engines above.
    const width = Math.ceil(Math.max((await advance(page, 'Alle Mitteilun-')) + 6, await advance(page, 'Mitteilungen'))) + 2;
    expect(await advance(page, 'Alle Mitteilungen')).toBeGreaterThan(width);
    const report = await audit(page, page_(cell('fits', 'Alle Mitteilungen', width, lax)));
    const found = of(report, 'mid-word-wrap');
    if (browserName === 'chromium') {
      expect(await textLines(page, 'fits')).toBe('Alle / Mitteilungen');
      expect(found).toEqual([]);
      return;
    }
    expect(await textLines(page, 'fits')).toBe('Alle Mitteilun / gen');
    expect(found.map((v) => v.message)).toEqual([expect.stringContaining('"Mitteilun- / gen" hyphenates "Mitteilungen" outside the house rule')]);
    expect(found[0]?.message).not.toContain('wider than its line');
  });
});

test.describe('DOM audit self-test: name-hyphen-break (DQ-926)', () => {
  const rnText = 'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word';
  const body = 'font:400 16px/24px Inter';
  const cell = (id: string, text: string, width: number) =>
    `<div style="display:flex;flex-direction:column;width:${width}px"><div data-testid="${id}" lang="de" style="${rnText};${body}">${text}</div></div>`;
  /** A cell exactly wide enough for `line` (which ends at the hyphen), so the layout breaks right after it. */
  const widthFor = async (page: Page, line: string): Promise<number> => {
    await page.setContent(page_(''));
    const w = await page.evaluate((text) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('no 2d canvas');
      ctx.font = '400 16px Inter';
      return ctx.measureText(text).width;
    }, line);
    return Math.ceil(w) + 2;
  };

  /** The layout did break right after `line` (which ends at the hyphen): the next character sits on a lower line. */
  const breaksAfter = (page: Page, id: string, line: string): Promise<boolean> =>
    page.locator(`[data-testid="${id}"]`).evaluate((el, at) => {
      const node = el.firstChild as Text;
      const box = (offset: number) => {
        const r = document.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rects = [...r.getClientRects()].filter((b) => b.width > 0);
        return rects.reduce((low, b) => (b.top > low.top ? b : low));
      };
      const hyphen = box(at - 1);
      return box(at).top - hyphen.top > hyphen.height / 2;
    }, line.length);

  for (const [id, text, line, split] of [
    ['gtr', 'Nissan Skyline GT-R R34', 'Nissan Skyline GT-', '"GT- / R"'],
    ['slip', 'Akrapovič Slip-On Abgasanlage', 'Akrapovič Slip-', '"Slip- / On"'],
    ['eauto', 'Mein E-Auto lädt', 'Mein E-', '"E- / Auto"'],
    // MF-R4-2: the real names of the r5 capture that keep their finding (1 or 2 letters on one side of the break, in the token).
    ['email', 'Schreib uns eine E-Mail-Adresse', 'Schreib uns eine E-', '"E- / Mail-Adresse"'],
    ['ip', 'Gespeicherte IP-Adressen', 'Gespeicherte IP-', '"IP- / Adressen"'],
    ['qr', 'Dein neuer QR-Sticker', 'Dein neuer QR-', '"QR- / Sticker"'],
    ['rb', 'Bei einem echten RB-Spezialisten', 'Bei einem echten RB-', '"RB- / Spezialisten"'],
  ] as const) {
    test(`${split} at a line end is Medium`, async ({ page }) => {
      const report = await audit(page, page_(cell(id, text, await widthFor(page, line))));
      expect(await breaksAfter(page, id, line)).toBe(true);
      const found = of(report, 'name-hyphen-break');
      expect(found.map((v) => v.element)).toEqual([expect.stringContaining(`[${id}]`)]);
      expect(found[0]?.severity).toBe('Medium');
      expect(found[0]?.message).toContain(split);
      // The break is at a real hyphen between two words of letters: no mid-word finding on top.
      expect(of(report, 'mid-word-wrap')).toEqual([]);
    });
  }

  test('"Rhein- / Main" (5 and 4) is fine, and so is a name joined with a word joiner or U+2011', async ({ page }) => {
    const report = await audit(
      page,
      page_(
        `${cell('rm', 'Treffen Rhein-Main-Gebiet', await widthFor(page, 'Treffen Rhein-'))}` +
          `${cell('wj', 'Nissan Skyline GT-⁠R R34', await widthFor(page, 'Nissan Skyline GT-'))}` +
          `${cell('nb', 'Nissan Skyline GT‑R R34', await widthFor(page, 'Nissan Skyline GT-'))}`,
      ),
    );
    expect(of(report, 'name-hyphen-break')).toEqual([]);
    expect(of(report, 'mid-word-wrap')).toEqual([]);
  });

  // MF-R4-2: what the break leaves is counted within the token (letters and digits from its start to the hyphen, and from the hyphen
  // to its end), not only the run next to the hyphen. These false findings of the r5 capture are fine: each side keeps 3 or more.
  for (const [id, text, line, split] of [
    ['privacy', 'Schreib an die Datenschutz-E-⁠Mail.', 'Schreib an die Datenschutz-', 'Datenschutz- / E-⁠Mail'],
    ['gtss', 'Mit GT-SS-Ladern', 'Mit GT-SS-', 'GT-SS- / Ladern'],
    ['contact', 'Die DSA-Kontakt-E-⁠Mail.', 'Die DSA-Kontakt-', 'DSA-Kontakt- / E-⁠Mail'],
    ['export', 'Per Export-E-⁠Mail', 'Per Export-', 'Export- / E-⁠Mail'],
    ['report', 'Über die Melde-E-⁠Mail.', 'Über die Melde-', 'Melde- / E-⁠Mail'],
    ['slug', 'nissan-skyline-gt-r-r34-5tf974vj', 'nissan-skyline-gt-r-', 'nissan-skyline-gt-r- / r34-5tf974vj'],
  ] as const) {
    test(`"${split}" leaves 3 or more of the token on each side: no finding`, async ({ page }) => {
      const report = await audit(page, page_(cell(id, text, await widthFor(page, line))));
      // The case is real only when the layout broke exactly there.
      expect(await breaksAfter(page, id, line)).toBe(true);
      expect(of(report, 'name-hyphen-break')).toEqual([]);
      expect(of(report, 'mid-word-wrap')).toEqual([]);
    });
  }

  test('the token is counted, not the run beside the hyphen: "GT- / SS-Ladern" leaves 2 before the break, a finding', async ({ page }) => {
    const report = await audit(page, page_(cell('gtss', 'Laden mit GT-SS-Ladern', await widthFor(page, 'Laden mit GT-'))));
    expect(await breaksAfter(page, 'gtss', 'Laden mit GT-')).toBe(true);
    expect(of(report, 'name-hyphen-break').map((v) => v.message)).toEqual([expect.stringContaining('"GT- / SS-Ladern" breaks "GT-SS-Ladern"')]);
  });
});

test.describe('DOM audit self-test: lost truncation (DQ-922)', () => {
  // React Native Web 0.21 Text: the base text style, then textOneLine (numberOfLines={1}) or textMultiLine + line clamp (N > 1).
  const rnBase = "display:inline;white-space:pre-wrap;word-wrap:break-word;margin:0;padding:0;font:400 15px/22px Inter";
  const oneLine = 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-wrap:normal';
  const multiLine = (n: number) => `display:-webkit-box;max-width:100%;overflow:clip;text-overflow:ellipsis;-webkit-box-orient:vertical;-webkit-line-clamp:${n}`;
  const preview = 'Bist du am Samstag beim Treffen in Mönchengladbach dabei? Ich bringe den R34 mit.';
  /** An inbox row: an RN Web View (flex) with the preview Text as its flex item. */
  const row = (id: string, style: string) =>
    `<div style="display:flex;flex-direction:column;width:240px"><div data-testid="${id}" dir="auto" aria-label="${preview}" style="${rnBase};${style}">${preview}</div></div>`;

  test('numberOfLines={1} with the text-wrap: pretty shorthand after it renders several lines: High', async ({ page }) => {
    const report = await audit(page, page_(row('lost', `${oneLine};text-wrap:pretty`)));
    const found = of(report, 'lost-truncation');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[lost]')]);
    expect(found[0]?.severity).toBe('High');
    expect(found[0]?.message).toContain('asks for 1 line (text-overflow: ellipsis)');
  });

  test('numberOfLines={1} with the longhand text-wrap-style: pretty keeps one line: no finding', async ({ page }) => {
    const report = await audit(page, page_(row('kept', `${oneLine};text-wrap-style:pretty`)));
    expect(of(report, 'lost-truncation')).toEqual([]);
    expect(await page.locator('[data-testid="kept"]').evaluate((el) => el.getBoundingClientRect().height)).toBe(22);
  });

  test('numberOfLines={2}: the clamp shows 2 lines (no finding); without display -webkit-box it is lost (finding)', async ({ page }) => {
    const report = await audit(page, page_(`${row('clamp', multiLine(2))}${row('noBox', `${multiLine(2)};display:block`)}`));
    expect(of(report, 'lost-truncation').map((v) => v.element)).toEqual([expect.stringContaining('[noBox]')]);
    expect(of(report, 'lost-truncation')[0]?.message).toContain('asks for 2 line(s) (-webkit-line-clamp 2, display block)');
  });

  test('wrapping text that asks for no truncation, and a mirror that loses it, are not this check', async ({ page }) => {
    const report = await audit(
      page,
      page_(`${row('plain', '')}<div aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none">${row('mirror', `${oneLine};text-wrap:pretty`)}</div>`),
    );
    expect(of(report, 'lost-truncation')).toEqual([]);
  });
});

// React Native Web's View: every one is `position: relative; z-index: 0` (react-native-web View styles.view), so each is a stacking
// context, and an absolutely positioned child paints after the in-flow children of its parent whatever their order.
const RNW_VIEW = `.v { display: flex; flex-direction: column; position: relative; z-index: 0; box-sizing: border-box; flex-shrink: 0;
  min-width: 0; min-height: 0; }`;
const GLYPH = '<svg data-testid="glyph" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M168 48 88 128l80 80"/></svg>';

test.describe('DOM audit self-test: covered glyph (DQ-901)', () => {
  /** FloatingControl as M4.1 shipped it on the web: Pressable > visual > [absoluteFill ChromeSurface, Icon]. */
  const control = (inner: string, theme = 'carbon') =>
    page_(
      `<div class="v" role="button" tabindex="0" aria-label="Zurück" data-testid="fc" style="width:44px;height:44px;align-items:center;justify-content:center">
        <div class="v" data-testid="fc.visual" style="width:44px;height:44px;border-radius:9999px;align-items:center;justify-content:center">${inner}</div>
      </div>`,
      RNW_VIEW,
      theme,
    );
  const surface = (extra = '', theme = 'carbon') =>
    `<div class="v" data-testid="fc.surface" style="position:absolute;inset:0;border-radius:9999px;background:${color('chrome.translucent', theme)};${extra}"></div>`;

  test('an absoluteFill surface drawn before the in-flow icon paints over it: High, in every theme', async ({ page }) => {
    for (const theme of ['carbon', 'light']) {
      const report = await audit(page, control(`${surface('', theme)}${GLYPH}`, theme), { theme });
      const found = of(report, 'covered-glyph');
      expect(found.map((v) => v.element), theme).toEqual([expect.stringContaining('[glyph]')]);
      expect(found[0]?.severity).toBe('High');
      expect(found[0]?.message).toContain('[fc.surface]');
    }
  });

  test('the cover is found by paint order, not by hit testing: pointer-events none, a backdrop blur, and a surface after the icon', async ({ page }) => {
    const cases = {
      'pointer-events none (elementFromPoint skips it)': `${surface('pointer-events:none')}${GLYPH}`,
      'a backdrop blur over a light fill': `<div class="v" data-testid="fc.surface" style="position:absolute;inset:0;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)"></div>${GLYPH}`,
      'the surface after the icon in the DOM': `${GLYPH}${surface()}`,
      'the icon in a plain block before a positioned surface': `<div>${GLYPH}</div>${surface()}`,
    };
    for (const [name, inner] of Object.entries(cases)) {
      const report = await audit(page, control(inner));
      expect(of(report, 'covered-glyph').map((v) => v.element), name).toEqual([expect.stringContaining('[glyph]')]);
    }
  });

  test('the fixed shapes paint the icon last: no finding', async ({ page }) => {
    const cases = {
      'icon wrapped in a positioned zIndex 1 View': `${surface()}<div class="v" style="z-index:1">${GLYPH}</div>`,
      'icon wrapped in a plain RN Web View after the surface (DOM order among z 0 layers)': `${surface()}<div class="v">${GLYPH}</div>`,
      'icon nested inside the surface (ChromeSurface as the wrapper, like chromePill)': `<div class="v" data-testid="fc.surface" style="width:44px;height:44px;border-radius:9999px;align-items:center;justify-content:center;background:${color('chrome.translucent')};backdrop-filter:blur(20px)">${GLYPH}</div>`,
      'a surface with a negative z-index stays under the in-flow icon': `${surface('z-index:-1')}${GLYPH}`,
    };
    for (const [name, inner] of Object.entries(cases)) {
      const report = await audit(page, control(inner));
      expect(of(report, 'covered-glyph'), name).toEqual([]);
    }
  });

  test('a pressed-tone layer (alpha 0.06-0.08) over the icon, or an opaque layer at opacity 0, is no cover', async ({ page }) => {
    for (const tone of ['state.pressed', 'state.pressedInverse']) {
      const pressed = await audit(page, control(`<div class="v">${GLYPH}</div><div class="v" style="position:absolute;inset:0;background:${color(tone)}"></div>`));
      expect(of(pressed, 'covered-glyph'), tone).toEqual([]);
    }
    const resting = await audit(page, control(`${GLYPH}<div class="v" style="position:absolute;inset:0;opacity:0;background:${color('chrome.opaque')}"></div>`));
    expect(of(resting, 'covered-glyph')).toEqual([]);
  });

  test('a layer covering less than half of the icon, or an icon outside any control, is not this check', async ({ page }) => {
    const corner = await audit(page, control(`<div class="v" style="position:absolute;left:0;top:0;width:16px;height:16px;background:${color('chrome.opaque')}"></div>${GLYPH}`));
    expect(of(corner, 'covered-glyph')).toEqual([]);
    const loose = await audit(page, page_(`<div class="v" style="width:44px;height:44px">${surface()}${GLYPH}</div>`, RNW_VIEW));
    expect(of(loose, 'covered-glyph')).toEqual([]);
  });
});

test.describe('DOM audit self-test: clipped field (DQ-902)', () => {
  const BIO =
    'Seit 2014 schraube ich an meinem R34. Am liebsten fahre ich auf der Nordschleife und zu Treffen im Ruhrgebiet, alles selbst gemacht, vom Fahrwerk bis zur Abstimmung.';
  /** TextInput multiline on the web: a hidden mirror sizes the box, the textarea (rows 1) covers it, both capped at maxRows x line. */
  const field = (mirror: { size: number; line: number }, maxRows = 6, text = BIO) =>
    page_(
      `<div class="v" style="width:300px;padding:12px 16px;background:${color('bg.raised')}">
        <div class="v">
          <div class="v" aria-hidden="true" style="opacity:0;overflow:hidden;pointer-events:none;max-height:${24 * maxRows}px">
            <div style="font:400 ${mirror.size}px/${mirror.line}px Inter;white-space:pre-wrap;overflow-wrap:break-word">${text}&#8203;</div>
          </div>
          <textarea rows="1" data-testid="bio" aria-label="Über dich" style="position:absolute;inset:0;margin:0;padding:0;border:0;resize:none;
            font:400 16px/24px Inter;white-space:pre-wrap;overflow-wrap:break-word;max-height:${24 * maxRows}px;background:transparent;color:inherit">${text}</textarea>
        </div>
      </div>`,
      RNW_VIEW,
    );

  test('a 16/24 field sized from a 15/22 mirror cuts the text: High', async ({ page }) => {
    const report = await audit(page, field({ size: 15, line: 22 }));
    const found = of(report, 'clipped-field');
    expect(found.map((v) => v.element)).toEqual([expect.stringContaining('[bio]')]);
    expect(found[0]?.severity).toBe('High');
    expect(found[0]?.message).toContain('max-height 144px');
  });

  test('a contenteditable textbox that scrolls below its max-height is the same finding', async ({ page }) => {
    const report = await audit(
      page,
      page_(`<div contenteditable="true" role="textbox" aria-multiline="true" aria-label="Notiz" data-testid="note"
        style="width:200px;height:48px;max-height:144px;overflow:auto;font:400 16px/24px Inter">${BIO}</div>`),
    );
    expect(of(report, 'clipped-field').map((v) => v.element)).toEqual([expect.stringContaining('[note]')]);
  });

  test('a mirror in the field\'s own pair, and a field at its max rows that scrolls by design, are fine', async ({ page }) => {
    const matching = await audit(page, field({ size: 16, line: 24 }));
    expect(of(matching, 'clipped-field')).toEqual([]);
    const full = await audit(page, field({ size: 16, line: 24 }, 3, `${BIO} ${BIO} ${BIO}`));
    expect(await page.getByTestId('bio').evaluate((el) => el.scrollHeight > el.clientHeight + 1), 'the fixture scrolls').toBe(true);
    expect(of(full, 'clipped-field')).toEqual([]);
    const rows = await audit(page, page_(`<textarea rows="2" aria-label="Kurz" style="width:200px;margin:0;padding:0;border:0;font:400 16px/24px Inter;resize:none">${BIO}</textarea>`));
    expect(of(rows, 'clipped-field'), 'a textarea at its rows without max-height').toEqual([]);
  });
});

test.describe('DOM audit self-test: display.title lines (DQ-904, ADR-426 a)', () => {
  const t = tokens.typography['display.title'] as { size: number; lineHeight: number; minSize: number; minLineHeight: number; maxLines: number; web: { size: number; lineHeight: number } };
  const title = (size: number, line: number, width: number, text = 'Nissan Skyline GT-R R34', attrs = '') =>
    `<div data-testid="title" ${attrs} style="font:600 ${size}px/${line}px 'Archivo SemiExpanded';width:${width}px">${text}</div>`;

  test('a full-size title over its 2 lines is Medium: 30/34 on a phone, 44/48 on the desktop, scaled at 200 %', async ({ page }) => {
    expect(t.maxLines).toBe(2);
    const cases: { name: string; viewport: number; scale: number; size: number; line: number }[] = [
      { name: 'phone 30/34', viewport: 390, scale: 1, size: t.size, line: t.lineHeight },
      { name: 'phone fs2 60/68', viewport: 390, scale: 2, size: t.size * 2, line: t.lineHeight * 2 },
      { name: 'desktop 44/48', viewport: 1440, scale: 1, size: t.web.size, line: t.web.lineHeight },
      { name: 'desktop card 30/34', viewport: 1440, scale: 1, size: t.size, line: t.lineHeight },
    ];
    for (const c of cases) {
      await page.setViewportSize({ width: c.viewport, height: 900 });
      const report = await audit(page, page_(title(c.size, c.line, c.size * 4)), { fontScale: c.scale });
      const found = of(report, 'display-title-lines');
      expect(found.map((v) => v.element), c.name).toEqual([expect.stringContaining('[title]')]);
      expect(found[0]?.severity).toBe('Medium');
      expect(found[0]?.message).toMatch(/renders on [3-9] lines/);
    }
  });

  test('two lines at full size, any lines at the shrink pair, a nested span, a mirror: no finding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const two = await audit(page, page_(title(t.size, t.lineHeight, 360, 'Skyline GT-R')));
    expect(of(two, 'display-title-lines')).toEqual([]);
    const shrunk = await audit(page, page_(title(t.minSize, t.minLineHeight, t.minSize * 4)));
    expect(await page.getByTestId('title').evaluate((el, line) => el.getBoundingClientRect().height / line, t.minLineHeight), 'the shrunk fixture wraps').toBeGreaterThan(2);
    expect(of(shrunk, 'display-title-lines')).toEqual([]);
    // One title, reported once: the spans of a nested Text are part of its lines.
    const nested = await audit(page, page_(title(t.size, t.lineHeight, t.size * 4, 'Nissan <span>Skyline</span> <span>GT-R R34</span>')));
    expect(of(nested, 'display-title-lines')).toHaveLength(1);
    // A measurement mirror (aria-hidden, absolutely positioned) is not the title on screen.
    const mirror = await audit(page, page_(title(t.size, t.lineHeight, t.size * 4, 'Nissan Skyline GT-R R34', 'aria-hidden="true"').replace('style="font', 'style="position:absolute;font')));
    expect(of(mirror, 'display-title-lines')).toEqual([]);
    // Another face at the same pair is not the role.
    const other = await audit(page, page_(title(t.size, t.lineHeight, t.size * 4).replace("'Archivo SemiExpanded'", 'Inter')));
    expect(of(other, 'display-title-lines')).toEqual([]);
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

  test('web.tab and the hero numerals stay capped at maxFontScale, on desktop too', async ({ page }) => {
    const roles: [string, string][] = [['web.tab', 'Inter'], ['hero.numeral', "'Archivo Condensed'"], ['hero.numeral.s', "'Archivo Condensed'"]];
    for (const [name, family] of roles) {
      const t = tokens.typography[name] as { size: number; lineHeight: number; maxFontScale: number; web?: { size: number; lineHeight: number } };
      // The mobile pair on a phone, the desktop pair where the page applies it (layout.breakpoints.desktop and wider).
      for (const [pair, width] of [[t, 390], ...(t.web ? [[t.web, DESKTOP]] : [])] as [{ size: number; lineHeight: number }, number][]) {
        await page.setViewportSize({ width, height: 844 });
        const ok = await audit(page, page_(`<div style="font:600 ${pair.size * t.maxFontScale}px/${pair.lineHeight * t.maxFontScale}px ${family}">510</div>`), {
          fontScale: 2,
        });
        expect(of(ok, 'non-scale-font'), `${name} ${pair.size} at ${width}`).toHaveLength(0);
        const uncapped = await audit(page, page_(`<div style="font:600 ${pair.size * 2}px/${pair.lineHeight * 2}px ${family}">510</div>`), {
          fontScale: 2,
        });
        expect(of(uncapped, 'non-scale-font'), `${name} ${pair.size} uncapped at ${width}`).toHaveLength(1);
      }
    }
  });

  test('a desktop pair of a 2.0 role is on the scale (09 §4.2) at the desktop width, in its token face', async ({ page }) => {
    const hero = tokens.typography['hero.numeral'].web;
    const title = tokens.typography['display.title'].web;
    const desktopPairs = `<div style="font:600 ${hero.size}px/${hero.lineHeight}px 'Archivo Condensed'">510</div>
        <div style="font:600 ${title.size}px/${title.lineHeight}px 'Archivo SemiExpanded'">GT-R</div>`;
    await page.setViewportSize({ width: DESKTOP, height: 900 });
    const report = await audit(page, page_(desktopPairs));
    expect(of(report, 'non-scale-font')).toEqual([]);
    // Only the first face of a token stack counts: the numeral stack's fallback, set first, is no token font.
    const fallback = await audit(page, page_(`<div style="font:600 ${hero.size}px/${hero.lineHeight}px 'Arial Narrow'">510</div>`));
    expect(of(fallback, 'non-scale-font').map((v) => v.message)).toEqual([expect.stringContaining('Arial Narrow')]);
  });

  test('display.title\'s shrink pair (09 §4.2, 24/28) is on the scale at every width, scaled at font scale 2', async ({ page }) => {
    const t = tokens.typography['display.title'] as { size: number; lineHeight: number; minSize: number };
    const shrunk = { size: t.minSize, lineHeight: t.minSize + t.lineHeight - t.size };
    expect(shrunk).toEqual({ size: 24, lineHeight: 28 });
    const title = (scale: number, line = shrunk.lineHeight) =>
      `<div data-testid="title" style="font:600 ${shrunk.size * scale}px/${line * scale}px 'Archivo SemiExpanded'">Skyline GT-R R34</div>`;
    for (const width of [390, DESKTOP, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scale of [1, 2]) {
        const ok = await audit(page, page_(title(scale)), { fontScale: scale });
        expect(of(ok, 'non-scale-font'), `${width} fs${scale}`).toEqual([]);
        // The shrunk size with any other leading, or the shrunk pair at the other scale, is still off the scale.
        const leading = await audit(page, page_(title(scale, t.lineHeight)), { fontScale: scale });
        expect(of(leading, 'non-scale-font').map((v) => v.element), `${width} fs${scale} 24/34`).toEqual([expect.stringContaining('[title]')]);
        const other = await audit(page, page_(title(3 - scale)), { fontScale: scale });
        expect(of(other, 'non-scale-font').map((v) => v.element), `${width} fs${scale} unscaled`).toEqual([expect.stringContaining('[title]')]);
      }
    }
  });

  test('below the desktop width a desktop pair is off the scale: hero.numeral 88/88 fails at 360 and at 1279', async ({ page }) => {
    const hero = tokens.typography['hero.numeral'].web;
    const title = tokens.typography['display.title'].web;
    for (const width of [360, DESKTOP - 1]) {
      await page.setViewportSize({ width, height: 800 });
      const report = await audit(
        page,
        page_(`<div data-testid="hero" style="font:600 ${hero.size}px/${hero.lineHeight}px 'Archivo Condensed'">510</div>
          <div data-testid="title" style="font:600 ${title.size}px/${title.lineHeight}px 'Archivo SemiExpanded'">GT-R</div>`),
      );
      expect(of(report, 'non-scale-font').map((v) => v.element), `at ${width}`).toEqual([expect.stringContaining('[hero]'), expect.stringContaining('[title]')]);
    }
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
          <div style="font:600 28px/32px 'Inter Display';letter-spacing:-0.28px">Garage</div>
          <div style="font:400 14px/20px Inter;color:${color('text.secondary')}">Sekundär</div>
          <div style="font:600 40px/40px 'Archivo Condensed';overflow:hidden;height:40px">Skyline</div>

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
          <div data-qa-exempt="qr" style="background:${color('qr.bg')};color:${color('qr.fg')};padding:16px;font:500 12px/16px Inter">
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
