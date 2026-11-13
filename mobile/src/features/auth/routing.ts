/**
 * Where a member belongs. One pure function, one effect in SessionHost: a sign-in, a finished step and an app restart all
 * end in the same place, and no screen navigates after a success on its own. That is what makes a killed app resume at the
 * next open step (F1) and keeps two navigations from racing.
 */
import { isInternalPath, type OnboardingStep, type SessionStatus } from '@/state/session';

export const WIZARD_PATH = '/add-vehicle/new/vehicle';
export const GARAGE_PATH = '/garage';
export const HOME_PATH = '/';
/** AUTH-10, native only: after AUTH-09, before the garage (F1). */
export const PRIMER_PATH = '/notifications-primer';
/** AUTH-14 (M4.6): once per device after a sign-in, before the member goes on (features/auth/passkeyOffer.ts). */
export const PASSKEY_OFFER_PATH = '/auth/passkey-offer';
/** AUTH-12 (M4.6): the passwordless start, where a guest who must sign in goes first. */
export const EMAIL_PATH = '/auth/email';
/** ONB-01…03 (09 §6, §7.1): the onboarding pager, first launch for guests. */
export const ONBOARDING_PATH = '/onboarding';
/** AUTH-02, where the onboarding hands a native guest over. */
export const WELCOME_PATH = '/welcome';
/**
 * AUTH-17 (M4.7): "Das war ich nicht", for a member (the result after SET-21) and for a guest (the alert link). Never redirected, and
 * a guest may stay on it when the session ends under it.
 */
export const SECURE_PATH = '/auth/secure';
/** The route of the root stack that holds the five tabs. */
export const TABS_ROUTE = '(tabs)';

export const STEP_ROUTE: Readonly<Record<OnboardingStep, string>> = {
  verify_email: '/verify-email',
  // AUTH-09b (M4.6, 09 §6 route /auth/finish): only accounts made by e-mail code, Apple or Google stop here.
  accept_terms: '/auth/finish',
  choose_username: '/username',
  profile_setup: '/profile-setup',
};

const AUTH_ROUTES = new Set([
  WELCOME_PATH,
  ONBOARDING_PATH,
  '/sign-in',
  '/sign-up',
  '/verify-email',
  // M4.6 Auth 2.0: e-mail entry, code entry, magic link, provider link, the AGB step and the passkey offer.
  EMAIL_PATH,
  '/auth/code',
  '/auth/magic',
  '/auth/link',
  '/auth/finish',
  PASSKEY_OFFER_PATH,
  '/forgot-password',
  '/reset-password',
  // AUTH-11: a guest with a challenge; a member signed in by it leaves like from any sign-in.
  '/two-factor',
  '/username',
  '/profile-setup',
  PRIMER_PATH,
]);

const MEMBER_STEPS = new Set(['/username', '/profile-setup', PRIMER_PATH, '/auth/finish', PASSKEY_OFFER_PATH]);

/** Where a sign-in happens: only from these may the passkey offer interrupt the way on (never from the F1 steps). */
const SIGN_IN_ROUTES = new Set(['/sign-in', '/verify-email', '/two-factor', EMAIL_PATH, '/auth/code', '/auth/magic', '/auth/link', '/welcome']);

/** Never redirected: the gates decide about themselves, the legal texts must stay readable, and the gallery is for QA. */
const OPEN_PREFIXES = ['/maintenance', '/update-required', '/settings/legal', '/dev', SECURE_PATH];

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.has(pathname);
}

const isOpenRoute = (pathname: string) =>
  OPEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * BH-29: what an unverified member may look at (02_PRODUCT_SPEC §3.1, ADR-139): Home, Discover and its search, public vehicle
 * and member pages, a sticker's code, the legal texts. Not isGuestPath, which holds the auth routes and the guest variants of
 * the member screens.
 */
// M4.12: the events list and an event's page are public (09 §8.7, guests too).
const BROWSE_EXACT = new Set([HOME_PATH, '/discover', '/events']);
const BROWSE_PREFIXES = ['/discover/', '/v/', '/u/', '/c/', '/events/', '/settings/legal'];

