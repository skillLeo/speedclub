/**
 * SM14 theme circular reveal, app-wide (09 §4.7, §8.11; M4.10). SET-10 hands the centre of the tapped swatch to `changeTheme`;
 * the change then spreads from the finger instead of the plain crossfade:
 *
 * - native (and a browser without View Transitions): the ThemeProvider takes the request when its theme changes and grows a disc
 *   in the new canvas colour from the origin until it covers the window (effect.slow), switches the theme beneath it and fades the
 *   disc (effect.fast). The fallback of the M4.3 kit until Skia + react-native-view-shot are approved (no snapshot of the old
 *   screen exists without them).
 * - web: `document.startViewTransition` snapshots the page, the theme switches inside the transition, and the new snapshot is
 *   clipped by a growing `circle()` from the origin (effect.slow). The provider applies that change instantly (no second overlay).
 *
 * Reduced motion, the `theme_reveal` flag off, or no origin: the provider's crossfade, as before. One request is valid for one
 * change shortly after it was made, so a theme choice that changes nothing on screen (System while the system is dark, after
 * Carbon) never leaves a stale request for a later change.
 */
import { isWeb } from '@/lib/platform';
import { coveringRadius, cssEasing, motionDuration } from '@/ui/motion';

import { setThemePreference } from './preference';
import type { ThemePreference } from './tokens.generated';

export type RevealOrigin = { x: number; y: number };
export type ThemeRevealRequest = { mode: 'disc'; origin: RevealOrigin } | { mode: 'instant' };

/** How long a request waits for the provider to see the change it belongs to. */
export const REVEAL_REQUEST_TTL_MS = 500;

let pending: { request: ThemeRevealRequest; at: number } | null = null;

/** The provider's side: the request of the change it is applying now, at most once. */
export function takeThemeReveal(now: number = Date.now()): ThemeRevealRequest | null {
  const current = pending;
  pending = null;
  if (!current || now - current.at > REVEAL_REQUEST_TTL_MS) return null;
  return current.request;
}

/** Test seam. */
export function __peekThemeRevealForTests(): ThemeRevealRequest | null {
  return pending?.request ?? null;
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };
type TransitionDocument = Document & { startViewTransition?: (update: () => Promise<void> | void) => ViewTransition };

const VT_STYLE_ID = 'sc-theme-reveal';

/** The default cross-fade of the root snapshots is replaced by the clip below; nothing else changes. */
function ensureTransitionStyle(doc: Document): void {
  if (doc.getElementById(VT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = VT_STYLE_ID;
  style.textContent = '::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}';
  doc.head.appendChild(style);
}

/** Two frames: React has rendered the new theme (an external-store update) and the browser has painted it. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export type ChangeThemeOptions = {
  /** The centre of the tapped swatch, in window coordinates. Without it: the plain crossfade. */
  origin?: RevealOrigin | null;
  /** The `theme_reveal` flag and the motion preference: false keeps the plain crossfade. */
  reveal: boolean;
};

/**
 * Sets the theme preference (stored and synced as before) and, when allowed, asks for the circular reveal from `origin`.
 */
export function changeTheme(next: ThemePreference, { origin = null, reveal }: ChangeThemeOptions): void {
  if (!reveal || !origin) {
    setThemePreference(next);
    return;
  }
  const doc = isWeb && typeof document !== 'undefined' ? (document as TransitionDocument) : null;
  if (doc?.startViewTransition) {
    ensureTransitionStyle(doc);
    const radius = coveringRadius(origin, window.innerWidth, window.innerHeight);
    const transition = doc.startViewTransition(() => {
      pending = { request: { mode: 'instant' }, at: Date.now() };
      setThemePreference(next);
      return afterPaint();
    });
    transition.ready
      .then(() => {
        doc.documentElement.animate(
          { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${Math.ceil(radius)}px at ${origin.x}px ${origin.y}px)`] },
          { duration: motionDuration('effect.slow'), easing: cssEasing('effect.slow'), pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => undefined);
    return;
  }
  pending = { request: { mode: 'disc', origin }, at: Date.now() };
  setThemePreference(next);
}
