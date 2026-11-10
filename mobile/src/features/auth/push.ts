/**
 * Push on this device (AUTH-10, docs/reports/phase-2/m2.2-contract.md §3, 05_ARCHITECTURE §11): the OS permission, the Expo push
 * token and its place on the server. Native only; the web has e-mail and the in-app badges (03 §12).
 *
 * - The OS prompt only ever follows the primer (08 §6): `askPushPermission` is called by AUTH-10 alone.
 * - With the permission granted, the token is sent at sign-in (and at every start of a signed-in app, an idempotent upsert per
 *   device), and again whenever the OS hands out a new one.
 * - At sign-out it is deleted while the session still exists (`beforeSignOut`); the server's logout drops it too.
 * - Without an EAS project id or on a simulator there is no Expo token: the app works on, in-app and e-mail unchanged.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { beforeSignOut } from '@/api/queries/auth';
import { readNotification } from '@/api/queries/notifications';
import { deletePushToken, sendPushToken, type PushPlatform } from '@/api/queries/push';
import { isViewAsTab } from '@/api/clientViewAs';
import i18n from '@/i18n';
import { isAndroid, isIOS, isNative } from '@/lib/platform';
import { isInternalPath, useSessionStore } from '@/state/session';

export type PushPermission = 'granted' | 'undetermined' | 'denied';

/** The Android channel every push goes to (FCM's default channel). Android 13 shows the OS prompt only once a channel exists. */
export const PUSH_CHANNEL_ID = 'default';

function permissionOf(status: Notifications.NotificationPermissionsStatus): PushPermission {
  // iOS: provisional and ephemeral also deliver.
  const ios = status.ios?.status;
  if (status.granted || ios === IosAuthorizationStatus.PROVISIONAL || ios === IosAuthorizationStatus.EPHEMERAL) {
    return 'granted';
  }
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** What the OS says now. The web always answers `denied`: it has no push in V1. */
export async function readPushPermission(): Promise<PushPermission> {
  if (!isNative) return 'denied';
  try {
    return permissionOf(await Notifications.getPermissionsAsync());
  } catch (error) {
    console.warn('Could not read the notification permission', error);
    return 'denied';
  }
}

async function ensureChannel(): Promise<void> {
  if (!isAndroid) return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: i18n.t('primer.channelName', { ns: 'auth' }),
    importance: AndroidImportance.DEFAULT,
  });
}

/** The OS prompt, after the primer only. */
export async function askPushPermission(): Promise<PushPermission> {
  if (!isNative) return 'denied';
  try {
    await ensureChannel();
    return permissionOf(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }),
    );
  } catch (error) {
    console.warn('Could not ask for the notification permission', error);
    return 'denied';
  }
}

/** The EAS project id from app.config `extra.eas.projectId` (EAS_PROJECT_ID at build time), or null while there is none. */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

const platform = (): PushPlatform => (isIOS ? 'ios' : 'android');

export type PushRegistration = 'sent' | 'not_permitted' | 'unavailable' | 'failed';

/** The last token this run sent, per member, so a re-render or a second trigger does not send it twice. */
let lastSent: string | null = null;

/** Forgets what was sent, for a new member or a sign-out. */
export function resetPushRegistration(): void {
  lastSent = null;
}

/**
 * Sends this device's Expo token for the signed-in member, when the permission is granted. `devicePushToken` is the OS token a token
 * change handed over, so the Expo token is made from that one.
 */
export async function registerPushToken(devicePushToken?: Notifications.DevicePushToken): Promise<PushRegistration> {
  // View-as (m3.2-contract §3) registers no device: it is web only, and the check stays should it ever reach a native build.
  if (!isNative || isViewAsTab()) return 'unavailable';
  const { status, member } = useSessionStore.getState();
  if (status !== 'member' || !member) return 'unavailable';
  if ((await readPushPermission()) !== 'granted') return 'not_permitted';
  const projectId = easProjectId();
  if (!Device.isDevice || !projectId) return 'unavailable';
  try {
    await ensureChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId, ...(devicePushToken ? { devicePushToken } : {}) });
    const key = `${member.id}:${token}`;
    if (lastSent === key) return 'sent';
    // The member may have changed while the token was made.
    if (useSessionStore.getState().member?.id !== member.id) return 'unavailable';
    if (!(await sendPushToken(token, platform()))) return 'unavailable';
    lastSent = key;
    return 'sent';
  } catch (error) {
    console.warn('Could not register for push', error);
    return 'failed';
  }
}