export function isBrowsePath(pathname: string): boolean {
  return BROWSE_EXACT.has(pathname) || BROWSE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** The page a step or a prompt interrupts, to come back to. Home is no such page: F1 ends in the garage from there. */
export function deepLinkOf(pathname: string): string | undefined {
  return pathname !== HOME_PATH && !isAuthRoute(pathname) && isInternalPath(pathname) ? pathname : undefined;
}

export type SessionRoute =
  /** Stay where you are. */
  | { type: 'stay' }
  /** `resume`: the page this interrupts, for after the step. */
  | { type: 'go'; path: string; resume?: string }
  /** The member has nothing left to do here: run the intent and leave the auth stack. */
  | { type: 'finish'; fallback: string };

export function routeForSession(input: {
  status: SessionStatus;
  nextStep?: OnboardingStep | null;
  pathname: string;
  /** Native: AUTH-10 joins F1. The web has no push, so its primer route moves on. */
  primer?: boolean;
  /** The primer's state on this device (features/auth/primer.ts). */
  primerState?: 'idle' | 'due' | 'answered';
  /** AUTH-14 on this device (features/auth/passkeyOffer.ts). */
  passkeyOffer?: 'idle' | 'due' | 'answered';
}): SessionRoute {
  const { status, nextStep, pathname, primer = false, primerState = 'idle', passkeyOffer = 'idle' } = input;
  if (status === 'loading') return { type: 'stay' };
  if (status === 'guest') return MEMBER_STEPS.has(pathname) ? { type: 'go', path: '/sign-in' } : { type: 'stay' };
  if (isOpenRoute(pathname)) return { type: 'stay' };
  if (nextStep) {
    // A reset link works without a session and ends all of them, so it is not in the way of anything.
    if (pathname === '/reset-password') return { type: 'stay' };
    const step = STEP_ROUTE[nextStep];
    if (pathname === step) return { type: 'stay' };
    // The other two steps are forced for F1 resume. The code only guards what puts something in front of other people.
    if (nextStep === 'verify_email' && isBrowsePath(pathname)) return { type: 'stay' };
    const resume = deepLinkOf(pathname);
    return resume ? { type: 'go', path: step, resume } : { type: 'go', path: step };
  }
  if (primer) {
    // F1: the profile is set up, the primer comes next. On the primer, nothing moves until the member chose.
    if (pathname === '/profile-setup') return { type: 'go', path: PRIMER_PATH };
    if (pathname === PRIMER_PATH) return primerState === 'answered' ? { type: 'finish', fallback: GARAGE_PATH } : { type: 'stay' };
    // An app closed on the primer resumes there, and the page a link opened comes after it.
    if (primerState === 'due' && !isAuthRoute(pathname)) {
      const resume = deepLinkOf(pathname);
      return resume ? { type: 'go', path: PRIMER_PATH, resume } : { type: 'go', path: PRIMER_PATH };
    }
  }
  if (pathname === '/reset-password' || !isAuthRoute(pathname)) return { type: 'stay' };
  // AUTH-14: nothing moves until the member chose; then on to where the sign-in was going.
  if (pathname === PASSKEY_OFFER_PATH) return passkeyOffer === 'answered' ? { type: 'finish', fallback: HOME_PATH } : { type: 'stay' };
  if (passkeyOffer === 'due' && SIGN_IN_ROUTES.has(pathname)) return { type: 'go', path: PASSKEY_OFFER_PATH };
  // F1 ends in the garage; a plain sign-in goes home.
  return { type: 'finish', fallback: pathname === '/profile-setup' || pathname === PRIMER_PATH ? GARAGE_PATH : HOME_PATH };
}

/** What a guest may keep looking at after a session ended. Everything else goes to Welcome. */
const GUEST_EXACT = new Set(['/', '/garage', '/messages', '/profile', '/discover', '/events', SECURE_PATH]);
const GUEST_PREFIXES = ['/discover/', '/v/', '/u/', '/c/', '/events/', '/settings/legal'];

export function isGuestPath(pathname: string): boolean {
  return (
    GUEST_EXACT.has(pathname) ||
    AUTH_ROUTES.has(pathname) ||
    GUEST_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** What the signed-in choice of AUTH-09 wants after the garage. Single use. */
let afterOnboarding: string | null = null;

export function openAfterOnboarding(path: string | null): void {
  afterOnboarding = path;
}

export function consumeAfterOnboarding(): string | null {
  const path = afterOnboarding;
  afterOnboarding = null;
  return path;
}

export type FirstLaunchInput = {
  native: boolean;
  status: 'loading' | 'guest' | 'member';
  pathname: string;
  onboardingSeen: boolean;
  welcomeSeen: boolean;
  /** Web: an automated browser (the e2e flows and the visual matrix) or a visitor coming from the public pages. */
  skipOnWeb?: boolean;
};

/**
 * The first launch of a guest (09 §7.1, ADR-152 c amended by 09): on Start only, never on a cold deep link. Native: the onboarding
 * pages once, then Welcome once (the pages hand over to it). Web: the pages on the first visit of /app only, never for an automated
 * browser or a visitor who came from the public pages; Welcome never opens by itself on the web.
 */
export function firstLaunchRoute({ native, status, pathname, onboardingSeen, welcomeSeen, skipOnWeb = false }: FirstLaunchInput): string | null {
  if (status !== 'guest' || pathname !== HOME_PATH) return null;
  if (!onboardingSeen && (native || !skipOnWeb)) return ONBOARDING_PATH;
  if (native && !welcomeSeen) return WELCOME_PATH;
  return null;
}
