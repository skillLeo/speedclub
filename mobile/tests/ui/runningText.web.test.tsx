/**
 * DQ-908, DQ-922, DQ-925, DQ-932: how text wraps on the member web.
 * - Running text wraps "pretty" through the longhand `text-wrap-style` only, so react-native-web's `white-space: nowrap` of
 *   `numberOfLines={1}` keeps its `text-wrap-mode` (the shorthand reset it and MSG-01 previews ran 2–4 lines).
 * - No `hyphenate-limit-lines`: WebKit broke a long compound without a hyphen once its one hyphenated line was used up.
 * - Titles balance their lines and hyphenate only a word that may not fit a line of its own.
 * react-native-web must hand all of it to the browser as inline CSS.
 */
import { createElement, type ReactElement } from 'react';

import { layout, typography } from '@/theme';
import { RUNNING_TEXT_ROLES, TITLE_COLUMNS, TITLE_ROLES, titleHyphenation, typeStyle } from '@/ui/Text';

import { interFace, lineCount } from './interMetrics';

type Css = Record<string, unknown>;
type WebText = (props: { style: unknown; numberOfLines?: number; children?: string }) => ReactElement;

// react-native-web's own Text, as the member web renders it (not the React Native renderer Jest uses elsewhere).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require('react-native-web/dist/cjs/exports/Text') as WebText | { default: WebText };
const WebTextComponent = 'default' in web ? web.default : web;
// The app ships no react-dom types; its server renderer is all this test needs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: (element: ReactElement) => string };

const html = (style: unknown, text: string, numberOfLines?: number) =>
  renderToStaticMarkup(createElement(WebTextComponent, { style, ...(numberOfLines === undefined ? {} : { numberOfLines }) }, text));

describe('running text on web (DQ-908, DQ-925)', () => {
  it.each([...RUNNING_TEXT_ROLES])('%s wraps pretty through the longhand and sets no hyphenate-limit-lines', (role) => {
    const style = typeStyle(role, 1, 'web', true) as Css;
    expect(style.textWrapStyle).toBe('pretty');
    expect(style.textWrap).toBeUndefined();
    expect(style.WebkitHyphenateLimitLines).toBeUndefined();
    expect(style.hyphenateLimitLines).toBeUndefined();
    // DQ-181 stays: 10 letters, 4 on each side.
    expect(style.hyphens).toBe('auto');
    expect(style.hyphenateLimitChars).toBe('10 4 4');
  });

  it('leaves whole text, display titles and native alone', () => {
    expect((typeStyle('body', 1, 'web', false) as Css).textWrapStyle).toBeUndefined();
    expect((typeStyle('displayTitle', 1, 'web', true) as Css).textWrapStyle).toBeUndefined();
    expect((typeStyle('body', 1, 'ios', true) as Css).textWrapStyle).toBeUndefined();
    expect((typeStyle('body', 1, 'android', true) as Css).hyphens).toBeUndefined();
  });

  it('reaches the DOM through react-native-web as inline CSS', () => {
    const markup = html(typeStyle('body', 1, 'web', true), 'Unbedenklichkeitsbescheinigung');
    expect(markup).toContain('text-wrap-style:pretty');
    expect(markup).not.toMatch(/text-wrap:|hyphenate-limit-lines/);
    expect(markup).toContain('hyphens:auto');
  });
});

describe('a truncated text keeps one line (DQ-922)', () => {
  it('gets no wrap style of its own, and the cache tells it apart', () => {
    const wrapping = typeStyle('callout', 1, 'web', true) as Css;
    const truncated = typeStyle('callout', 1, 'web', true, false, true) as Css;
    expect(wrapping.textWrapStyle).toBe('pretty');
    expect(truncated.textWrapStyle).toBeUndefined();
    expect((typeStyle('headline', 1, 'web', true, false, true) as Css).textWrapStyle).toBeUndefined();
    // Hyphenation is the role's either way.
    expect(truncated.hyphens).toBe('auto');
  });

  it('a callout with numberOfLines={1} resolves to white-space nowrap and nothing resets text-wrap-mode', () => {
    const markup = html(typeStyle('callout', 1, 'web', true, false, true), 'Lukas: Hast du die Felgen schon montiert? Ich hätte noch Distanzscheiben.', 1);
    // react-native-web's single-line class: white-space nowrap, ellipsis.
    expect(markup).toMatch(/class="[^"]*r-whiteSpace-/);
    expect(markup).toMatch(/class="[^"]*r-textOverflow-/);
    // No inline shorthand that would turn wrapping back on.
    expect(markup).not.toMatch(/text-wrap:/);
    expect(markup).not.toMatch(/text-wrap-mode|white-space:normal/);
  });
});

