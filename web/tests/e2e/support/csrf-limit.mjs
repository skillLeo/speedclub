// SEC-P1-53 limits GET /sanctum/csrf-cookie per client address (30 a minute, ::1 counts as ::/64; LimitCsrfCookieRequests), and every
// browser context of a run is a new client without a cookie from this one machine: a full run asks more often a minute than any member
// does. A 429 of it clears that limit, and only that one (backend.php reset-csrf-limit), and the request goes once more; a second 429
// reaches the page. The limit itself is the server's and stays (Pest covers it); only the shared address is the harness's.
import { resetCsrfLimit } from './backend.mjs';

const CSRF_COOKIE = /\/sanctum\/csrf-cookie(\?.*)?$/;

/**
 * Routes the context's CSRF cookie requests as described above. An offline page keeps its failure: route.fetch() would bypass the
 * offline emulation, so a request of a page that reads navigator.onLine false (or cannot be asked) takes the normal way.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function routeCsrfCookie(context) {
  await context.route(CSRF_COOKIE, async (route) => {
    const online = await route
      .request()
      .frame()
      .evaluate(() => navigator.onLine)
      .catch(() => false);
    if (!online) return route.fallback();
    let response = await route.fetch();
    if (response.status() === 429) {
      await resetCsrfLimit();
      response = await route.fetch();
    }
    await route.fulfill({ response });
  });
}
