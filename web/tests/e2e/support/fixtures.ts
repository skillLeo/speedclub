// Base test for every spec: deterministic context, no third-party network, and a test fails when
// the page throws or logs an error. Specs import { test, expect } from here, not from Playwright.
import { test as base, expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { makeContextDeterministic, qaUrl, waitForStablePage, type QaOptions } from './qa.mjs';
import { isDeletedMedia, MEDIA_PATH } from './deleted-media.mjs';
import { withStartLock } from './start-lock.mjs';
import { routeCsrfCookie } from './csrf-limit.mjs';

/**
 * A response a test provokes on purpose, such as the 422 of a wrong code, or `network` for a request it aborts. The
 * browser logs each failed response as a console error; only one that matches status and URL of an entry is let
 * through, and only in the test that names it.
 */
export type ExpectedFailure = { status: number | 'network'; url: RegExp };

type Fixtures = {
  /** Errors collected from every page of the context; checked after the test. */
  pageErrors: string[];
  /** Hosts the app tried to reach despite the no-third-party rule; must stay empty. */
  blockedRequests: string[];
  /** Declares responses this test provokes on purpose (see ExpectedFailure). */
  expectFailedResponses: (failures: ExpectedFailure[]) => void;
  /** Goes to a path with the qa* overrides and waits until the page is stable. */
  qaGoto: (path: string, options?: QaOptions) => Promise<void>;
  /** Only the rendered element with this testID (hidden tab screens stay in the DOM). */
  byTestId: (id: string) => Locator;
};

// A network failure reads `net::ERR_…` in Chromium; WebKit reports a request the offline context refused as an internal
// error, or as an offline or lost connection.
const FAILED_RESOURCE =
  /Failed to load resource: (?:the server responded with a status of (\d{3})|net::ERR_[A-Z_]+|WebKit encountered an internal error|The Internet connection appears to be offline|The network connection was lost)/;

function isExpected(message: ConsoleMessage, expected: readonly ExpectedFailure[]): boolean {
  const failed = FAILED_RESOURCE.exec(message.text());
  if (!failed) return false;
  const status = failed[1] ? Number(failed[1]) : 'network';
  const url = message.location().url;
  // The photo of a build another spec deleted on purpose (support/deleted-media.mjs), and only that.
  const media = MEDIA_PATH.exec(url);
  if (status === 404 && media?.[1] && isDeletedMedia(media[1])) return true;
  return expected.some((e) => e.status === status && e.url.test(url));
}

export const watchPageErrors = (page: Page, sink: string[], expected: readonly ExpectedFailure[] = []): void => {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Aborting third-party requests logs a network error; they are asserted through blockedRequests.
    if (m.type() === 'error' && !m.text().includes('net::ERR_BLOCKED_BY_CLIENT') && !isExpected(m, expected)) {
      sink.push(`console.error: ${m.text().slice(0, 500)} (${m.location().url})`);
    }
  });
};

export const test = base.extend<Fixtures & { expectedFailures: ExpectedFailure[]; renderProbe: void }>({
  blockedRequests: async ({ context }, use) => {
    const blocked: string[] = [];
    await makeContextDeterministic(context, { onBlocked: (url) => blocked.push(url) });
    // A publish from a page waits while a spec holds Start's Neue Builds (support/start-lock.mjs); the holder's own passes.
    await context.route(/\/api\/v1\/vehicles\/[^/]+\/publish(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await withStartLock(async () => {
        const response = await route.fetch();
        await route.fulfill({ response });
      });
    });
    await routeCsrfCookie(context);
    await use(blocked);
    expect(blocked, 'third-party requests are not allowed in tests').toEqual([]);
  },
  expectedFailures: async ({}, use) => {
    await use([]);
  },
  expectFailedResponses: async ({ expectedFailures }, use) => {
    await use((failures) => expectedFailures.push(...failures));
  },
  pageErrors: [
    async ({ page, context, blockedRequests, expectedFailures }, use) => {
      void blockedRequests;
      const errors: string[] = [];
      watchPageErrors(page, errors, expectedFailures);
      // A page opened later in the test, as for an app that was closed and opened again.
      context.on('page', (opened) => watchPageErrors(opened, errors, expectedFailures));
      await use(errors);
      expect(errors, 'the page logged errors').toEqual([]);
    },
    { auto: true },
  ],
  qaGoto: async ({ page }, use) => {
    await use(async (path, options) => {
      await page.goto(qaUrl(path, options));
      await waitForStablePage(page);
    });
  },
  byTestId: async ({ page }, use) => {
    await use((id) => page.locator(`[data-testid="${id}"]:visible`));
  },
  renderProbe: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
      const probe = JSON.stringify(await probeRendering(page));
      await testInfo.attach('render-probe', { body: probe, contentType: 'application/json' });
      // Also in the run log, which outlives test-results/ (the next run empties it).
      console.error(`[render-probe] ${testInfo.project.name} ${testInfo.titlePath.join(' › ')}: ${probe}`);
    },
    { auto: true },
  ],
});

/**
 * Diagnosis only, after a failed test: does the page still run rendering updates? A ResizeObserver reports in the
 * rendering step only, so a page whose frames stopped (the WebKit-on-Windows stall of RISK-4, microsoft/playwright#43818)
 * answers JavaScript but counts no callback, while a healthy one counts two (observe, then a resize). The wait runs here,
 * not in the page, whose timers may be the test's fake clock.
 */
async function probeRendering(page: Page): Promise<Record<string, unknown> | string> {
  const answer = <T,>(work: Promise<T>): Promise<T | 'no answer'> =>
    Promise.race([work, new Promise<'no answer'>((resolve) => setTimeout(resolve, 5_000, 'no answer'))]);
  try {
    const started = await answer(
      page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.append(probe);
        const seen = { callbacks: 0 };
        new ResizeObserver(() => void seen.callbacks++).observe(probe);
        Object.assign(window, { __qaRenderProbe: { probe, seen } });
        return { visibility: document.visibilityState, focused: document.hasFocus() };
      }),
    );
    if (started === 'no answer') return 'the page did not answer JavaScript within 5 s';
    await new Promise((resolve) => setTimeout(resolve, 300));
    await answer(
      page.evaluate(() => {
        (window as unknown as { __qaRenderProbe: { probe: HTMLElement } }).__qaRenderProbe.probe.style.width = '2px';
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const callbacks = await answer(
      page.evaluate(() => {
        const { probe, seen } = (window as unknown as { __qaRenderProbe: { probe: HTMLElement; seen: { callbacks: number } } }).__qaRenderProbe;
        probe.remove();
        return seen.callbacks;
      }),
    );
    if (callbacks === 'no answer') return { ...started, later: 'the page stopped answering JavaScript' };
    return { ...started, resizeObserverCallbacksIn1800ms: callbacks, renderingUpdates: callbacks > 0 ? 'running' : 'stopped' };
  } catch (error) {
    return `probe failed: ${String(error).split('\n')[0]}`;
  }
}

export { expect };
