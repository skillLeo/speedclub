// Keeps the visual runner inside the server's own rate limits.
//
// Every request of the matrix comes from one address, and the limits of 02_PRODUCT_SPEC section 8 count per address for guests
// and for public reads (public_read: 300 a minute, app-config on every page of the app included; search: 60 a minute). A
// runner that photographs 250 screens a minute goes past them, and then the server answers 429 and the screen shows its error
// state where the matrix expects data. The limits are right; the runner has to stay under them.
//
// Nothing here copies a number: the throttles of each route come from `artisan route:list --json`, the limits from
// config('speedclub.rate_limits'). Requests are counted per limiter in a sliding window over all workers together (stricter
// than the server's fixed window, and stricter than its per-member keys, as all of them are counted as one), a cell starts
// only when the limiters it is known to use have room for it and for the cells still running (first come, first served per
// limiter), and X-RateLimit-* headers and a 429's Retry-After correct the count for requests that came before this run (an e2e
// run right before it, for example).
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** The longest window a waiter's deadlock deadline counts in (two of them after the last progress). */
const MAX_DEADLOCK_WINDOW_MS = 10 * 60_000;
const run = promisify(execFile);
const THROTTLE = /ThrottleRequests(?:WithRedis)?:([a-z0-9_-]+)/i;
/** `throttle:60,1` (max, minutes) instead of a named limiter: the admin's search routes (M3.1). */
const PLAIN_THROTTLE = /ThrottleRequests(?:WithRedis)?:(\d+),(\d+)(?:,|$)/;
/**
 * Laravel counts every plain throttle of one user (or address) under one key, whatever the route, and each route compares that count
 * with its own maximum. The budget counts them as one limiter with the smallest maximum and the longest window: stricter than the
 * server, never looser.
 */
export const PLAIN_LIMITER = 'plain-throttle';
/** What a cell of a route not seen yet reserves on every limiter. Dropped per route after its first completed cell. */
const FIRST_GUESS = 4;
const POLL_MS = 50;

/**
 * @typedef {{ regex: RegExp, methods: string[], limiters: string[] }} ThrottledRoute
 * @typedef {{ max: number, windowMs: number }} LimitDef
 */

/**
 * Laravel route uri to a path regex: `{param}` is one segment, `{param?}` an optional one.
 * @param {string} uri
 */
export function uriToRegex(uri) {
  const parts = uri.replace(/^\/+/, '').split('/');
  let source = '';
  for (const part of parts) {
    if (/^\{[^}]+\?\}$/.test(part)) source += '(?:/[^/]+)?';
    else if (/^\{[^}]+\}$/.test(part)) source += '/[^/]+';
    else source += `/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  }
  return new RegExp(`^${source || '/'}$`, 'i');
}

/**
 * @param {{uri:string,method:string,middleware:string[]}[]} routeList output of `artisan route:list --json`
 * @param {Record<string,{max:number,minutes:number}>} config speedclub.rate_limits
 * @returns {{ routes: ThrottledRoute[], limits: Record<string, LimitDef> }}
 */
export function buildLimits(routeList, config) {
  /** @type {Record<string, LimitDef>} */
  const limits = {};
  for (const [name, def] of Object.entries(config)) {
    // Route middleware names use dashes (throttle:public-read), the config keys underscores (RateLimits::define).
    limits[name.replace(/_/g, '-')] = { max: Number(def.max), windowMs: Number(def.minutes) * 60_000 };
  }
  /** @type {ThrottledRoute[]} */
  const routes = [];
  /** @type {LimitDef|null} */
  let plain = null;
  for (const r of routeList) {
    /** @type {string[]} */
    const limiters = [];
    for (const m of r.middleware) {
      const numeric = m.match(PLAIN_THROTTLE);
      if (numeric) {
        const def = { max: Number(numeric[1]), windowMs: Number(numeric[2]) * 60_000 };
        plain = plain ? { max: Math.min(plain.max, def.max), windowMs: Math.max(plain.windowMs, def.windowMs) } : def;
        limits[PLAIN_LIMITER] = plain;
        limiters.push(PLAIN_LIMITER);
        continue;
      }
      const name = m.match(THROTTLE)?.[1];
      if (name !== undefined) limiters.push(name);
    }
    if (limiters.length === 0) continue;
    const unknown = limiters.filter((n) => !limits[n]);
    if (unknown.length) throw new Error(`Route ${r.uri} uses throttle:${unknown.join(', ')}, which speedclub.rate_limits does not define`);
    routes.push({ regex: uriToRegex(r.uri), methods: r.method.split('|'), limiters });
  }
  // Only the limiters of the given routes: the matrix reads, so a register or login limit is not its business.
  const used = new Set(routes.flatMap((r) => r.limiters));
  return { routes, limits: Object.fromEntries(Object.entries(limits).filter(([name]) => used.has(name))) };
}

/**
 * Reads the throttles from the running code base. Fails loudly: an unpaced run photographs error states.
 * @param {string} repoRoot
 */
export async function loadServerLimits(repoRoot) {
  const artisan = join(repoRoot, 'web', 'artisan');
  const opts = { cwd: join(repoRoot, 'web'), maxBuffer: 16 * 1024 * 1024 };
  const [routes, config] = await Promise.all([
    run('php', [artisan, 'route:list', '--json', '--method=GET'], opts),
    run('php', [artisan, 'tinker', "--execute=echo json_encode(config('speedclub.rate_limits'));"], opts),
  ]).catch((e) => {
    throw new Error(`Cannot read the server's rate limits (php artisan): ${e instanceof Error ? e.message : e}`);
  });
  return buildLimits(JSON.parse(routes.stdout), JSON.parse(config.stdout.trim()));
}

