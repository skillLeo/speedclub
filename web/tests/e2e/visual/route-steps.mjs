// Route steps of the visual matrix (routes.mjs `prepare` and `walk`, DQ-1213). Some screens hold state that no URL can set: an e-mail
// code attempt kept in the app's memory (AUTH-13), a sheet that opens on a tap (REAUTH), a gate only app-config opens (SYS-01/02), an
// answer the server gives only after minutes (a locked code). A route reaches such a state the way flows/m46-shots.spec.ts does:
//   prepare(ctx)  before the route loads: stage API answers with `ctx.stage(pattern, answer)`.
//   walk(ctx)     after the route loaded, before its ready element: fill, press, wait, as a member would.
// ctx = { page, cell, stage, baseUrl }. Everything staged is removed when the cell ends (run.mjs parks the page: unstage), so no
// answer outlives its cell on a kept page. A staged answer is the harness's, not the server's: a staged 5xx or 429 is no `server-error`
// and no rate-limit finding (run.mjs skips the requests in `staged`); a `patch` answer passes the server's own status through.

/**
 * @typedef {object} StagedAnswer
 * @property {string} [method] only requests of this method; others go on to the server (or an earlier staged answer)
 * @property {number} [status] HTTP status of the staged answer (default 200)
 * @property {unknown} [body] its JSON body
 * @property {Record<string, string>} [headers] extra headers (e.g. Retry-After)
 * @property {string} [abort] a network error instead of an answer, as Playwright names them ('internetdisconnected', 'failed')
 * @property {(body: any) => unknown} [patch] the server's own JSON answer, changed: the function's return value, or the body it changed
 */

/**
 * @typedef {object} RouteStepContext
 * @property {import('@playwright/test').Page} page the cell's page
 * @property {import('./matrix.mjs').Cell} cell
 * @property {(pattern: string|RegExp, answer: StagedAnswer) => Promise<void>} stage
 * @property {string} baseUrl
 */

/**
 * The `stage` function of a page. Requests answered from the stage (not `patch`) go into `staged`.
 * @param {import('@playwright/test').Page} page
 * @param {WeakSet<import('@playwright/test').Request>} staged
 */
export function stagerFor(page, staged) {
  return async (/** @type {string|RegExp} */ pattern, /** @type {StagedAnswer} */ answer) => {
    const known = ['method', 'status', 'body', 'headers', 'abort', 'patch'];
    const unknown = Object.keys(answer).filter((key) => !known.includes(key));
    if (unknown.length) throw new Error(`stage(${String(pattern)}): unknown field(s) ${unknown.join(', ')}`);
    if ([answer.abort !== undefined, answer.patch !== undefined, answer.body !== undefined || answer.status !== undefined].filter(Boolean).length > 1) {
      throw new Error(`stage(${String(pattern)}): give one of abort, patch or status/body`);
    }
    await page.route(pattern, async (route) => {
      const request = route.request();
      if (answer.method && request.method() !== answer.method.toUpperCase()) return route.fallback();
      if (answer.patch) {
        const response = await route.fetch();
        const body = await response.json();
        const changed = answer.patch(body);
        return route.fulfill({ response, json: changed === undefined ? body : changed });
      }
      staged.add(request);
      if (answer.abort) return route.abort(answer.abort);
      return route.fulfill({
        status: answer.status ?? 200,
        headers: answer.headers,
        contentType: 'application/json',
        body: JSON.stringify(answer.body ?? {}),
      });
    });
  };
}

/**
 * Removes every staged answer of a page (handlers still running are not waited for).
 * @param {import('@playwright/test').Page} page
 */
export async function unstage(page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}
