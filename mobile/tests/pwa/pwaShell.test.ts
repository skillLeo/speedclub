/**
 * 09 §8.13 / §7.15: the member web's home-screen shell. public/manifest.webmanifest, public/index.html and public/pwa/ cannot import
 * tokens, so this keeps them equal to the tokens and to each other; the export steps of scripts/pwa-shell.js are checked on
 * a made-up export.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LINK_MAP } from '@/features/shell/linkMap';
import { defaultTheme, themes } from '@/theme/tokens.generated';

import {
  BASE,
  IPHONE_STARTUP_SCREENS,
  injectServiceWorker,
  injectStartupImages,
  shellFiles,
  SHELL_STATIC,
  startupFileName,
  STARTUP_MARKER,
} from '../../scripts/pwa-shell';

const MOBILE = join(__dirname, '..', '..');
const PUBLIC = join(MOBILE, 'public');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
  id: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; purpose: string }[];
};
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const worker = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the web app manifest', () => {
  it('is the standalone app of /app/ in the Carbon canvas', () => {
    expect(manifest).toMatchObject({ id: BASE, start_url: BASE, scope: BASE, display: 'standalone' });
    expect(manifest.background_color).toBe(themes[defaultTheme].color.bg.canvas);
    expect(manifest.theme_color).toBe(themes[defaultTheme].color.bg.canvas);
  });

  it('names icons that exist at their stated size, 192 and 512 and a maskable one', () => {
    for (const icon of manifest.icons) {
      const file = join(PUBLIC, icon.src.slice(BASE.length));
      expect(existsSync(file)).toBe(true);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width, height });
    }
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  });

  it('every static shell file is in public/', () => {
    for (const file of SHELL_STATIC) expect(existsSync(join(PUBLIC, file))).toBe(true);
    expect(pngSize(join(PUBLIC, 'pwa', 'apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
  });
});

describe('index.html as a home-screen app (09 §7.15)', () => {
  it('links the manifest and the touch icon and asks for the iOS standalone chrome', () => {
    expect(html).toContain('<link rel="manifest" href="/app/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/app/pwa/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('-webkit-tap-highlight-color: transparent;');
    expect(html).toContain('overscroll-behavior: none;');
  });

  it('gets one startup image per iPhone screen at the marker, each one drawn at its device size', () => {
    expect(html).toContain(STARTUP_MARKER);
    const injected = injectStartupImages(html);
    expect(injected).not.toContain(STARTUP_MARKER);
    for (const screen of IPHONE_STARTUP_SCREENS) {
      const name = startupFileName(screen);
      expect(injected).toContain(
        `media="screen and (device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)" href="/app/pwa/${name}"`,
      );
      expect(pngSize(join(PUBLIC, 'pwa', name))).toEqual({ width: screen.width * screen.ratio, height: screen.height * screen.ratio });
    }
    expect(() => injectStartupImages('<html></html>')).toThrow(/marker/);
  });
});

describe('the service worker precache (scripts/pwa-shell.js)', () => {
  const exported = [
    '<html><head>',
    '<link rel="preload" href="/app/assets/assets/fonts/web/Inter-Medium.abc.woff2" as="font" crossorigin />',
    '</head><body><script src="/app/_expo/static/js/web/entry-1234.js" defer></script></body></html>',
  ].join('');
  const files = ['index.html', '_expo/static/js/web/entry-1234.js', 'assets/assets/fonts/web/Inter-Medium.abc.woff2', 'sw.js', ...SHELL_STATIC];

  it('holds the shell only: the document, what the index loads, the manifest and its icons', () => {
    expect(shellFiles(exported, files)).toEqual([
      BASE,
      '/app/_expo/static/js/web/entry-1234.js',
      '/app/assets/assets/fonts/web/Inter-Medium.abc.woff2',
      ...SHELL_STATIC.map((file) => BASE + file),
    ]);
  });

  it('refuses an index that loads what the export lacks, and an export without the manifest', () => {
    expect(() => shellFiles(exported, files.filter((file) => !file.startsWith('_expo')))).toThrow(/does not contain/);
    expect(() => shellFiles(exported, files.filter((file) => file !== 'manifest.webmanifest'))).toThrow(/manifest/);
  });

  it('writes the list and a version that changes with the files, never with nothing', () => {
    const one = injectServiceWorker(worker, ['/app/', '/app/a.js']);
    const same = injectServiceWorker(worker, ['/app/', '/app/a.js']);
    const other = injectServiceWorker(worker, ['/app/', '/app/b.js']);
    expect(one).toBe(same);
    expect(one).not.toBe(other);
    expect(one).toContain('const PRECACHE = ["/app/","/app/a.js"];');
    expect(one).toMatch(/const VERSION = '[0-9a-f]{12}';/);
    expect(() => injectServiceWorker('self.x = 1;', [])).toThrow(/VERSION/);
  });
});

type Listener = (event: Record<string, unknown>) => void;

/** public/sw.js in a stand-in worker scope; its handlers and `routeFor`. */
function loadWorker() {
  const listeners = new Map<string, Listener>();
  const scope = {
    location: { origin: 'https://speedclub.example' },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    clients: { matchAll: jest.fn(async () => []), openWindow: jest.fn(async () => null), claim: jest.fn() },
    registration: { showNotification: jest.fn(async () => undefined) },
    skipWaiting: jest.fn(),
  };
  const exports = new Function('self', 'caches', 'fetch', `${worker}\nreturn { routeFor, LINK_ROUTES };`)(scope, {}, jest.fn()) as {
    routeFor: (link: unknown) => string;
    LINK_ROUTES: [string, string][];
  };
  return { ...exports, listeners, scope };
}

