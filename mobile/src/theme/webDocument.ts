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
