import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking, Platform } from 'react-native';

import { Markdown } from '@/features/settings/markdown/Markdown';
import { parseMarkdown } from '@/features/settings/markdown/parse';
import { hydrateThemePreference, themes, typography } from '@/theme';

import { flat, renderUi } from '../ui/helpers';

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
  mockPush.mockClear();
  mockOpenBrowser.mockClear();
});

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
