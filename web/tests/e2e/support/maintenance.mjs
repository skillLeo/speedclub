// The visual stage fixture `maintenance` (M4.13, MNT-01/02, GAR-01-due): lukas.sc's R34 gets six maintenance items and two service
// log entries for the capture of those cells only, made through the member API the app uses, with fixed client ids (ADR-441: the
// same id again answers the stored copy, so a second setup changes nothing). The teardown deletes them through the API again; the
// exit path (support/backend.php remove-maintenance-fixture) deletes the rows by id. Maintenance is private: no other cell shows it
// except GAR-01's "Nächste Fälligkeiten", which is why this is a stage fixture and not seed data.
import { DEMO_MEMBER, sessionOf } from './auth.mjs';
import { backendSync } from './backend.mjs';
import { demoIds, expectStatus, memberApi } from './garage.mjs';

/** A fixed ULID (Crockford, no i/l/o/u) with the fixture prefix, so the exit path can only delete these rows. */
const fixtureId = (/** @type {number} */ n) => `01mntfx${String(n).padStart(19, '0')}`;

/** Calendar day `months` from today, YYYY-MM-DD (the HU/AU takes the first of a month). */
function monthsFromNow(/** @type {number} */ months, day = 1) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, day));
  return date.toISOString().slice(0, 10);
}

/** The items: HU/AU four months ahead (the hero), oil change by date and km, overdue brake fluid, tyres, insurance, a custom one. */
function items() {
  return [
    { id: fixtureId(1), type: 'hu_au', next_due_at: monthsFromNow(4), lead_days: [30, 14, 1] },
    { id: fixtureId(2), type: 'oil_change', interval_months: 12, interval_km: 15000, last_done_at: '2026-06-14', last_done_km: 41200, lead_days: [14] },
    { id: fixtureId(3), type: 'brake_fluid', interval_months: 24, last_done_at: '2024-09-20', lead_days: [14] },
    { id: fixtureId(4), type: 'tyre_change', lead_days: [14] },
    { id: fixtureId(5), type: 'insurance', lead_days: [29] },
    { id: fixtureId(6), type: 'custom', title: 'Zahnriemen', interval_months: 60, interval_km: 120000, last_done_at: '2023-04-03', last_done_km: 18500, lead_days: [30] },
  ];
}

function logs() {
  return [
    { id: fixtureId(11), item_id: fixtureId(2), done_at: '2026-06-14', mileage_km: 41200, workshop: 'Werkstatt am Ring', cost_cents: 18950, notes: 'Castrol Edge 5W-30, Ölfilter von Mahle.' },
    { id: fixtureId(12), type: 'custom', title: 'Klimaservice', done_at: '2025-05-08', mileage_km: 33900, workshop: 'Kühltechnik Wagner', cost_cents: 12900, notes: null },
  ];
}

const ALL_IDS = [...items().map((item) => item.id), ...logs().map((entry) => entry.id)];

/**
 * @template T
 * @param {(api: Awaited<ReturnType<typeof memberApi>>, vehicle: string) => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withLukas(run) {
  const { r34 } = await demoIds();
  const api = await memberApi(await sessionOf(DEMO_MEMBER));
  try {
    return await run(api, r34);
  } finally {
    await api.dispose();
  }
}

export function ensureMaintenanceFixture() {
  return withLukas(async (api, vehicle) => {
    for (const item of items()) {
      // A new key per run: the fixed client id is what makes a second setup a no-op (a reused key would replay a deleted item's 201).
      const answer = await api.post(`vehicles/${vehicle}/maintenance-items`, item);
      if (answer.status !== 409) expectStatus(answer, answer.status === 200 ? 200 : 201, `POST maintenance item ${item.type}`);
    }
    for (const entry of logs()) {
      const answer = await api.post(`vehicles/${vehicle}/maintenance-logs`, entry);
      expectStatus(answer, answer.status === 200 ? 200 : 201, `POST maintenance log ${entry.id}`);
    }
    expectStatus(await api.put(`vehicles/${vehicle}/odometer`, { km: 48200 }), 200, 'PUT odometer');
    return { vehicle, items: items().length, logs: logs().length };
  });
}

export function removeMaintenanceFixture() {
  return withLukas(async (api, vehicle) => {
    for (const entry of logs()) await api.delete(`vehicles/${vehicle}/maintenance-logs/${entry.id}`);
    for (const item of items()) await api.delete(`vehicles/${vehicle}/maintenance-items/${item.id}`);
    return { vehicle };
  });
}

let lastVehicle = /** @type {string|null} */ (null);

/** @type {import('./stage-fixtures.mjs').StageFixture} */
export const maintenanceFixture = {
  what: "lukas.sc's R34 with six maintenance items (HU/AU, Ölwechsel, Bremsflüssigkeit overdue, Reifenwechsel, Kfz-Versicherung, Zahnriemen), two service entries with private costs and 48.200 km",
  setup: async () => {
    const made = await ensureMaintenanceFixture();
    lastVehicle = made.vehicle;
    return made;
  },
  teardown: async () => {
    await removeMaintenanceFixture();
    lastVehicle = null;
  },
  teardownSync: () => (lastVehicle ? backendSync(['remove-maintenance-fixture', lastVehicle, ...ALL_IDS]) : true),
};
