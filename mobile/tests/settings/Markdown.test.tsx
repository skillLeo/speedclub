import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking, Platform } from 'react-native';

import { longestBoundRun, Markdown, pairsFitSideBySide } from '@/features/settings/markdown/Markdown';
import { parseMarkdown } from '@/features/settings/markdown/parse';
import { hydrateThemePreference, themes, typography } from '@/theme';

import { flat, renderUi } from '../ui/helpers';

const mockWindow = { current: { width: 390, height: 844, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));

const mockPush = jest.fn();
const mockOpenBrowser = jest.fn((_url: string) => Promise.resolve({ type: 'opened' }));

jest.mock('expo-router', () => ({
  // asChild: the child gets the navigation as its press, as the real Link does.
  Link: ({ href, children }: { href: string; children: ReactElement<{ onPress?: () => void }> }) => {
    const { cloneElement } = jest.requireActual<typeof import('react')>('react');
    return cloneElement(children, { onPress: () => mockPush(href) });
  },
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));

beforeAll(async () => {
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.de';
  await hydrateThemePreference();
});

beforeEach(() => {
  mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 1 };
  mockPush.mockClear();
  mockOpenBrowser.mockClear();
});

/** The element of a pair table that measures its width (its onLayout); layout events do not bubble. */
function tableOf(node: ReturnType<typeof screen.getByText>) {
  let current: typeof node | null = node;
  while (current && !current.props.onLayout) current = current.parent;
  if (!current) throw new Error('no table around this text');
  return current;
}

async function renderMarkdown(source: string) {
  await renderUi(<Markdown blocks={parseMarkdown(source).blocks} testID="md" />);
}

