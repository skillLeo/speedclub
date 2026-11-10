#!/usr/bin/env node
/**
 * The site as production serves it, on https://localhost:8443, for Lighthouse CI only (ADR proposed in the M1.9 performance report).
 *
 * Transport. Production is HTTPS-only (05_ARCHITECTURE section 19, host requirements), and browsers speak HTTP/2 to such a host. The
 * local Apache on :8080 speaks plain HTTP/1.1, which Lighthouse's simulated slow 4G models as six cold TCP connections. This front
 * terminates TLS, speaks HTTP/2 to the browser, gzips text like the host's mod_deflate, and rewrites the backend origins in text
 * bodies to its own, as APP_URL=https://... would produce.
 *
 * Application. Pages come from a separate PHP instance of the same checkout, configured the way 05_ARCHITECTURE section 19 deploys:
 * APP_ENV=production, APP_DEBUG=false and `php artisan optimize` (config, route, event and view caches). Its caches live in
 * .lighthouseci/app (gitignored) through APP_CONFIG_CACHE, APP_ROUTES_CACHE, APP_EVENTS_CACHE and VIEW_COMPILED_PATH, so the dev
 * server on :8080 and every Pest run keep reading the code and .env as they are: a config cache in bootstrap/cache would also point
 * a concurrent test run at the dev database. Same database, same .env otherwise. Files that exist under public/ (build assets, photos,
 * media) still come from the Apache on :8080 with its headers, exactly as the browser gets them there.
 *
 * lhci starts this script (collect.startServerCommand) and ends it with its process tree; the PHP instance goes with it, and the
 * next start replaces the cache directory.
 *
 *   SPEEDCLUB_LHCI_BACKEND   Apache origin for static files (default http://localhost:8080)
 *   SPEEDCLUB_LHCI_TLS_PORT  port of this front (default 8443)
 *   SPEEDCLUB_LHCI_APP_PORT  port of the production-like PHP instance (default 8091)
 *   SPEEDCLUB_LHCI_APP=dev   send pages to the dev server too (for comparison only; not what the gate measures)
 *   PHP                      PHP binary (default php on PATH)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = normalize(join(here, '..', '..', '..'));
const publicDir = join(webDir, 'public');
const backend = new URL(process.env.SPEEDCLUB_LHCI_BACKEND || 'http://localhost:8080');
const port = Number(process.env.SPEEDCLUB_LHCI_TLS_PORT || 8443);
const appPort = Number(process.env.SPEEDCLUB_LHCI_APP_PORT || 8091);
const useApp = process.env.SPEEDCLUB_LHCI_APP !== 'dev';
const app = new URL(`http://localhost:${appPort}`);
const front = `https://localhost:${port}`;
const certDir = join(webDir, '.lighthouseci', 'tls');
const appDir = join(webDir, '.lighthouseci', 'app');
const MAX_CERT_AGE_MS = 20 * 24 * 60 * 60 * 1000;

const TEXT = /^(text\/|application\/(javascript|json|ld\+json|xml|manifest\+json)|image\/svg\+xml)/i;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings']);

function openssl() {
  const candidates = [process.env.OPENSSL, 'openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/xampp/apache/bin/openssl.exe'];

  const present = candidates.filter(/** @returns {candidate is string} */ (/** @type {string | undefined} */ candidate) => Boolean(candidate));

  for (const candidate of present) {
    if (spawnSync(candidate, ['version'], { encoding: 'utf8' }).status === 0) return candidate;
  }

  throw new Error('tls-front: no openssl found (set OPENSSL to its path)');
}

/** A throwaway self-signed certificate for localhost, outside the repository's tracked files (.lighthouseci is gitignored). */
function certificate() {
  const key = join(certDir, 'localhost-key.pem');
  const cert = join(certDir, 'localhost-cert.pem');

  if (!existsSync(cert) || !existsSync(key) || Date.now() - statSync(cert).mtimeMs > MAX_CERT_AGE_MS) {
    mkdirSync(certDir, { recursive: true });
    const result = spawnSync(
      openssl(),
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      { encoding: 'utf8' },
    );

    if (result.status !== 0) throw new Error(`tls-front: openssl failed: ${result.stderr}`);
  }

  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/**
 * Production settings of 05_ARCHITECTURE section 19, with every cache file outside bootstrap/cache and storage/framework/views.
 * The APP_*_CACHE paths are relative to web/: Laravel takes only "/" or "\" as the start of an absolute one, not "C:\".
 */
const appEnv = {
  ...process.env,
  APP_ENV: 'production',
  APP_DEBUG: 'false',
  APP_URL: app.origin,
  APP_CONFIG_CACHE: '.lighthouseci/app/config.php',
  APP_ROUTES_CACHE: '.lighthouseci/app/routes.php',
  APP_EVENTS_CACHE: '.lighthouseci/app/events.php',
  VIEW_COMPILED_PATH: join(appDir, 'views'),
};
const php = process.env.PHP || 'php';
/** @type {import('node:child_process').ChildProcessByStdio<null, null, import('node:stream').Readable> | null} */
let appProcess = null;
let appLog = '';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`tls-front: ${message}`);
  appProcess?.kill();
  process.exit(1);
}

