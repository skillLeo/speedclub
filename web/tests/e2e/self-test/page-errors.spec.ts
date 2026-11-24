// The page-error fixture lets exactly one WebKit message through (support/fixtures.ts isCancelledSameOriginFetch): a fetch to the app's
// own origin that a navigation cancelled, which WebKit under Playwright's clock emulation reports as "… due to access control checks."
// A same-origin request has no access control check, so nothing real hides behind it. Nothing wider is let through.
import { expect, isCancelledSameOriginFetch, test } from '../support/fixtures';
import { BASE_URL } from '../support/qa.mjs';

const line = (url: string, dot = '.') => `Fetch API cannot load ${url} due to access control checks${dot}`;
const API = `${BASE_URL}/api/v1/vehicles/01m7549g2v8m4q1g1g8xjg1zqp/build-score`;

test('WebKit and the app origin: the mislabelled cancel is let through, with or without the full stop', () => {
  expect(isCancelledSameOriginFetch('webkit', line(API))).toBe(true);
  expect(isCancelledSameOriginFetch('webkit', line(`${BASE_URL}/api/v1/vehicles/x/forum-threads?per_page=3`, ''))).toBe(true);
});

test('everything else stays a page error', () => {
  // Another engine, another origin, or any other message.
  expect(isCancelledSameOriginFetch('chromium', line(API))).toBe(false);
  expect(isCancelledSameOriginFetch(undefined, line(API))).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', line('https://cdn.example.com/a.js'))).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', line(API.replace(/:\d+/, ':8081')))).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', 'TypeError: Load failed')).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', `TypeError: ${line(API)}`)).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', `Fetch API cannot load ${API} due to access control checks. And more`)).toBe(false);
  expect(isCancelledSameOriginFetch('webkit', 'Fetch API cannot load not-a-url due to access control checks.')).toBe(false);
});
