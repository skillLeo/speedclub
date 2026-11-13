/**
 * Web Push in this browser (09 §8.13, ADR-452): the permission, the PushManager subscription made with the VAPID public key of
 * app-config, and its place on the server. Web only; native push is features/auth/push.ts.
 *
 * - The browser prompt only follows a tap on "Browser-Mitteilungen einschalten" (SET-09): never on load (08 §6).
 * - iOS delivers Web Push only to the app on the home screen (iOS 16.4+): Safari in a tab has no PushManager, so SET-09 says how to
 *   install first (`needsInstall`).
 * - A subscription made with an older VAPID key is replaced, so a key rotation on the server does not strand the browser.
 * - Sign-out removes the subscription from the server and from the browser while the session still exists (`beforeSignOut`), so the
 *   next member on this browser never gets the previous member's notifications.
 * - Every sign-in posts an existing subscription again (`relinkWebPushAfterSignIn`): the POST is idempotent per endpoint and ties it
 *   to the new session, so "Alle anderen Geräte abmelden" from a later session does not silently drop this browser.
 */
import { beforeSignOut } from '@/api/queries/auth';
import { deletePushSubscription, savePushSubscription, type PushSubscriptionOutcome } from '@/api/queries/webPush';
import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';

import { isIosBrowser, isStandalone } from './installHint';
import { serviceWorkerRegistration } from './serviceWorker';

/** What this browser can do, before any permission. */
export type WebPushSupport = 'supported' | 'needsInstall' | 'unsupported';
export type WebPushPermission = 'default' | 'granted' | 'denied';

export function webPushSupport(): WebPushSupport {
  if (!isWeb || typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  if (capable) return 'supported';
  const env = { userAgent: navigator.userAgent ?? '', platform: navigator.platform ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 };
  return isIosBrowser(env) && !isStandalone() ? 'needsInstall' : 'unsupported';
}

export function webPushPermission(): WebPushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  const value = window.Notification.permission;
  return value === 'granted' || value === 'denied' ? value : 'default';
}

/** The base64url key as the bytes `applicationServerKey` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await serviceWorkerRegistration();
  if (!registration || !('pushManager' in registration)) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** The body ADR-452 asks for, from the browser's subscription. */
export function subscriptionBody(subscription: PushSubscription, userAgent: string = navigator.userAgent): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
} {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('The push subscription has no endpoint or keys');
  return { endpoint: json.endpoint, keys: { p256dh, auth }, ...(userAgent ? { user_agent: userAgent.slice(0, 255) } : {}) };
}

export type EnableOutcome = 'on' | 'denied' | 'dismissed' | 'unavailable' | 'noWorker';

/**
 * The tap on "einschalten": the browser prompt (when still undecided), then the subscription and the server. A server without the
 * endpoint leaves the browser unsubscribed, so nothing stays half on.
 */
export async function enableWebPush(vapidKey: string): Promise<EnableOutcome> {
  const permission = webPushPermission() === 'default' ? await window.Notification.requestPermission() : webPushPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  const registration = await serviceWorkerRegistration();
  if (!registration) return 'noWorker';
  const key = keyBytes(vapidKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  let outcome: PushSubscriptionOutcome;
  try {
    outcome = await savePushSubscription(subscriptionBody(subscription));
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  if (outcome === 'unavailable') {
    await subscription.unsubscribe().catch(() => false);
    return 'unavailable';
  }
  return 'on';
}

/** Off in this browser: the server forgets the endpoint, the browser drops the subscription. */
export async function disableWebPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await deletePushSubscription(subscription.endpoint);
  await subscription.unsubscribe().catch(() => false);
}

/** Sign-out: while the session still exists. A failed delete still drops the browser's subscription. */
export async function dropWebPushAtSignOut(): Promise<void> {
  if (useSessionStore.getState().status !== 'member') return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await deletePushSubscription(subscription.endpoint);
  } catch (error) {
    console.warn('Could not remove the push subscription', error);
  }
  await subscription.unsubscribe().catch(() => false);
}

/**
 * After a sign-in: when this browser already has notifications on (a PushSubscription and the permission), the subscription goes to
 * the server again for the new session. Nothing is asked of the member, nothing is created; a server without Web Push (404) or a
 * failed call changes nothing (the next sign-in tries again).
 */
export async function relinkWebPushAfterSignIn(): Promise<'relinked' | 'none' | 'unavailable' | 'failed'> {
  if (webPushPermission() !== 'granted') return 'none';
  const subscription = await currentSubscription();
  if (!subscription) return 'none';
  try {
    const outcome = await savePushSubscription(subscriptionBody(subscription));
    return outcome === 'saved' ? 'relinked' : 'unavailable';
  } catch (error) {
    console.warn('Could not link the push subscription to this session', error);
    return 'failed';
  }
}

/**
 * A sign-in is the session becoming a member's after none, or another member's: the restored session of a reload is not one (its
 * subscription is already linked).
 */
export function isSignIn(
  before: { status: string; member: { id: string } | null },
  after: { status: string; member: { id: string } | null },
): boolean {
  if (after.status !== 'member' || !after.member) return false;
  if (before.status === 'guest') return true;
  return before.status === 'member' && before.member !== null && before.member.id !== after.member.id;
}

if (isWeb) {
  beforeSignOut(dropWebPushAtSignOut);
  useSessionStore.subscribe((state, previous) => {
    if (isSignIn(previous, state)) void relinkWebPushAfterSignIn();
  });
}
