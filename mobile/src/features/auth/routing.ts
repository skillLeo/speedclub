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
/** The route of the root stack that holds the five tabs. */
export const TABS_ROUTE = '(tabs)';

export const STEP_ROUTE: Readonly<Record<OnboardingStep, string>> = {
  verify_email: '/verify-email',
  choose_username: '/username',
  profile_setup: '/profile-setup',
};

const AUTH_ROUTES = new Set([
  '/welcome',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  // AUTH-11: a guest with a challenge; a member signed in by it leaves like from any sign-in.
  '/two-factor',
  '/username',
  '/profile-setup',
  PRIMER_PATH,
]);

const MEMBER_STEPS = new Set(['/username', '/profile-setup', PRIMER_PATH]);

/** Never redirected: the gates decide about themselves, the legal texts must stay readable, and the gallery is for QA. */
const OPEN_PREFIXES = ['/maintenance', '/update-required', '/settings/legal', '/dev'];

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
const BROWSE_EXACT = new Set([HOME_PATH, '/discover']);
const BROWSE_PREFIXES = ['/discover/', '/v/', '/u/', '/c/', '/settings/legal'];

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
}): SessionRoute {
  const { status, nextStep, pathname, primer = false, primerState = 'idle' } = input;
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
  // F1 ends in the garage; a plain sign-in goes home.
  return { type: 'finish', fallback: pathname === '/profile-setup' || pathname === PRIMER_PATH ? GARAGE_PATH : HOME_PATH };
}

/** What a guest may keep looking at after a session ended. Everything else goes to Welcome. */
const GUEST_EXACT = new Set(['/', '/garage', '/messages', '/profile', '/discover']);
const GUEST_PREFIXES = ['/discover/', '/v/', '/u/', '/c/', '/settings/legal'];

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
