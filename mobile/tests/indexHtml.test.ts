/**
 * public/index.html paints before any bundle runs, so it cannot import tokens. This test is what
 * keeps its values equal to the tokens, and proves its script resolves themes like the app does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOKEN_SHAPE } from '@/api/preview';
import { resolveThemeName } from '@/theme/theme';
import { defaultTheme, systemMapping, themeNames, themes } from '@/theme/tokens.generated';

const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
const css = /<style id="sc-canvas">([\s\S]*?)<\/style>/.exec(html)![1]!;
const script = /<script id="sc-theme-boot">([\s\S]*?)<\/script>/.exec(html)![1]!;

function cssBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('}', start));
}

function runBoot(options: { stored?: string | null; search?: string; prefersDark?: boolean; languages?: string[] }) {
  const attrs: Record<string, string> = {};
  const metas: Record<string, string> = {};
  const documentElement = {
    lang: '',
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
  };
  const document = {
    documentElement,
    querySelector: (selector: string) => ({
      setAttribute: (_: string, value: string) => {
        metas[/name="([^"]+)"/.exec(selector)![1]!] = value;
      },
    }),
  };
  new Function('document', 'localStorage', 'location', 'navigator', 'matchMedia', script)(
    document,
    { getItem: () => options.stored ?? null },
    { search: options.search ?? '' },
    { languages: options.languages ?? ['de-DE'] },
    () => ({ matches: options.prefersDark ?? false }),
  );
  return { theme: attrs['data-theme'], lang: documentElement.lang, metas };
}

describe('colour values match the tokens', () => {
  it.each(themeNames)('%s in the stylesheet', (name) => {
    const block = cssBlock(name === defaultTheme ? 'html' : `html[data-theme='${name}']`);
    expect(block).toContain(`background-color: ${themes[name].color.bg.canvas};`);
    expect(block).toContain(`color: ${themes[name].color.text.primary};`);
    expect(block).toContain(`color-scheme: ${themes[name].colorScheme};`);
  });

  it.each(themeNames)('%s in the script', (name) => {
    const { scheme, canvas } = { scheme: themes[name].colorScheme, canvas: themes[name].color.bg.canvas };
    expect(script).toContain(`${name}: { scheme: '${scheme}', canvas: '${canvas}' }`);
  });

  it('system mapping and the static default', () => {
    expect(script).toContain(`var SYSTEM = { dark: '${systemMapping.dark}', light: '${systemMapping.light}' }`);
    expect(script).toContain(`var name = '${defaultTheme}'`);
    expect(html).toContain(`<html lang="de" data-theme="${defaultTheme}">`);
    expect(html).toContain(`<meta name="theme-color" content="${themes[defaultTheme].color.bg.canvas}" />`);
  });
});

describe('head script', () => {
  it.each([
    [null, 'carbon'],
    ['carbon', 'carbon'],
    ['black', 'black'],
    ['light', 'light'],
    ['garbage', 'carbon'],
    ['constructor', 'carbon'],
  ])('stored %s paints %s', (stored, expected) => {
    expect(runBoot({ stored }).theme).toBe(expected);
  });

  it.each([true, false])('system follows prefers-color-scheme (dark: %s) like the app', (prefersDark) => {
    const { theme, metas } = runBoot({ stored: 'system', prefersDark });
    expect(theme).toBe(resolveThemeName('system', prefersDark ? 'dark' : 'light'));
    expect(metas['color-scheme']).toBe(prefersDark ? 'dark' : 'light');
  });

  it('qaTheme wins over the stored preference', () => {
    expect(runBoot({ stored: 'black', search: '?qaTheme=light' }).theme).toBe('light');
    expect(runBoot({ stored: 'black', search: '?qaTheme=pink' }).theme).toBe('black');
  });

  describe('ADM-34 preview frame theme (DQ-613)', () => {
    const TOKEN = 'eyJzIjoxLCJlIjoxfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

    it('paints the frame theme only together with a preview token, over the stored one', () => {
      expect(runBoot({ stored: 'black', search: `?preview=${TOKEN}&previewTheme=light` }).theme).toBe('light');
      expect(runBoot({ stored: 'light', search: `?preview=${TOKEN}&previewTheme=carbon` }).theme).toBe('carbon');
      expect(runBoot({ stored: 'black', search: '?previewTheme=light' }).theme).toBe('black');
      expect(runBoot({ stored: 'black', search: '?preview=nope&previewTheme=light' }).theme).toBe('black');
      expect(runBoot({ stored: 'black', search: `?preview=${TOKEN}&previewTheme=system` }).theme).toBe('black');
      expect(runBoot({ stored: 'black', search: `?preview=${TOKEN}&previewTheme=light&previewTheme=carbon` }).theme).toBe('black');
    });

    it('lets qaTheme win, and checks the token shape the app checks', () => {
      expect(runBoot({ search: `?qaTheme=black&preview=${TOKEN}&previewTheme=light` }).theme).toBe('black');
      expect(script).toContain(TOKEN_SHAPE.toString());
    });
  });

  it('sets the meta tags for the resolved theme', () => {
    const { metas } = runBoot({ stored: 'light' });
    expect(metas).toEqual({ 'color-scheme': 'light', 'theme-color': themes.light.color.bg.canvas });
  });

  it('sets lang from the browser, like the i18n detection', () => {
    expect(runBoot({ languages: ['en-US'] }).lang).toBe('en');
    expect(runBoot({ languages: ['de-AT'] }).lang).toBe('de');
    expect(runBoot({ languages: ['fr-FR'] }).lang).toBe('de');
    expect(runBoot({ search: '?qaLocale=en' }).lang).toBe('en');
  });
});

describe('document', () => {
  it('reaches into the notch and has no body margin', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toMatch(/body \{\s*margin: 0;/);
    expect(css).toContain('overflow-x: hidden');
  });
});
