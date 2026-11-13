// M4.7: a sign-in from a browser the account has never used. The harness's own sign-ins (apiLogin) carry the QA user agent, which the
// server keeps as one seeded device so QA never writes login alerts into the demo history (KnownDevices::browserFingerprint); this one
// sends another user agent and no device cookie, so the server sees a new browser: a `new_device` row, the alert mail and its link.
import { request } from '@playwright/test';
import { resetAuthLimits, resetCsrfLimit } from './backend.mjs';
import { BASE_URL } from './qa.mjs';

const NEW_BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';

export async function signInFromNewBrowser(email: string, password: string): Promise<void> {
  const api = await request.newContext({
    baseURL: BASE_URL,
    userAgent: NEW_BROWSER_AGENT,
    extraHTTPHeaders: { Accept: 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/app/` },
  });
  try {
    let csrf = await api.get('/sanctum/csrf-cookie');
    if (csrf.status() === 429) {
      await resetCsrfLimit();
      csrf = await api.get('/sanctum/csrf-cookie');
    }
    const xsrf = (await api.storageState()).cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '';
    let response = await api.post('/api/v1/auth/login', { data: { email, password }, headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } });
    if (response.status() === 429) {
      await resetAuthLimits([email]);
      response = await api.post('/api/v1/auth/login', { data: { email, password }, headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } });
    }
    if (response.status() !== 200) throw new Error(`Sign-in from a new browser for ${email} answered HTTP ${response.status()}.`);
  } finally {
    await api.dispose();
  }
}
