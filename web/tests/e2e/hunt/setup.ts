// Global setup of the hunt: proves the target answers; the teardown removes every member the hunt signed up (prefix `garage.hunt`).
import { request } from '@playwright/test';
import { BASE_URL } from '../support/qa.mjs';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    const app = await api.get('/app/', { timeout: 30_000 });
    if (app.status() !== 200) throw new Error(`GET ${BASE_URL}/app/ answered HTTP ${app.status()}`);
  } finally {
    await api.dispose();
  }
  return async () => {
    const { deleteTestAccounts } = await import('../support/backend.mjs');
    const removed = (await deleteTestAccounts('garage.hunt')) as { deleted?: number };
    console.log(`[hunt] removed ${removed.deleted ?? '?'} test member(s)`);
  };
}
