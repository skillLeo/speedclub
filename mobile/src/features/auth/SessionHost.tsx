import {
  router,
  useNavigationContainerRef,
  usePathname,
  useRootNavigationState,
  type Href,
  type NavigationState,
} from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { onApiGateEvent, reloadTab } from '@/api/client';
import { isViewAsTab } from '@/api/clientViewAs';
import { adoptMe, releaseExpiredSession, toSessionMember, useMe, useSettingsSync } from '@/api/queries/auth';
import { isNative, isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { setStored } from '@/lib/storage';
import {
  clearAuthIntent,
  completeAuthIntent,
  isInternalPath,
  keepReturnTo,
  setMember,
  setMemberChanged,
  setPasswordChangeEmail,
  setSessionNotice,
  useSessionStore,
} from '@/state/session';
import { Dialog } from '@/ui';
import { ConsentHost } from '@/features/consent/ConsentHost';
import { AppLockHost } from '@/features/settings/appLock/AppLockHost';

import { handEmailTo } from './emailHandoff';
import { restorePrimer, usePrimerStore } from './primer';
import { usePushRegistration } from './push';
import { disarmPasskeyOffer, resetPasskeyOffer, usePasskeyOfferStore } from './passkeyOffer';
import { RecentAuthHost } from './RecentAuthHost';
import { consumeAfterOnboarding, EMAIL_PATH, firstLaunchRoute, isAuthRoute, isGuestPath, PASSKEY_OFFER_PATH, routeForSession, TABS_ROUTE } from './routing';
import { useTermsRequiredRefresh } from './termsRequired';
import { hasSeenOnboarding, hasSeenWelcome } from './sessionLifecycle';

/**
 * A screen of the previous member that still guards a dirty form stops the reset below and asks. The session must not wait for that
 * answer: past this, the screens that stayed may ask, and the server answers them as it answers anybody.
 */
const LEAVE_PREVIOUS_SCREENS_MS = 2000;

/** The stack of the root layout. The container itself holds a single route, with that stack inside. */
function rootStackOf(root: NavigationState | undefined) {
  return root?.routes?.[root.index]?.state;
}

/**
 * BH-30, ADR-175(c): nothing of the previous member stays. A replace would not see to that: it leaves the old (tabs) below the new
 * one, with every screen mounted, and a replace within the tabs leaves the other tabs' stacks as they were. Answers the routes that go.
 */
function dropPreviousScreens(
  navigation: ReturnType<typeof useNavigationContainerRef>,
  keepFocused: boolean,
): string[] {
  const stack = rootStackOf(navigation.getRootState());
  if (!stack?.key || stack.index === undefined) return [];
  const focused = stack.routes[stack.index];
  const going = stack.routes
    .filter((route) => !keepFocused || route !== focused)
    .flatMap((route) => route.key ?? []);
  if (going.length === 0) return [];
  // The keyless route gets a key and its nested state from the router: this is a new shell, which opens on Start.
  const routes = keepFocused && focused ? [focused] : [{ name: TABS_ROUTE }];
  navigation.dispatch({ type: 'RESET', payload: { ...stack, index: 0, routes }, target: stack.key });
  return going;
}

/**
 * Applies what the session says about the current route. Deferred by a tick: the store's change reaches the screens in the
 * same commit, and a form that just succeeded must first drop its discard guard, or the guard would stop this navigation.
 */
function useSessionRouting() {
  const rootState = useRootNavigationState();
  const ready = Boolean(rootState?.key);
  const pathname = usePathname();
  const status = useSessionStore((state) => state.status);
  const nextStep = useSessionStore((state) => state.member?.nextStep);
  const passwordChangeEmail = useSessionStore((state) => state.passwordChangeEmail);
  const memberChanged = useSessionStore((state) => state.memberChanged);
  const memberId = useSessionStore((state) =>
    state.status === 'member' ? (state.member?.id ?? null) : null,
  );
  const primerState = usePrimerStore((state) => state.state);
  const passkeyOffer = usePasskeyOfferStore((state) => state.state);
  const navigation = useNavigationContainerRef();
  /** The root routes of the previous member that are on their way out. */
  const [leaving, setLeaving] = useState<readonly string[] | null>(null);
  const welcomeChecked = useRef(false);

  useEffect(() => {
    if (!ready || passwordChangeEmail === null) return undefined;
    const timer = setTimeout(() => {
      handEmailTo('/reset-password', passwordChangeEmail);
      router.replace({ pathname: '/reset-password', params: { forced: '1' } });
      setPasswordChangeEmail(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [passwordChangeEmail, ready]);

  // BH-28: what the previous member wanted does not carry over, nor do the screens. An auth route stays for the moment, and goes by
  // the routing below.
  useEffect(() => {
    if (!ready || !memberChanged || leaving !== null) return undefined;
    const timer = setTimeout(() => {
      clearAuthIntent();
      const onAuthRoute = isAuthRoute(pathname);
      setLeaving(dropPreviousScreens(navigation, onAuthRoute));
      if (!onAuthRoute) router.replace('/');
    }, 0);
    return () => clearTimeout(timer);
  }, [leaving, memberChanged, navigation, pathname, ready]);

  // The queries of those screens stay off until the screens are gone, which only the committed state can tell: a navigation can take
  // its time, and turning the queries on any sooner would send a request for the previous member's vehicle as this member.
  useEffect(() => {
    if (leaving === null) return undefined;
    const finish = () => {
      setMemberChanged(false);
      setLeaving(null);
    };
    const remaining = rootStackOf(rootState)?.routes ?? [];
    if (!remaining.some((route) => route.key !== undefined && leaving.includes(route.key))) {
      finish();
      return undefined;
    }
    const timer = setTimeout(finish, LEAVE_PREVIOUS_SCREENS_MS);
    return () => clearTimeout(timer);
  }, [leaving, rootState]);

  // AUTH-10 is the device's step: whether this member left it open is read for each member.
  useEffect(() => {
    void restorePrimer(memberId);
  }, [memberId]);

  useEffect(() => {
    if (!ready || passwordChangeEmail !== null) return undefined;
    const route = routeForSession({ status, nextStep, pathname, primer: isNative, primerState, passkeyOffer });
    if (route.type === 'stay') return undefined;
    const timer = setTimeout(() => {
      if (route.type === 'go') {
        if (route.resume) keepReturnTo(route.resume);
        router.replace(route.path as Href);
        return;
      }
      // AUTH-14 was answered, or the way on did not pass it: either way it is done for this sign-in.
      if (pathname === PASSKEY_OFFER_PATH) resetPasskeyOffer();
      else disarmPasskeyOffer();
      const held = useSessionStore.getState().expiredFrom !== null;
      useSessionStore.setState({ expiredFrom: null });
      const returnTo = completeAuthIntent();
      // BH-30: the form the member left is still there, under the sign-in. A replace would open a second, empty one.
      if (held && returnTo) router.dismissTo(returnTo as Href);
      else router.replace((returnTo ?? route.fallback) as Href);
      const next = consumeAfterOnboarding();
      if (next) router.push(next as Href);
    }, 0);
    return () => clearTimeout(timer);
  }, [nextStep, passkeyOffer, passwordChangeEmail, pathname, primerState, ready, status]);

  // ONB-01…03 then Welcome on the first launch of the app; the pages once on the first visit of /app. A cold deep link goes where it
  // points (firstLaunchRoute).
  useEffect(() => {
    if (!ready || status === 'loading' || welcomeChecked.current) return;
    welcomeChecked.current = true;
    const route = firstLaunchRoute({
      native: isNative,
      status,
      pathname,
      onboardingSeen: hasSeenOnboarding(),
      welcomeSeen: hasSeenWelcome(),
      skipOnWeb: isWeb && skipsWebOnboarding(),
    });
    if (route) router.replace(route as Href);
  }, [pathname, ready, status]);
}

/** Keeps the store current with what the server says about the member. A failure stays silent here: 401 and 403 end the session through the API gate events, and the rest keeps the cached member. */
/**
 * Web: the e2e flows and the visual matrix run an automated browser (`navigator.webdriver`) and open the screen they name; a visitor
 * who followed a link from the public pages (same origin) came for content (ADR-152 c). Neither gets the onboarding pages.
 */
function skipsWebOnboarding(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) return true;
  // Any QA override (qaTheme, qaMotion…): a named screen is being looked at.
  if (Object.keys(qa).length > 0) return true;
  if (typeof document === 'undefined' || typeof window === 'undefined' || !document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

function useMemberSync() {
  const { data } = useMe();
  const status = useSessionStore((state) => state.status);
  useEffect(() => {
    if (!data || status !== 'member') return;
    // BH-28: the server answered for somebody else, as when another tab signed in as them.
    const current = useSessionStore.getState().member;
    if (current && current.id !== data.id) {
      adoptMe(data);
      return;
    }
    const member = toSessionMember(data);
    setMember(member);
    // View-as (m3.2-contract §3): nothing about the member goes to this browser's storage.
    if (isViewAsTab()) return;
    // The next start then knows what the server said last, as whether the profile has a cover (DQ-122).
    void setStored('sc.sessionMember', JSON.stringify(member));
  }, [data, status]);
}

function SessionNoticeDialog() {
  const { t } = useTranslation('auth');
  const notice = useSessionStore((state) => state.notice);
  const pathname = usePathname();

  // BH-30: leaving the sign-in without signing in is no choice yet, so a held form asks again.
  const previousPath = useRef(pathname);
  useEffect(() => {
    const from = previousPath.current;
    previousPath.current = pathname;
    const { status, expiredFrom, notice: open } = useSessionStore.getState();
    if (
      status === 'guest' &&
      expiredFrom !== null &&
      open === null &&
      isAuthRoute(from) &&
      !isAuthRoute(pathname)
    ) {
      setSessionNotice({ kind: 'expired' });
    }
  }, [pathname]);

  const leave = () => {
    setSessionNotice(null);
    void releaseExpiredSession();
    // A tick later: a form held behind the dialog has to unmount first, or its discard guard would stop this.
    if (!isGuestPath(pathname)) setTimeout(() => router.replace('/welcome'), 0);
  };
  const signIn = () => {
    setSessionNotice(null);
    const returnTo = isInternalPath(pathname) && !isAuthRoute(pathname) ? pathname : undefined;
    // AUTH 2.0 (09 §7.2): sign-in starts passwordless, at AUTH-12 E-Mail; the password way stays one tap away there.
    router.push({ pathname: EMAIL_PATH, params: returnTo ? { returnTo } : {} });
  };

  const expired = notice?.kind === 'expired';
  return (
    <Dialog
      visible={notice !== null}
      onClose={leave}
      title={expired ? t('session.expiredTitle') : t('session.restrictedTitle')}
      body={notice?.kind === 'restricted' ? notice.message : t('session.expiredBody')}
      testID="AUTH.sessionNotice"
      actions={
        expired
          ? [
              {
                label: t('session.continueAsGuest'),
                variant: 'secondary',
                onPress: leave,
                testID: 'AUTH.sessionNotice.guest',
              },
              {
                label: t('session.signIn'),
                variant: 'primary',
                onPress: signIn,
                testID: 'AUTH.sessionNotice.signIn',
              },
            ]
          : [
              {
                label: t('session.close'),
                variant: 'primary',
                onPress: leave,
                testID: 'AUTH.sessionNotice.close',
              },
            ]
      }
    />
  );
}

/**
 * BH-28, web: a write was refused because another tab signed in as somebody else. The tab reloads by itself; should the browser not
 * go, this says why nothing was saved, and offers the reload.
 */
function SessionMovedDialog() {
  const { t } = useTranslation('auth');
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      onApiGateEvent((event) => {
        if (event === 'session_moved') setOpen(true);
      }),
    [],
  );
  return (
    <Dialog
      visible={open}
      onClose={() => setOpen(false)}
      title={t('sessionMoved.title')}
      body={t('sessionMoved.body')}
      testID="AUTH.sessionMoved"
      actions={[
        {
          label: t('sessionMoved.reload'),
          variant: 'primary',
          onPress: reloadTab,
          testID: 'AUTH.sessionMoved.reload',
        },
      ]}
    />
  );
}

/** The session's presence in the UI: routing, the member's refresh, the settings sync and the dialogs. In the root layout, once. */
export function SessionHost() {
  const ready = Boolean(useRootNavigationState()?.key);
  useSessionRouting();
  useMemberSync();
  usePushRegistration(ready);
  useSettingsSync();
  useTermsRequiredRefresh();
  return (
    <>
      {/* M4.6: the reauth sheet of every sensitive call (403 reauthentication_required, 09 §8.1). */}
      <RecentAuthHost />
      <SessionNoticeDialog />
      <SessionMovedDialog />
      {/* M3.5 ADM-31: the blocking re-consent sheet, while app-config names a version the member has not accepted. */}
      <ConsentHost />
      {/* M4.7 SET-20 / AUTH-15 (native only): the privacy cover and the app lock, over every route and every deep link. */}
      <AppLockHost />
    </>
  );
}