/** Sign-out: the token leaves the server while the session still exists. */
export async function unregisterPushToken(): Promise<void> {
  if (!isNative || useSessionStore.getState().status !== 'member') return;
  const sent = lastSent;
  resetPushRegistration();
  if (sent === null && (await readPushPermission()) !== 'granted') return;
  try {
    await deletePushToken();
  } catch (error) {
    console.warn('Could not remove the push token', error);
  }
}

if (isNative) beforeSignOut(unregisterPushToken);

let handlerInstalled = false;

/** A push that arrives while the app is open goes to the list only: the badge says it, a banner over the screen would interrupt. */
function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  } catch (error) {
    console.warn('Could not set the notification handler', error);
  }
}

/** A subscription, or nothing where the module cannot listen (a test renderer, a build without the native module). */
function listen(subscribe: () => { remove: () => void }): () => void {
  try {
    const subscription: { remove?: unknown } | undefined = subscribe();
    return () => {
      if (typeof subscription?.remove === 'function') subscription.remove();
    };
  } catch (error) {
    console.warn('Could not listen for notifications', error);
    return () => undefined;
  }
}

/** The fields of a push's `data` the app reads: the server's internal page and the row it belongs to. */
function pushData(data: unknown): { path?: unknown; notification_id?: unknown } {
  return typeof data === 'object' && data !== null ? (data as { path?: unknown; notification_id?: unknown }) : {};
}

/**
 * The page a push opens: `data.path` when it is a path of this app ("/u/lukas.sc", "/v/{slug}", "/notifications": one leading slash,
 * no scheme, no host, also not once decoded; `isInternalPath`), else Mitteilungen.
 */
export function pushTarget(data: unknown): string {
  const { path } = pushData(data);
  return isInternalPath(path) ? path : '/notifications';
}

/** The row a push belongs to, to mark it read. */
export function pushNotificationId(data: unknown): string | null {
  const id = pushData(data).notification_id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/** Responses already opened, by the push's identifier: the cold start and the listener can both report the same tap. */
const opened = new Set<string>();

/** Forgets what was opened, for tests. */
export function resetOpenedPushes(): void {
  opened.clear();
}

/**
 * A tapped push: its row read (PATCH, through the cache), then its page. Only for a signed-in member; a guest has no rows, and the
 * sign-in would go elsewhere. Each tap opens once.
 */
export function openPushResponse(client: QueryClient, response: Notifications.NotificationResponse): boolean {
  const key = response.notification.request.identifier;
  if (opened.has(key)) return false;
  opened.add(key);
  const member = useSessionStore.getState();
  void client.invalidateQueries({ queryKey: ['notifications'] });
  if (member.status !== 'member' || !member.member) return false;
  const data = response.notification.request.content.data;
  const id = pushNotificationId(data);
  if (id) void readNotification(client, member.member.id, id);
  router.push(pushTarget(data) as Href);
  return true;
}

/**
 * In SessionHost, native only: registers the token for each member that signs in or is restored, again on a token change, and opens
 * what a tapped push points to. Every push makes the badges ask again. `ready`: the root navigator is mounted.
 *
 * A push that started the app (cold start) is not reported to a listener added later, so it is read once with
 * `getLastNotificationResponse()` (expo-notifications 58), after the session restore has decided who is signed in, and then cleared.
 */
export function usePushRegistration(ready: boolean = true): void {
  const client = useQueryClient();
  const status = useSessionStore((state) => state.status);
  const memberId = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? null) : null));
  const coldStartRead = useRef(false);

  useEffect(() => {
    if (!isNative) return undefined;
    if (memberId === null) {
      resetPushRegistration();
      return undefined;
    }
    void registerPushToken();
    return listen(() =>
      Notifications.addPushTokenListener((token) => {
        void registerPushToken(token);
      }),
    );
  }, [memberId]);

  useEffect(() => {
    if (!isNative) return undefined;
    installNotificationHandler();
    const stopReceived = listen(() =>
      Notifications.addNotificationReceivedListener(() => {
        void client.invalidateQueries({ queryKey: ['notifications'] });
      }),
    );
    const stopOpened = listen(() =>
      Notifications.addNotificationResponseReceivedListener((response) => {
        openPushResponse(client, response);
      }),
    );
    return () => {
      stopReceived();
      stopOpened();
    };
  }, [client]);

  useEffect(() => {
    if (!isNative || !ready || status === 'loading' || coldStartRead.current) return;
    coldStartRead.current = true;
    try {
      const response = Notifications.getLastNotificationResponse();
      if (!response) return;
      Notifications.clearLastNotificationResponse();
      // After the routing of this commit (a step, the primer, Welcome), so the push's page lands on top of it.
      setTimeout(() => openPushResponse(client, response), 0);
    } catch (error) {
      console.warn('Could not read the push that opened the app', error);
    }
  }, [client, ready, status]);
}