describe('titles on web (DQ-932)', () => {
  it.each([...TITLE_ROLES])('%s balances its lines', (role) => {
    expect((typeStyle(role, 1, 'web', true) as Css).textWrapStyle).toBe('balance');
    expect((typeStyle(role, 1, 'web', false) as Css).textWrapStyle).toBe('balance');
    expect((typeStyle(role, 1, 'ios', true) as Css).textWrapStyle).toBeUndefined();
  });

  it('hyphenates only a word that may not fit the narrowest column of its role at the drawn size', () => {
    const sample = 'Unbedenklichkeitsbescheinigungsverfahren';
    expect(Object.keys(TITLE_COLUMNS).sort()).toEqual([...TITLE_ROLES].sort());
    // A page title spans the 360 column; a sheet title and a card title sit in narrower ones.
    expect(TITLE_COLUMNS.title1).toBe(360 - 2 * layout.gutter.phone);
    expect(TITLE_COLUMNS.title2).toBeLessThan(TITLE_COLUMNS.title1);
    expect(TITLE_COLUMNS.headline).toBeLessThan(TITLE_COLUMNS.title2);
    for (const role of TITLE_ROLES) {
      const narrowest = TITLE_COLUMNS[role as keyof typeof TITLE_COLUMNS];
      const { fontFamily, fontSize } = typography[role] as { fontFamily: string; fontSize: number };
      const face = interFace(fontFamily);
      for (const scale of [1, 1.3, 1.5, 2]) {
        const size = fontSize * scale;
        const style = typeStyle(role, scale, 'web', true) as Css;
        const [word, before, after] = String(style.hyphenateLimitChars).split(' ').map(Number) as [number, number, number];
        expect(style.hyphens).toBe('auto');
        // WebKit's two halves ask the same length (at the DQ-181 floor: 10 letters, 4 on each side).
        expect(word > 10 ? before + after : 10).toBe(word);
        expect(style.WebkitHyphenateLimitBefore).toBe(String(before));
        expect(style.WebkitHyphenateLimitAfter).toBe(String(after));
        // Never below DQ-181.
        expect(word).toBeGreaterThanOrEqual(10);
        // Above the DQ-181 floor every shorter word fits the narrowest column whole, so it never needs to split; at the floor
        // (a large font in a narrow card) the role hyphenates as running text does, never less.
        if (word > 10) expect(face.width(sample.slice(0, word - 1), size)).toBeLessThanOrEqual(narrowest);
        else expect(style.hyphenateLimitChars).toBe('10 4 4');
      }
    }
  });

  it('keeps "eingeschränkt" whole in "Wir haben dein Konto eingeschränkt" at 375 and 393, and lets it split only at 200 %', () => {
    const { fontFamily, fontSize } = typography.title1 as { fontFamily: string; fontSize: number };
    const face = interFace(fontFamily);
    const title = 'Wir haben dein Konto eingeschränkt';
    const word = 'eingeschränkt';
    for (const screenWidth of [375, 393]) {
      const column = screenWidth - 2 * layout.gutter.phone;
      // The word fits a line of its own, so the title wraps whole in two lines …
      expect(face.width(word, fontSize)).toBeLessThan(column);
      expect(lineCount(title, face, fontSize, column)).toBe(2);
    }
    // … and the threshold forbids the browser to split it there.
    expect(word.length).toBeLessThan(Number(String(titleHyphenation(fontSize, TITLE_COLUMNS.title1).hyphenateLimitChars).split(' ')[0]));
    // At 200 % the word is wider than a 393 line: it may hyphenate (DQ-181 rule), never break without a hyphen.
    expect(face.width(word, fontSize * 2)).toBeGreaterThan(393 - 2 * layout.gutter.phone);
    expect(word.length).toBeGreaterThanOrEqual(Number(String(titleHyphenation(fontSize * 2, TITLE_COLUMNS.title1).hyphenateLimitChars).split(' ')[0]));
  });

  it('reaches the DOM as the longhand and the limits', () => {
    const markup = html(typeStyle('title1', 1, 'web', true), 'Wir haben dein Konto eingeschränkt');
    expect(markup).toContain('text-wrap-style:balance');
    expect(markup).toMatch(/hyphenate-limit-chars:\d+ \d+ \d+/);
    expect(markup).toMatch(/-webkit-hyphenate-limit-before:\d+/);
    expect(markup).not.toMatch(/text-wrap:/);
  });
});