export class RateBudget {
  #routes;
  #limits;
  #now;
  /** @type {Map<string, number[]>} request times per limiter */
  #hits = new Map();
  /** @type {Map<string, {used:number,at:number}>} the server's own count, from X-RateLimit-* */
  #floors = new Map();
  /** @type {Map<string, number>} limiter blocked until (Retry-After of a 429) */
  #blockedUntil = new Map();
  /** @type {Map<string, Map<string, number>>} per route: the most requests one attempt made per limiter */
  #needs = new Map();
  /** @type {Set<string>} routes with a completed cell: a limiter such a cell did not use is one the route does not need */
  #learned = new Set();
  /** @type {Set<{routeId:string, counts:Map<string, number>}>} */
  #inFlight = new Set();
  /** @type {{routeId:string, since:number, resolve:(cell:{routeId:string, counts:Map<string, number>}) => void, reject:(e:Error) => void}[]} oldest first */
  #queue = [];
  /** @type {ReturnType<typeof setTimeout>|null} */
  #timer = null;
  /** When a cell last started or ended, or room last came back. */
  #lastProgress = -Infinity;
  waitedMs = 0;

  /**
   * @param {{ routes: ThrottledRoute[], limits: Record<string, LimitDef> }} defs
   * @param {{ now?: () => number }} [opts]
   */
  constructor(defs, { now = Date.now } = {}) {
    this.#routes = defs.routes;
    this.#limits = defs.limits;
    this.#now = now;
  }

  /** @param {string} method @param {string} pathname */
  limitersOf(method, pathname) {
    const m = method.toUpperCase();
    return this.#routes.find((r) => r.methods.includes(m) && r.regex.test(pathname))?.limiters ?? [];
  }

