/**
 * R4-1.4: when the introduction (INTRO-01…04) opens by itself. Once per account, after the first sign-in and after registration with
 * its F1 steps: the member has no open step, is not on a sign-in or F1 route (the primer and the passkey offer included) and the
 * server still owes the pages. Never for a guest, never in a staff view-as tab, never for an automated browser or under a QA override
 * (the e2e flows and the visual matrix open the screen they name; INTRO-01 has its own route for them).
 */
import { isAuthRoute, isOpenRoute } from '@/features/auth/routing';

export const INTRO_PATH = '/intro';

export type IntroTriggerInput = {
  status: 'loading' | 'guest' | 'member';
  /** The member's open onboarding step, if any. */
  nextStep: string | null | undefined;
  pathname: string;
  /** `introDue(me)`: the server answered `intro_seen_at: null`. */
  due: boolean;
  /** Opened in this app session already (for this member). */
  opened: boolean;
  /** An automated browser, a QA override or a staff view-as tab. */
  suppressed: boolean;
};

export function shouldOpenIntro({ status, nextStep, pathname, due, opened, suppressed }: IntroTriggerInput): boolean {
  if (status !== 'member' || !due || opened || suppressed || nextStep) return false;
  if (pathname === INTRO_PATH || isAuthRoute(pathname) || isOpenRoute(pathname)) return false;
  return true;
}