describe('Markdown renderer', () => {
  it('renders headings as headings and keeps HTML as visible text', async () => {
    await renderMarkdown('## Anbieter\n\n<script>alert(1)</script> und <b>fett</b>');
    expect(screen.getByRole('heading', { name: 'Anbieter' })).toBeTruthy();
    expect(screen.getByText('<script>alert(1)</script> und <b>fett</b>')).toBeTruthy();
  });

  it('shows placeholders as written', async () => {
    await renderMarkdown('E-Mail: [[Kontakt-E-Mail]]');
    // As written, with the word joiner every text gets after a short prefix (DQ-220).
    expect(screen.getByText('[[Kontakt-\u2060E-\u2060Mail]]')).toBeTruthy();
  });

  it('gives a script link no link at all', async () => {
    await renderMarkdown('[Gewinn abholen](javascript:alert(1))');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Gewinn abholen')).toBeTruthy();
  });

  it('opens an app path inside the app', async () => {
    await renderMarkdown('Siehe [Datenschutz](/settings/legal/privacy).');
    await fireEvent.press(screen.getByRole('link'));
    expect(mockPush).toHaveBeenCalledWith('/settings/legal/privacy');
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('opens a web page in the browser and an address in the mail app', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderMarkdown('[Streitbeilegung](https://ec.europa.eu/consumers/odr) oder <kontakt@speedclub.de>');
    const [web, mail] = screen.getAllByRole('link');
    await fireEvent.press(web!);
    expect(mockOpenBrowser).toHaveBeenCalledWith('https://ec.europa.eu/consumers/odr');
    await fireEvent.press(mail!);
    expect(openURL).toHaveBeenCalledWith('mailto:kontakt@speedclub.de');
    openURL.mockRestore();
  });

  it('names an external link as one', async () => {
    await renderMarkdown('[Streitbeilegung](https://ec.europa.eu/consumers/odr)');
    expect(screen.getByRole('link', { name: 'Streitbeilegung, öffnet im Browser' })).toBeTruthy();
  });

  it('lays a wide table out as one block per row, labelled by its header', async () => {
    await renderMarkdown('| Bereich | Daten | Zweck |\n|---|---|---|\n| Konto | E-Mail-Adresse | Anmeldung |');
    expect(screen.getByText('Konto')).toBeTruthy();
    expect(screen.getByText('Daten')).toBeTruthy();
    expect(screen.getByText('E-\u2060Mail-Adresse')).toBeTruthy();
    expect(screen.getByText('Zweck')).toBeTruthy();
    expect(screen.queryByText('Bereich')).toBeNull();
  });

  it('sets the values of a two-column table in ink, as WEB-08 does, and only its head in secondary (DQ-232)', async () => {
    await renderMarkdown('| Dienst | Zweck |\n|---|---|\n| Hosting | Betrieb |');
    const { color } = themes.carbon;
    expect(flat(screen.getByText('Betrieb').props.style).color).toBe(color.text.primary);
    expect(flat(screen.getByText('Hosting').props.style).color).toBe(color.text.primary);
    expect(flat(screen.getByText('Zweck').props.style).color).toBe(color.text.secondary);
  });

  it('sets the first cell of a pair in body.strong, as public.css does: the first column names the row (DQ-232)', async () => {
    await renderMarkdown('| Dienst | Zweck |\n|---|---|\n| Hosting | Betrieb |');
    expect(flat(screen.getByText('Hosting').props.style).fontFamily).toBe(typography.bodyStrong.fontFamily);
    expect(flat(screen.getByText('Betrieb').props.style).fontFamily).toBe(typography.callout.fontFamily);
    expect(flat(screen.getByText('Dienst').props.style).fontFamily).toBe(typography.callout.fontFamily);
  });

  it('gives a stacked pair value the whole line at a large font, never the half-width cap of the side-by-side pair (R4B-010)', async () => {
    const source = '| Daten | Speicherdauer |\n|---|---|\n| Nachrichten | Als Absender steht „Gelöschtes Mitglied“ |';
    await renderMarkdown(source);
    expect(flat(screen.getByText('Als Absender steht „Gelöschtes Mitglied“').props.style).maxWidth).toBe('50%');
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 2 };
    await renderMarkdown(source);
    expect(flat(screen.getAllByText('Als Absender steht „Gelöschtes Mitglied“').at(-1)!.props.style).maxWidth).toBe('100%');
  });

  it('stacks a pair table whose bound run cannot fit its column at 360, so "Sicherheits-E-Mail" never splits as "Ma / il" (R4B-L02)', async () => {
    const value = '12 Monate nach der letzten Anmeldung vom Gerät';
    const source = `| Daten | Speicherdauer |\n|---|---|\n| Liste deiner bekannten Geräte (für die Sicherheits-E-Mail bei neuen Geräten) | ${value} |`;
    await renderMarkdown(source);
    // Side by side until measured, then stacked in a 360 phone's column (320 wide, 288 inside the padding).
    expect(flat(screen.getByText(value).props.style).maxWidth).toBe('50%');
    await fireEvent(tableOf(screen.getByText(value)), 'layout', { nativeEvent: { layout: { width: 320, height: 200, x: 0, y: 0 } } });
    expect(flat(screen.getByText(value).props.style).maxWidth).toBe('100%');
    // Wider (a tablet's column) it fits beside its value again.
    await fireEvent(tableOf(screen.getByText(value)), 'layout', { nativeEvent: { layout: { width: 700, height: 200, x: 0, y: 0 } } });
    expect(flat(screen.getByText(value).props.style).maxWidth).toBe('50%');
  });

  it('measures only the runs the parse step bound: a plain word may hyphenate (R4B-L02)', () => {
    expect(longestBoundRun('für die Sicherheits-\u2060E-\u2060Mail bei')).toBe(18);
    expect(longestBoundRun('Unbedenklichkeitsbescheinigung und Fahrzeug-Daten')).toBe(0);
    expect(longestBoundRun('nach §\u00A027a')).toBe(5);
    const row = (label: string, value: string) => [[{ type: 'text', text: label }], [{ type: 'text', text: value }]] as never;
    const head = row('Daten', 'Speicherdauer');
    expect(pairsFitSideBySide([head, row('Sicherheits-\u2060E-\u2060Mail', '12 Monate')], 288, 1)).toBe(false);
    expect(pairsFitSideBySide([head, row('Kontakt-\u2060E-\u2060Mail', '12 Monate')], 288, 1)).toBe(true);
    expect(pairsFitSideBySide([head, row('Sicherheits-\u2060E-\u2060Mail', '12 Monate')], 680, 1)).toBe(true);
  });

  it('keeps strong emphasis in that cell strong, through its Inlines variant (DQ-232)', async () => {
    await renderMarkdown('| Dienst | Zweck |\n|---|---|\n| **Hosting** und [Mail](https://speedclub.test/x) | Betrieb |');
    expect(flat(screen.getByText('Hosting').props.style).fontFamily).toBe(typography.bodyStrong.fontFamily);
  });

  it('hyphenates a placeholder like the text around it, so a long one never breaks inside a word without a hyphen (DQ-222)', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await renderMarkdown('Betreiber: [[Name des Unternehmens eintragen]]');
      expect(flat(screen.getByText('[[Name des Unternehmens eintragen]]').props.style).hyphens).toBe('auto');
    } finally {
      os.restore();
    }
  });

  it('lists items with their markers, which screen readers skip', async () => {
    await renderMarkdown('1. eins\n2. zwei');
    expect(screen.queryByText('1.')).toBeNull();
    expect(screen.getByText('1.', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('zwei')).toBeTruthy();
  });
});
