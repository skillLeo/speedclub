/**
 * Draft preview (M3.5 ADM-34, ADR-236 c): the admin opens `/app/?preview=<token>` in an iframe, and the member web forwards that token on
 * every read, so the API overlays the issuing staff member's drafts (branding, home curation, announcements) for that request only.
 * Web only, GET and HEAD only (the server ignores it elsewhere), kept in memory for the life of the page: a token never reaches storage,
 * a new tab or a write. The token is HMAC-signed and staff-bound on the server; here it is only passed on.
 */
import { isWeb } from '@/lib/platform';

/** `<base64url body>.<base64url signature>`, as PreviewTokens issues it; anything else is no preview. public/index.html repeats it. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{16,256}$/;

export const PREVIEW_HEADER = 'X-Preview-Token';

/** The token of a query string (`?preview=…`), or null. Given twice or of the wrong shape: none. */
export function readPreviewToken(search: string): string | null {
  const values = new URLSearchParams(search.replace(/^\?/, '')).getAll('preview');
  if (values.length !== 1) return null;
  const token = values[0] ?? '';
  return TOKEN_SHAPE.test(token) ? token : null;
}

/** The themes an ADM-34 frame can ask for. `system` is no frame of its own. */
export type PreviewTheme = 'carbon' | 'black' | 'light';

/**
 * DQ-613: ADM-34 shows its three frames as `/app/?preview=<token>&previewTheme=carbon|black|light`. The theme counts only together
 * with a token of the right shape, given once each; without a token the parameter is nobody's business and is ignored. It is never
 * stored or synced (theme/preference.ts), so the staff member's own theme in their other tabs stays as it was.
 */
export function readPreviewTheme(search: string): PreviewTheme | null {
  if (readPreviewToken(search) === null) return null;
  const values = new URLSearchParams(search.replace(/^\?/, '')).getAll('previewTheme');
  if (values.length !== 1) return null;
  const value = values[0];
  return value === 'carbon' || value === 'black' || value === 'light' ? value : null;
}

const startSearch = isWeb && typeof window !== 'undefined' ? (window.location?.search ?? '') : '';
let token: string | null = startSearch ? readPreviewToken(startSearch) : null;
let theme: PreviewTheme | null = startSearch ? readPreviewTheme(startSearch) : null;

/** The preview token this page was opened with, or null outside a preview. */
export function previewToken(): string | null {
  return token;
}

/** The theme an ADM-34 frame asked for, or null: no preview tab, or no theme asked for. */
export function previewTheme(): PreviewTheme | null {
  return theme;
}

/** Tests only. */
export function setPreviewTokenForTests(next: string | null, nextTheme: PreviewTheme | null = null): void {
  token = next;
  theme = next === null ? null : nextTheme;
}
