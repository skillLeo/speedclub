// A12 (M4.1 fix round 8): "Meldunge / n" in the desktop settings pane at 200 %. The pane grows until every label's longest word
// fits its text column at the size it is drawn; proven here with the advance widths of the shipped Inter faces.
import de from '@/i18n/locales/de/settings.json';
import en from '@/i18n/locales/en/settings.json';
import {
  drawnSize,
  paneChrome,
  paneWords,
  settingsPaneLabels,
  settingsPaneWidth,
  type PaneLabel,
} from '@/features/settings/paneWidth';
import { layout, size, typography, type TypeVariant } from '@/theme';

import { interFace } from '../ui/interMetrics';

type Dict = { [key: string]: string | Dict };

/** i18next's lookup and {{interpolation}} over the namespace file, enough for the pane's labels. */
function translator(dict: Dict) {
  return (key: string, options: Record<string, string> = {}): string => {
    const value = key.split('.').reduce<string | Dict | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);
    if (typeof value !== 'string') throw new Error(`missing settings key ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => options[name] ?? '');
  };
}

const LOCALES = { de: translator(de as Dict), en: translator(en as Dict) } as const;
const VERSION = { version: '1.0.0', build: '13' };
const BORDER = size.border.control;

/** The real one-line width of a word in the face and tracking of its role. */
function realWidth(word: string, variant: TypeVariant, fontSize: number): number {
  const role = typography[variant] as { fontFamily: string; fontSize: number; letterSpacing?: number };
  const tracking = ((role.letterSpacing ?? 0) / role.fontSize) * fontSize;
  return interFace(role.fontFamily).width(word, fontSize) + tracking * [...word].length;
}

function fits(labels: readonly PaneLabel[], pane: number, fontScale: number, desktop: boolean): string[] {
  const misses: string[] = [];
  for (const { text, variant, place } of labels) {
    const fontSize = drawnSize(variant, fontScale, desktop);
    const column = pane - BORDER - paneChrome(place);
    for (const word of paneWords(text)) {
      const width = realWidth(word, variant, fontSize);
      if (width > column) misses.push(`"${word}" ${width.toFixed(1)} > ${column}`);
    }
  }
  return misses;
}

describe('settings pane width (A12)', () => {
  it('splits a label where a line can break: white space and after a hard hyphen, never at a no-break space', () => {
    expect(paneWords('Meldungen & Entscheidungen')).toEqual(['Meldungen', '&', 'Entscheidungen']);
    expect(paneWords('Zwei-Faktor-Schutz')).toEqual(['Zwei-', 'Faktor-', 'Schutz']);
    expect(paneWords('Schwarz (OLED)')).toEqual(['Schwarz (OLED)']);
    expect(paneWords('QR-⁠Code')).toEqual(['QR-⁠Code']);
  });

  it('keeps the 280 pane at font scale 1 in both locales (FS-12)', () => {
    for (const t of Object.values(LOCALES)) {
      for (const member of [true, false]) {
        expect(settingsPaneWidth(settingsPaneLabels(t, member, VERSION), 1, true)).toBe(layout.settingsPane);
      }
    }
  });

  it('gives "Meldungen" its full width at desktop 200 %, where the 280 pane left it 155 of 170', () => {
    const t = LOCALES.de;
    const pane = settingsPaneWidth(settingsPaneLabels(t, true, VERSION), 2, true);
    const column = pane - BORDER - paneChrome('row');
    expect(layout.settingsPane - BORDER - paneChrome('row')).toBe(155);
    expect(realWidth('Meldungen', 'body', drawnSize('body', 2, true))).toBeGreaterThan(155);
    expect(column).toBeGreaterThanOrEqual(realWidth('Meldungen', 'body', drawnSize('body', 2, true)));
  });

  // desktop1280 and desktop1440 share the pane (it does not depend on the window), so one check covers both widths.
  it.each([
    ['de', 1],
    ['de', 1.5],
    ['de', 2],
    ['en', 1],
    ['en', 1.5],
    ['en', 2],
  ] as const)('fits every word of every %s label in its column at font scale %s, member and guest', (locale, fontScale) => {
    for (const member of [true, false]) {
      const labels = settingsPaneLabels(LOCALES[locale], member, VERSION);
      for (const desktop of [true, false]) {
        const pane = settingsPaneWidth(labels, fontScale, desktop);
        expect(fits(labels, pane, fontScale, desktop)).toEqual([]);
      }
    }
  });

  it('never truncates or drops a label: every row, group and value of the list is measured', () => {
    const labels = settingsPaneLabels(LOCALES.de, true, VERSION).map((label) => label.text);
    for (const text of ['Einstellungen', 'Meldungen & Entscheidungen', 'Darstellung', 'Impressum, Datenschutz, AGB', 'Schwarz', 'Abmelden']) {
      expect(labels).toContain(text);
    }
    // A guest sees no member rows, so they do not widen the pane.
    expect(settingsPaneLabels(LOCALES.de, false, VERSION).map((label) => label.text)).not.toContain('Meldungen & Entscheidungen');
  });
});
