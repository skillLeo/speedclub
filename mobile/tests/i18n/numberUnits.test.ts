// DQ-1005 / DQ-1016: a number and the word after it never part at a line end ("12 / Monate", "14 / Minuten", "16 / Jahre"), and a
// long date keeps its day with the month. SKILL §9: a no-break space between number and unit. The namespaces listed here are held
// to it; the others follow as their modules are reworked (home, discover, garage, profile, vehicle: reported to the lead).
import { formatLongDate } from '@/lib/format';

import authDe from '@/i18n/locales/de/auth.json';
import authEn from '@/i18n/locales/en/auth.json';
import commonDe from '@/i18n/locales/de/common.json';
import commonEn from '@/i18n/locales/en/common.json';
import settingsDe from '@/i18n/locales/de/settings.json';
import settingsEn from '@/i18n/locales/en/settings.json';

const GUARDED = { 'de/auth': authDe, 'en/auth': authEn, 'de/settings': settingsDe, 'en/settings': settingsEn, 'de/common': commonDe, 'en/common': commonEn };

/** "{{count}} Minuten", "12 Monate": a count or a figure, then a plain space, then a word. */
const SPLIT = /(\{\{count\}\}|\b\d+) (?=[A-Za-zÄÖÜäöüß])/;

function strings(node: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) strings(value, `${path}.${key}`, out);
  return out;
}

describe('number + word stay together (DQ-1005, DQ-1016)', () => {
  it.each(Object.entries(GUARDED))('%s binds every count and figure to the word after it', (_name, json) => {
    const split = strings(json, '', []).filter(([, text]) => SPLIT.test(text)).map(([path, text]) => `${path}: ${text}`);
    expect(split).toEqual([]);
  });

  it('keeps the day of a long date with its month', () => {
    const date = new Date(2026, 10, 12, 12);
    expect(formatLongDate(date, 'de')).toBe('12. November 2026');
    expect(formatLongDate(date, 'en')).toBe('12 November 2026');
  });
});
