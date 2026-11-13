/**
 * Keeps the document in step with the app after the head script in public/index.html has run.
 * Outside production, <html> also reports the QA overrides that were really applied, which the QA harness
 * compares on every cell (web/tests/e2e/README.md). The guards must keep comparing
 * `process.env.EXPO_PUBLIC_APP_ENV` directly, so a production bundle drops the report altogether.
 */
import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';

import type { AppTheme } from './theme';

function setMeta(name: string, content: string): void {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content);
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (!isWeb) return;
  // The theme reaches the document first, on the provider's first layout: the one place that runs once the app is up.
  listenForCopy();
  const root = document.documentElement;
  root.dataset.theme = theme.name;
  setMeta('color-scheme', theme.colorScheme);
  setMeta('theme-color', theme.color.bg.canvas);
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'production') {
    root.dataset.qaTheme = theme.name;
    root.dataset.qaFontScale = String(theme.fontScale);
  }
}

export function applyLocaleToDocument(locale: string): void {
  if (!isWeb) return;
  document.documentElement.lang = locale;
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'production') document.documentElement.dataset.qaLocale = locale;
}

/** The overrides that are fixed for the session. Theme, font scale and locale report themselves above. */
export function reportQaSession(): void {
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'production' && isWeb) {
    document.documentElement.dataset.qaState = qa.state ?? 'default';
    document.documentElement.dataset.qaMotion = qa.motion ?? 'on';
  }
}

export function markDocumentReady(): void {
  if (isWeb) document.documentElement.dataset.scReady = '1';
}

/**
 * NH-R4-1: characters the app sets only to steer line breaks: the zero-width space after "@", "." and "/" of an identifier
 * (textBreaks identifierText, handleText) and the word joiner that keeps "GT-R" or "E-Mail" whole. They draw nothing, but a
 * copy would carry them into a mail client, a search or a password manager.
 */
const BREAK_CONTROLS = /[​⁠]/g;

/** The selected text as it reads on screen, without the break controls. */
export function withoutBreakControls(text: string): string {
  return text.replace(BREAK_CONTROLS, '');
}

type CopyEvent = Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>;

/**
 * The copy handler: when the selection holds a break control, the clipboard gets the clean plain text instead. A selection
 * inside a field (`getSelection()` is empty there) and a selection without one keep the browser's own copy.
 */
export function cleanCopy(event: CopyEvent, selection: Pick<Selection, 'toString'> | null): boolean {
  const selected = selection?.toString() ?? '';
  const clean = withoutBreakControls(selected);
  if (selected === '' || clean === selected || !event.clipboardData) return false;
  event.clipboardData.setData('text/plain', clean);
  event.preventDefault();
  return true;
}

let copyListening = false;

/** Web only, once per document: every copy inside the app goes through cleanCopy. */
export function listenForCopy(): void {
  if (!isWeb || copyListening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  copyListening = true;
  document.addEventListener('copy', (event) => {
    cleanCopy(event, document.getSelection());
  });
}