describe('the service worker (public/sw.js)', () => {
  const { routeFor, LINK_ROUTES, listeners, scope } = loadWorker();

  it('maps exactly the ready public paths of the link map to their member-web routes', () => {
    const ready = LINK_MAP.filter((entry) => entry.ready).map((entry) => {
      const prefix = entry.public.split('{')[0] ?? '';
      return [prefix, `/app${entry.route.split('[')[0] ?? ''}`];
    });
    // The printed sticker's uppercase /C/ (M1.7) on top.
    expect(LINK_ROUTES).toEqual(expect.arrayContaining(ready));
    expect(LINK_ROUTES.filter(([from]) => from !== '/C/')).toHaveLength(ready.length);
  });

  it('opens app routes, public links as their routes, and nothing foreign', () => {
    expect(routeFor('/v/r34-bayside?ref=push')).toBe('/app/v/r34-bayside?ref=push');
    expect(routeFor('https://speedclub.example/C/AB12CD')).toBe('/app/c/AB12CD');
    expect(routeFor('/app/messages/01J')).toBe('/app/messages/01J');
    expect(routeFor('/settings/security/activity?event=01J')).toBe('/app/settings/security/activity?event=01J');
    expect(routeFor('https://evil.example/app/v/x')).toBe('/app/');
    expect(routeFor('/admin/members')).toBe('/app/');
    expect(routeFor('/v/')).toBe('/app/');
    expect(routeFor(undefined)).toBe('/app/');
  });

  it('shows a push with its title, body and route, and falls back to the brand name', async () => {
    let waited: Promise<unknown> | null = null;
    listeners.get('push')?.({
      data: { json: () => ({ title: 'Neues Update', body: 'Jann hat seinen R34 aktualisiert.', data: { url: '/v/r34' } }) },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    });
    await waited;
    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      'Neues Update',
      expect.objectContaining({ body: 'Jann hat seinen R34 aktualisiert.', data: { route: '/app/v/r34' } }),
    );
    listeners.get('push')?.({ data: null, waitUntil: () => undefined });
    expect(scope.registration.showNotification).toHaveBeenLastCalledWith('SPEED CLUB', expect.objectContaining({ data: { route: '/app/' } }));
  });

  it('sends an open app to the route, and opens a window when none is open', async () => {
    const close = jest.fn();
    let waited: Promise<unknown> | null = null;
    const click = () =>
      listeners.get('notificationclick')?.({
        notification: { close, data: { route: '/app/v/r34' } },
        waitUntil: (promise: Promise<unknown>) => {
          waited = promise;
        },
      });
    click();
    await waited;
    expect(close).toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/app/v/r34');

    const open = { url: 'https://speedclub.example/app/garage', postMessage: jest.fn(), focus: jest.fn(async () => undefined) };
    scope.clients.matchAll.mockResolvedValueOnce([open] as never);
    click();
    await waited;
    expect(open.postMessage).toHaveBeenCalledWith({ type: 'sc:navigate', route: '/app/v/r34' });
    expect(open.focus).toHaveBeenCalled();
  });

  it('leaves the API, other origins and writes to the network', () => {
    const respondWith = jest.fn();
    const fetchHandler = listeners.get('fetch');
    for (const request of [
      { method: 'GET', url: 'https://speedclub.example/api/v1/me', mode: 'cors' },
      { method: 'GET', url: 'https://media.example/x.jpg', mode: 'no-cors' },
      { method: 'POST', url: 'https://speedclub.example/app/x', mode: 'cors' },
      { method: 'GET', url: 'https://speedclub.example/app/sw.js', mode: 'same-origin' },
    ]) {
      fetchHandler?.({ request, respondWith });
    }
    expect(respondWith).not.toHaveBeenCalled();
    fetchHandler?.({ request: { method: 'GET', url: 'https://speedclub.example/app/garage', mode: 'navigate' }, respondWith });
    expect(respondWith).toHaveBeenCalledTimes(1);
  });
});