  #prune(/** @type {string} */ name) {
    const limit = this.#limits[name];
    const hits = this.#hits.get(name);
    if (!limit || !hits) return;
    const now = this.#now();
    const from = now - limit.windowMs;
    let left = 0;
    while (hits.length && /** @type {number} */ (hits[0]) <= from) {
      hits.shift();
      left++;
    }
    // Hits leaving the window make room: progress, so a waiter's deadline starts again.
    if (left) this.#lastProgress = Math.max(this.#lastProgress, now);
  }

  /** Requests counted against a limiter in its window, never below what the server last said it counted. */
  used(/** @type {string} */ name) {
    this.#prune(name);
    const limit = this.#limits[name];
    const hits = this.#hits.get(name) ?? [];
    let used = hits.length;
    const floor = this.#floors.get(name);
    const now = this.#now();
    if (limit && floor && now - floor.at < limit.windowMs) {
      used = Math.max(used, floor.used + hits.filter((t) => t > floor.at).length);
    } else if (floor) {
      // The server's count has left its window: room, and progress.
      this.#floors.delete(name);
      this.#lastProgress = Math.max(this.#lastProgress, now);
    }
    return used;
  }

  /** Never more than the limiter allows in a window: a larger need could never have room, and the cell's 429 then tells. */
  #need(/** @type {string} */ routeId, /** @type {string} */ name) {
    const seen = this.#needs.get(routeId)?.get(name) ?? 0;
    const need = this.#learned.has(routeId) ? seen : Math.max(seen, FIRST_GUESS);
    return Math.min(need, this.#limits[name]?.max ?? need);
  }

  /** The limiters that keep a cell of this route from starting now. */
  #blockers(/** @type {string} */ routeId) {
    return Object.keys(this.#limits).filter((name) => !this.#roomOn(routeId, name, this.#now()));
  }

  #roomOn(/** @type {string} */ routeId, /** @type {string} */ name, /** @type {number} */ now) {
    const limit = /** @type {LimitDef} */ (this.#limits[name]);
    const need = this.#need(routeId, name);
    if (need === 0) return true;
    if ((this.#blockedUntil.get(name) ?? 0) > now) return false;
    let reserved = 0;
    for (const cell of this.#inFlight) reserved += Math.max(0, this.#need(cell.routeId, name) - (cell.counts.get(name) ?? 0));
    return this.used(name) + reserved + need <= limit.max;
  }

  /** Whether a cell of this route may start now. */
  hasRoom(/** @type {string} */ routeId) {
    const now = this.#now();
    return Object.keys(this.#limits).every((name) => this.#roomOn(routeId, name, now));
  }

  /** The limiters a cell of this route reserves anything on. */
  #needed(/** @type {string} */ routeId) {
    return Object.keys(this.#limits).filter((name) => this.#need(routeId, name) > 0);
  }

  /**
   * Waits until the limiters of this route have room, then holds a reservation until `release`.
   *
   * Waiters are served first come, first served per limiter: a waiter starts only when no older waiter still waits for a
   * limiter it needs as well, so cells with small needs cannot take every gap from a cell with a large one. The oldest waiter
   * waits for nothing but room, and room always comes back (hits leave the window, Retry-After ends, running cells finish), so
   * the queue cannot deadlock itself; a waiter on limiters no older waiter uses is not held up at all.
   *
   * It gives up only on a real deadlock: two windows of the longest limiter after the budget last made progress (a cell
   * started or was released, hits or the server's count left the window) and after the last Retry-After on its limiters and,
   * when it queues behind older waiters, on theirs. By then every hit of this run has left the window, so nothing but cells
   * that never finish can still hold the room. That makes the deadline of a waiter never earlier than the deadline of an older
   * waiter it queues behind: the older one fails first, and then the one behind it is held up by nothing but its own limiters.
   * @param {string} routeId
   * @returns {Promise<{routeId:string, counts:Map<string, number>}>}
   */
  acquire(routeId) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ routeId, since: this.#now(), resolve, reject });
      // Synchronously: a cell with room is running before acquire returns.
      this.#schedule();
    });
  }

  /** Starts every waiter that may start, oldest first, and fails those past their deadline. */
  #schedule() {
    const now = this.#now();
    /** @type {Set<string>} limiters an older waiter is still waiting for */
    const claimed = new Set();
    for (const waiter of [...this.#queue]) {
      const needed = this.#needed(waiter.routeId);
      const behind = needed.filter((name) => claimed.has(name));
      if (behind.length === 0 && this.hasRoom(waiter.routeId)) {
        this.#queue.splice(this.#queue.indexOf(waiter), 1);
        const cell = { routeId: waiter.routeId, counts: new Map() };
        this.#inFlight.add(cell);
        this.#lastProgress = now;
        this.waitedMs += now - waiter.since;
        waiter.resolve(cell);
        continue;
      }
      const blockedTill = Math.max(0, ...[...needed, ...(behind.length ? claimed : [])].map((name) => this.#blockedUntil.get(name) ?? 0));
      // What holds it up: its limiters without room, and those an older waiter waits for. Two windows of the longest of these, not of
      // every limiter the server has (a day-long one made a stuck run wait silently for two days, round 3 of M2.8).
      const holding = [...new Set([...needed.filter((name) => !this.#roomOn(waiter.routeId, name, now)), ...behind])];
      // At most ten minutes: no page of the matrix waits for a longer window, and an unlearned route's first guess reserves room on
      // every limiter, the day-long ones included, which it may never touch.
      const longestWindow = Math.min(MAX_DEADLOCK_WINDOW_MS, Math.max(0, ...holding.map((name) => this.#limits[name]?.windowMs ?? 0)));
      const deadline = Math.max(waiter.since, this.#lastProgress, blockedTill) + 2 * longestWindow;
      if (now > deadline) {
        this.#queue.splice(this.#queue.indexOf(waiter), 1);
        waiter.reject(new Error(`Rate budget: no room for a cell of ${waiter.routeId} on ${this.#blockers(waiter.routeId).join(', ')} after ${Math.round((now - waiter.since) / 1000)} s`));
        continue;
      }
      // Claims only what it waits for: a waiter held up on one limiter must not keep every younger waiter off the limiters it has
      // room on (head-of-line blocking: one cell short of room stalled the whole queue behind it).
      for (const name of holding) claimed.add(name);
    }
    if (this.#queue.length > 0 && this.#timer === null) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#schedule();
      }, POLL_MS);
    }
  }

  /**
   * What an attempt requested only ever raises the need of its route. It drops the first guess on the other limiters only if
   * it completed: an attempt that failed early says nothing about the limiters it did not reach.
   * @param {{routeId:string, counts:Map<string, number>}} cell
   * @param {{ completed?: boolean }} [outcome]
   */
  release(cell, { completed = true } = {}) {
    this.#inFlight.delete(cell);
    const needs = this.#needs.get(cell.routeId) ?? new Map();
    for (const [name, n] of cell.counts) needs.set(name, Math.max(needs.get(name) ?? 0, n));
    this.#needs.set(cell.routeId, needs);
    if (completed) this.#learned.add(cell.routeId);
    this.#lastProgress = this.#now();
    // Its reservation is free now: the oldest waiters may use it at once.
    this.#schedule();
  }

  /**
   * A request left the browser.
   * @param {{routeId:string, counts:Map<string, number>}|null} cell
   * @param {string} method
   * @param {string} pathname
   */
  record(cell, method, pathname) {
    const now = this.#now();
    for (const name of this.limitersOf(method, pathname)) {
      const hits = this.#hits.get(name) ?? [];
      hits.push(now);
      this.#hits.set(name, hits);
      if (cell) cell.counts.set(name, (cell.counts.get(name) ?? 0) + 1);
    }
  }

  /**
   * An answer of the server: its X-RateLimit-* headers say how much of a limiter is used, a 429 blocks it for Retry-After.
   * With several limits on one route the headers describe the last one, so they count only for a limiter of that size.
   * @param {string} method
   * @param {string} pathname
   * @param {number} status
   * @param {Record<string,string>} headers lower-case names
   */
  observe(method, pathname, status, headers) {
    const now = this.#now();
    const limitHeader = Number(headers['x-ratelimit-limit']);
    const remaining = Number(headers['x-ratelimit-remaining']);
    for (const name of this.limitersOf(method, pathname)) {
      const limit = this.#limits[name];
      if (!limit) continue;
      if (status === 429) {
        const retryAfter = Number(headers['retry-after']);
        const until = now + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : limit.windowMs);
        this.#blockedUntil.set(name, Math.max(this.#blockedUntil.get(name) ?? 0, until));
      } else if (Number.isFinite(limitHeader) && Number.isFinite(remaining) && limitHeader === limit.max) {
        this.#floors.set(name, { used: limitHeader - remaining, at: now });
      }
    }
  }
}
