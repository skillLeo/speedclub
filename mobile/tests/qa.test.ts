import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripQaBlock } from '../scripts/strip-qa';

type QaModule = typeof import('@/lib/qa');
type ClockModule = typeof import('@/lib/clock');

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_APP_ENV;
const SEARCH =
  '?qaTheme=light&qaLocale=en&qaFontScale=2&qaState=empty&qaMotion=off&qaNow=2026-06-14T12:00:00Z';

/** Loads a fresh copy of the module, as an app start would, with the given URL and environment. */
function load<T extends object>(path: string, env: string | undefined, search: string): T {
  if (env === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = env;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search } },
  });
  let loaded: T | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<T>(path);
  });
  return loaded as T;
}

afterEach(() => {
  process.env.EXPO_PUBLIC_APP_ENV = ORIGINAL_ENV;
});

describe('outside production', () => {
  it('reads every override from the URL', () => {
    const { qa } = load<QaModule>('@/lib/qa', 'local', SEARCH);
    expect(qa).toEqual({
      theme: 'light',
      locale: 'en',
      fontScale: 2,
      state: 'empty',
      motion: 'off',
      now: new Date('2026-06-14T12:00:00Z'),
    });
  });

  it('ignores invalid values', () => {
    const { parseQa } = load<QaModule>('@/lib/qa', 'local', '');
    expect(
      parseQa('?qaTheme=pink&qaLocale=fr&qaFontScale=abc&qaState=nope&qaMotion=slow&qaNow=never'),
    ).toEqual({});
    expect(parseQa('?qaFontScale=0')).toEqual({});
    expect(parseQa('?qaFontScale=9')).toEqual({});
  });

  it('opens the report sheet for a capture with qaOpen=report, and nothing else (M2.8)', () => {
    const { parseQa } = load<QaModule>('@/lib/qa', 'local', '');
    expect(parseQa('?qaOpen=report').open).toBe('report');
    expect(parseQa('?qaOpen=menu')).toEqual({});
  });

  it('forces app-config flags with qaFlags, well-formed keys only (AI visual cells)', () => {
    const { parseQa } = load<QaModule>('@/lib/qa', 'local', '');
    expect(parseQa('?qaFlags=ai.nl_search,ai.translate').flags).toEqual(['ai.nl_search', 'ai.translate']);
    expect(parseQa('?qaFlags=ai.nl_search,<script>,Nope,ai').flags).toEqual(['ai.nl_search']);
    expect(parseQa('?qaFlags=')).toEqual({});
    const { qaForcesFlag } = load<QaModule>('@/lib/qa', 'local', '?qaFlags=ai.photo_tagging');
    expect(qaForcesFlag('ai.photo_tagging')).toBe(true);
    expect(qaForcesFlag('ai.translate')).toBe(false);
  });

  it('accepts system as a theme', () => {
    const { parseQa } = load<QaModule>('@/lib/qa', 'local', '');
    expect(parseQa('?qaTheme=system').theme).toBe('system');
  });

  it('keeps the values for the session after the URL changes', () => {
    const { qa } = load<QaModule>('@/lib/qa', 'local', SEARCH);
    (globalThis as unknown as { window: { location: { search: string } } }).window.location.search = '';
    expect(qa.theme).toBe('light');
  });

  it('gives feature screens the forced state, default otherwise', () => {
    expect(load<QaModule>('@/lib/qa', 'local', SEARCH).useQaState()).toBe('empty');
    expect(load<QaModule>('@/lib/qa', 'local', '').useQaState()).toBe('default');
  });

  it('freezes the clock at qaNow', () => {
    const clock = load<ClockModule>('@/lib/clock', 'local', SEARCH);
    expect(clock.now().toISOString()).toBe('2026-06-14T12:00:00.000Z');
  });
});

describe('in production', () => {
  it('reads nothing from the URL', () => {
    const { qa, parseQa, useQaState } = load<QaModule>('@/lib/qa', 'production', SEARCH);
    expect(qa).toEqual({});
    expect(parseQa(SEARCH)).toEqual({});
    expect(useQaState()).toBe('default');
  });

  it('forces no flag', () => {
    const { qaForcesFlag, parseQa } = load<QaModule>('@/lib/qa', 'production', '?qaFlags=ai.nl_search');
    expect(parseQa('?qaFlags=ai.nl_search')).toEqual({});
    expect(qaForcesFlag('ai.nl_search')).toBe(false);
  });

  it('runs the real clock', () => {
    const clock = load<ClockModule>('@/lib/clock', 'production', SEARCH);
    expect(clock.now().toISOString()).not.toBe('2026-06-14T12:00:00.000Z');
  });

  it('keeps the parser behind the expressions the bundler inlines', () => {
    const source = readFileSync(join(__dirname, '../src/lib/qa.ts'), 'utf8');
    const guards = source.match(/process\.env\.EXPO_PUBLIC_APP_ENV === 'production'/g) ?? [];
    expect(guards).toHaveLength(2);
    // Every URL parameter name must sit inside the removable branch, after the guard.
    const guard = source.indexOf("process.env.EXPO_PUBLIC_APP_ENV === 'production'");
    expect(source.indexOf("'qaTheme'")).toBeGreaterThan(guard);
    expect(source.indexOf("'qaNow'")).toBeLessThan(source.indexOf('function readOverrides'));
  });

  it('removes the QA branch from the inline head script', () => {
    const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
    expect(html).toContain('qaTheme');
    const stripped = stripQaBlock(html);
    expect(stripped).not.toContain('qaTheme');
    expect(stripped).not.toContain('qaLocale');
    expect(stripped).toContain("localStorage.getItem('sc.theme')");
  });
});
