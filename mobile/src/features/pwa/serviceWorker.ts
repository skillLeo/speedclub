/**
 * The member web's service worker (09 §8.13; public/sw.js, filled in per export by scripts/pwa-shell.js): registration, the
 * "Neue Version verfügbar" state, and the open-a-route message of a notification tap.
 *
 * Only an exported build registers it (`__DEV__` is false there): a dev server's bundle changes on every save and would only
 * fight the cache. Native has no service worker at all, and every function here is a no-op there.
 *
 * Outside production, `window.__scPwa` lets the e2e spec and the visual matrix show the update state without building a second
 * export (`simulateUpdate()`), and read what was registered (`registered()`).
 */
import { useSyncExternalStore } from 'react';

import { isWeb } from '@/lib/platform';

/** The export's base path (app.config.ts experiments.baseUrl), with one trailing slash. */
export const APP_BASE = `${(process.env.EXPO_BASE_URL ?? '/app').replace(/\/+$/, '')}/`;
export const SERVICE_WORKER_URL = `${APP_BASE}sw.js`;
/** After the tab comes back, at most this often: a check is a request for sw.js. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;

export type PwaUpdateState = { waiting: boolean };

let state: PwaUpdateState = { waiting: false };
let waitingWorker: Pick<ServiceWorker, 'postMessage'> | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let reloadOnTakeover = false;
const listeners = new Set<() => void>();

function publish(next: PwaUpdateState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function pwaUpdateState(): PwaUpdateState {
  return state;
}

export function subscribePwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePwaUpdate(): PwaUpdateState {
  return useSyncExternalStore(subscribePwaUpdate, pwaUpdateState, pwaUpdateState);
}

/** Whether this browser can run the worker at all. */
export function serviceWorkerSupported(): boolean {
  return isWeb && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && window.isSecureContext;
}

function offer(worker: Pick<ServiceWorker, 'postMessage'>): void {
  waitingWorker = worker;
  publish({ waiting: true });
}

/** "Neu laden": the waiting worker takes over, and the page reloads once it controls it, so no page runs on mixed files. */
export function applyPwaUpdate(): void {
  const worker = waitingWorker;
  if (!worker) return;
  waitingWorker = null;
  publish({ waiting: false });
  reloadOnTakeover = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
}

function watch(found: ServiceWorkerRegistration): void {
  registration = found;
  // A worker already waiting from an earlier visit: only an update when a worker controls this page now.
  if (found.waiting && navigator.serviceWorker.controller) offer(found.waiting);
  found.addEventListener('updatefound', () => {
    const installing = found.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) offer(installing);
    });
  });
}

let lastCheck = 0;
function checkForUpdate(): void {
  if (!registration || document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
  lastCheck = Date.now();
  registration.update().catch(() => undefined);
}

type NavigateMessage = { type: 'sc:navigate'; route: string };

function isNavigateMessage(data: unknown): data is NavigateMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'sc:navigate' && typeof (data as { route?: unknown }).route === 'string';
}

/**
 * The app route of a notification's member-web address (`/app/v/x?y` → `/v/x?y`); anything outside the app base is the start.
 * The worker already resolved the public link (public/sw.js routeFor), this only strips the base.
 */
export function appRouteOf(route: string, base: string = APP_BASE): string {
  const trimmed = base.replace(/\/$/, '');
  if (route === trimmed || route === base) return '/';
  return route.startsWith(base) ? `/${route.slice(base.length)}` : '/';
}

/**
 * Registers the worker once per page. `navigate` receives the app route of a tapped notification while this page is open
 * (the worker focuses the page and posts it; a closed app opens at the route directly).
 */
export function startServiceWorker(navigate: (route: string) => void): void {
  if (started || __DEV__ || !serviceWorkerSupported()) return;
  started = true;
  const container = navigator.serviceWorker;
  container.addEventListener('controllerchange', () => {
    if (reloadOnTakeover) window.location.reload();
  });
  container.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isNavigateMessage(event.data)) navigate(appRouteOf(event.data.route));
  });
  container
    .register(SERVICE_WORKER_URL, { scope: APP_BASE, updateViaCache: 'none' })
    .then(watch)
    .catch((error: unknown) => console.warn('The service worker did not register', error));
  document.addEventListener('visibilitychange', checkForUpdate);
}

/** The registration, once there is one (Web Push subscribes through it). */
export async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported()) return null;
  if (registration) return registration;
  if (__DEV__) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(APP_BASE)) ?? null;
  } catch {
    return null;
  }
}

type PwaTestHook = { simulateUpdate: () => void; registered: () => Promise<string | null> };

if (process.env.EXPO_PUBLIC_APP_ENV !== 'production' && isWeb && typeof window !== 'undefined') {
  const hook: PwaTestHook = {
    // A stand-in for a waiting worker: "Neu laden" reloads the page as the real takeover would.
    simulateUpdate: () =>
      offer({
        postMessage: () => {
          window.location.reload();
        },
      }),
    registered: async () => {
      const found = await serviceWorkerRegistration();
      return found?.active?.scriptURL ?? found?.installing?.scriptURL ?? found?.waiting?.scriptURL ?? null;
    },
  };
  (window as unknown as { __scPwa?: PwaTestHook }).__scPwa = hook;
}
