import { deleteStaffFixtures, deleteTestAccounts, disablePremiumFixture, resetAuthLimits } from './backend.mjs';
import { clearDeletedMedia } from './deleted-media.mjs';
import { appFingerprint, BASE_URL, EXPORT_CHANGED_MESSAGE } from './qa.mjs';
import { prepareStaffRunForWorkers } from './staff.mjs';

// Fails fast with a useful message instead of hundreds of identical connection errors, and returns
// a teardown that invalidates the run when the app was re-exported while it was running.
// Test accounts (support/backend.mjs, E2E_DOMAIN) never outlive a run: leftovers of an aborted run go
// first, and this run's go at the end, whatever the outcome. The staff fixtures of the admin tests (support/staff.mjs) are created
// with this run's password and TOTP secrets and signed in once per auth kind; the workers inherit the run through the environment.
export default async function globalSetup(): Promise<() => Promise<void>> {
  let before: string;
  try {
    before = await appFingerprint();
  } catch (error) {
    throw new Error(
      [
        `The server at ${BASE_URL}/app/ is not usable (${String(error)}).`,
        'Start it with: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/services.ps1 start',
        'and export the app with: npm --prefix mobile run export:web',
      ].join(' '),
    );
  }
  await deleteTestAccounts();
  clearDeletedMedia();
  await resetAuthLimits();
  // A stage fixture an aborted run left on (axe-admin's premium test switches premium.enabled on for its own few seconds).
  await disablePremiumFixture();
  // DQ-677: every staff fixture an aborted run (Playwright or the visual runner) left goes first, with its requests, views and branding
  // (the seeded drafts a stage lent or A3 parked are given back before that); the run then creates its own.
  const leftover = await deleteStaffFixtures();
  if (leftover.deleted > 0) console.log(`[e2e] removed ${leftover.deleted} staff fixture(s) an earlier run left`);
  await prepareStaffRunForWorkers();
  return async () => {
    await disablePremiumFixture();
    const { deleted } = await deleteTestAccounts();
    console.log(`[e2e] removed ${deleted} test account(s)`);
    const staff = await deleteStaffFixtures();
    console.log(`[e2e] removed ${staff.deleted} staff fixture(s), ${staff.approvals} approval request(s) of theirs and their branding ${JSON.stringify(staff.branding)}`);
    if ((await appFingerprint()) !== before) throw new Error(EXPORT_CHANGED_MESSAGE);
  };
}