async function startApp() {
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(join(appDir, 'views'), { recursive: true });

  const optimize = spawnSync(php, ['artisan', 'optimize'], { cwd: webDir, env: appEnv, encoding: 'utf8' });

  if (optimize.status !== 0) fail(`php artisan optimize failed:\n${optimize.stdout}${optimize.stderr}`);
  if (!existsSync(join(webDir, appEnv.APP_CONFIG_CACHE)) || existsSync(join(webDir, 'bootstrap', 'cache', 'config.php'))) {
    fail('the config cache did not land in .lighthouseci/app only');
  }

  // The built-in server answers one request at a time: enough for one Lighthouse page load, whose only PHP requests are the document
  // and robots.txt. OPcache as on the host, with a segment of its own: on Windows every PHP process of one user and SAPI shares a
  // segment unless opcache.cache_id differs, and the CLI one is shared with every test run on this PC (full, so nothing is cached).
  appProcess = spawn(
    php,
    // Laravel's router script takes the working directory as the document root.
    [
      '-d', 'opcache.enable=1', '-d', 'opcache.cache_id=speedclub-lhci', '-d', 'display_errors=0',
      '-S', `127.0.0.1:${appPort}`, '-t', publicDir, join(webDir, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php'),
    ],
    { cwd: publicDir, env: appEnv, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  // Drained, or a full pipe would stall the server; the tail explains a failed start.
  appProcess.stderr.on('data', (chunk) => {
    appLog = (appLog + chunk.toString()).slice(-4000);
  });
  appProcess.on('exit', (code) => {
    if (!stopping) fail(`the PHP instance ended (code ${code}):\n${appLog}`);
  });

  const get = (/** @type {string} */ path) =>
    new Promise((resolve) => {
      const probe = http.get({ hostname: '127.0.0.1', port: appPort, path, headers: { host: app.host } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      probe.on('error', () => resolve(0));
      probe.setTimeout(30000, () => probe.destroy());
    });

  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await get('/up');

    if (status === 200) {
      // A host serves warm code: the first request after a start compiles the framework into OPcache, the measured ones should not.
      for (const path of ['/', '/robots.txt']) {
        const warm = await get(path);

        if (warm !== 200) fail(`GET ${path} on the PHP instance answered ${warm}:\n${appLog}`);
      }

      return;
    }

    if (status !== 0) fail(`GET /up on the PHP instance answered ${status}:\n${appLog}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`the PHP instance did not answer on ${appPort}:\n${appLog}`);
}

/**
 * A request for a file that exists under public/ goes to Apache; everything else is a route of the application.
 *
 * @param {string} url
 */
function isPublicFile(url) {
  let path;

  try {
    path = decodeURIComponent(new URL(url, 'http://front').pathname);
  } catch {
    return false;
  }

  if (path.endsWith('/') || path.toLowerCase().endsWith('.php')) return false;

  const file = normalize(join(publicDir, path));

  if (!file.startsWith(publicDir + sep)) return false;

  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Each upstream gets its own Host header, so every absolute URL it writes starts with its origin (JSON-LD escapes the slashes).
const origins = useApp ? [backend.origin, app.origin] : [backend.origin];
const rewrite = (/** @type {string} */ text) =>
  origins.reduce((out, origin) => out.split(origin).join(front).split(origin.replaceAll('/', '\\/')).join(front.replaceAll('/', '\\/')), text);

const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });

/**
 * Typed as the compatibility API that http2.createSecureServer declares for its handler; the HTTP/1.1 objects of allowHTTP1 offer the
 * same members used here (url, method, headers, pipe; writeHead, end, headersSent).
 *
 * @param {import('node:http2').Http2ServerRequest} req
 * @param {import('node:http2').Http2ServerResponse} res
 */
function handle(req, res) {
  const target = !useApp || isPublicFile(req.url) ? { hostname: backend.hostname, port: backend.port, host: backend.host } : { hostname: '127.0.0.1', port: appPort, host: app.host };
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const headers = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (name.startsWith(':') || HOP_BY_HOP.has(name) || name === 'host' || name === 'accept-encoding') continue;
    headers[name] = value;
  }

  headers.host = target.host;
  // Identity from the upstream: text is rewritten and compressed here, everything else is already compressed (WebP, WOFF2).
  headers['accept-encoding'] = 'identity';

  const upstream = http.request(
    { protocol: 'http:', hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers, agent },
    (response) => {
      /** @type {import('node:http').OutgoingHttpHeaders} */
      const out = {};

      for (const [name, value] of Object.entries(response.headers)) {
        if (HOP_BY_HOP.has(name) || value === undefined) continue;
        out[name] = name === 'location' ? rewrite(String(value)) : value;
      }

      const type = String(response.headers['content-type'] || '');

      if (!TEXT.test(type) || req.method === 'HEAD') {
        res.writeHead(response.statusCode || 502, out);
        response.pipe(res);

        return;
      }

      /** @type {Buffer[]} */
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let body = Buffer.from(rewrite(Buffer.concat(chunks).toString('utf8')), 'utf8');

        delete out['content-length'];
        delete out['content-encoding'];

        if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && body.length >= 256) {
          body = gzipSync(body, { level: 6 });
          out['content-encoding'] = 'gzip';
        }

        out['content-length'] = String(body.length);
        res.writeHead(response.statusCode || 502, out);
        res.end(body);
      });
    },
  );

  upstream.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`tls-front: upstream ${target.host} not reachable (${error.code || error.message})`);
  });

  req.pipe(upstream);
}

let stopping = false;
const stop = () => {
  stopping = true;
  appProcess?.kill();
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', () => appProcess?.kill());

const server = http2.createSecureServer({ ...certificate(), allowHTTP1: true }, handle);

server.on('error', (/** @type {NodeJS.ErrnoException} */ error) => fail(`cannot listen on ${port}: ${error.code || error.message}`));

if (useApp) await startApp();

server.listen(port, 'localhost', () => {
  console.log(`tls-front ready: ${front} -> ${useApp ? `pages ${app.origin} (production settings), files ` : ''}${backend.origin}`);
});
