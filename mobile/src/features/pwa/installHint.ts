/**
 * The install hint of the member web (09 §7.15, §8.13): shown once, on a browser that can put /app on the home screen, never
 * inside the installed app.
 *
 * - iOS Safari (iPhone, iPad, iPad in desktop mode): no install API, so the hint names the steps (Teilen → Zum Home-Bildschirm).
 * - Chromium browsers: the hint offers the browser's own install prompt (`beforeinstallprompt`), and only once it has fired.
 * - Everything else (Firefox desktop, in-app browsers): no hint.
 *
 * "Once" is per browser (localStorage `sc.installHint`): a convenience, and a blocked storage simply shows nothing. Automated
 * browsers (`navigator.webdriver`) never get it on their own, so the visual matrix photographs screens, not the hint; outside
 * production `qaOpen=installHint` shows it for the e2e spec and the matrix cell.
 */
import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';

export type InstallVariant = 'ios' | 'prompt';

export const INSTALL_HINT_STORAGE_KEY = 'sc.installHint';

/** The browser's install prompt (Chromium), not in the DOM lib types. */
export type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

type Env = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  webdriver: boolean;
};

export function isIosBrowser(env: Pick<Env, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  // iPadOS asks for desktop pages by default and reports a Mac, but a Mac has no touch screen.
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

/** Safari itself: Chrome, Firefox, Edge and in-app browsers on iOS name themselves, and their share sheets differ. */
export function isIosSafari(env: Pick<Env, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return isIosBrowser(env) && /Safari\//.test(env.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV/.test(env.userAgent);
}

/** Which hint this browser gets, or null. `hasPrompt`: a `beforeinstallprompt` event is held. */
export function installVariant(env: Env, hasPrompt: boolean, forced: boolean = false): InstallVariant | null {
  if (env.standalone) return null;
  if (env.webdriver && !forced) return null;
  if (isIosSafari(env)) return 'ios';
  if (hasPrompt) return 'prompt';
  // Forced on a browser without either: the steps are the clearer picture of the two.
  return forced ? 'ios' : null;
}

export function browserEnv(): Env {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone,
    webdriver: nav.webdriver === true,
  };
}

/** Whether the installed app is running (home-screen start): Web Push on iOS needs this. */
export function isStandalone(): boolean {
  return isWeb && typeof window !== 'undefined' && browserEnv().standalone;
}

export const installHintForced = (): boolean => qa.open === 'installHint';

export function installHintSeen(): boolean {
  if (installHintForced()) return false;
  try {
    return window.localStorage.getItem(INSTALL_HINT_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

export function markInstallHintSeen(outcome: 'dismissed' | 'installed'): void {
  try {
    window.localStorage.setItem(INSTALL_HINT_STORAGE_KEY, outcome);
  } catch {
    // Without storage the hint cannot be remembered, and it is not shown again in this page either (PwaHost keeps it closed).
  }
}
