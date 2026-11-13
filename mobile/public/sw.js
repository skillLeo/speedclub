/*
 * SPEED CLUB member web service worker (09 §8.13), scope /app/. scripts/export-web.mjs fills in VERSION and PRECACHE
 * (scripts/pwa-shell.js) for each export, so every new export is a new worker and the app offers "Neu laden".
 *
 * - Precache: the shell only (the /app/ document as the offline fallback, the entry bundle, the two preloaded faces, the
 *   manifest and its icons).
 * - Fingerprinted files (/app/_expo/static/, /app/assets/): cache first, in this version's cache, cleared on the next version.
 * - Pages: network first; offline, the cached shell answers. A page response is never stored (it can carry a share head or a
 *   preview token's frame).
 * - The API (/api/), the admin and every other origin are never touched: no authenticated answer can end up in a cache.
 * - Web Push (ADR-452): `push` shows the notification, `notificationclick` opens its member-web route through LINK_ROUTES (the
 *   ready rows of src/features/shell/linkMap.ts; tests/pwa/serviceWorker.test.ts keeps them equal).
 * - A new version waits until the app sends {type: 'SKIP_WAITING'} ("Neu laden"), so no open page runs on mixed files.
 */
'use strict';

const VERSION = 'sc-dev';
const PRECACHE = /*sc:precache*/ [];
const BASE = '/app/';
const SHELL_CACHE = 'sc-shell-' + VERSION;
const ASSET_CACHE = 'sc-assets-' + VERSION;
const FINGERPRINTED = [BASE + '_expo/static/', BASE + 'assets/'];
/** Public path → member web route, for notification links (linkMap.ts LINK_MAP, ready rows). */
const LINK_ROUTES = [
  ['/v/', '/app/v/'],
  ['/c/', '/app/c/'],
  ['/C/', '/app/c/'],
  ['/u/', '/app/u/'],
  ['/b/', '/app/b/'],
  ['/brands/', '/app/brands/'],
  ['/e/', '/app/events/'],
  ['/auth/magic', '/app/auth/magic'],
  ['/settings/security/activity', '/app/settings/security/activity'],
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('sc-') && key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isFingerprinted(pathname) {
  return FINGERPRINTED.some((prefix) => pathname.startsWith(prefix));
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = (await cache.match(request)) || (await caches.match(request, { cacheName: SHELL_CACHE }));
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const shell = await caches.match(BASE, { cacheName: SHELL_CACHE });
    if (shell) return shell;
    throw error;
  }
}

async function networkFirstFile(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const hit = await caches.match(request, { cacheName: SHELL_CACHE });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other origins (media hosts, map tiles) and everything outside /app/ (the API above all) go straight to the network.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (url.pathname === BASE + 'sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (isFingerprinted(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirstFile(request));
  }
});

/**
 * A notification's address as a member-web route on this origin: an app route stays, a public link (/v/…, /c/…) becomes its app
 * route, anything else (another origin, an unknown path, no address) opens the app's start.
 */
function routeFor(link) {
  if (typeof link !== 'string' || link === '') return BASE;
  let url;
  try {
    url = new URL(link, self.location.origin);
  } catch {
    return BASE;
  }
  if (url.origin !== self.location.origin) return BASE;
  const rest = url.search + url.hash;
  if (url.pathname === '/app' || url.pathname.startsWith(BASE)) return url.pathname + rest;
  for (const [from, to] of LINK_ROUTES) {
    const prefix = from.endsWith('/');
    if (prefix ? url.pathname.startsWith(from) && url.pathname.length > from.length : url.pathname === from) {
      return to + url.pathname.slice(from.length) + rest;
    }
  }
  return BASE;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const title = typeof payload.title === 'string' && payload.title !== '' ? payload.title : 'SPEED CLUB';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: BASE + 'pwa/icon-192.png',
      badge: BASE + 'pwa/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      lang: typeof payload.lang === 'string' ? payload.lang : undefined,
      data: { route: routeFor(data.url || payload.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).pathname.startsWith(BASE) || new URL(client.url).pathname === '/app');
      if (open) {
        // The open app navigates itself (expo-router keeps its stacks); see src/features/pwa/serviceWorker.ts.
        open.postMessage({ type: 'sc:navigate', route });
        return open.focus();
      }
      return self.clients.openWindow(route);
    }),
  );
});
