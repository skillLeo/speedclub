// Values of the `{name}` tokens of route paths, read once per process: seeded ids that change with every seed. Garage and social ids
// come from the demo member's API (support/garage.mjs demoIds); admin ids from the database through support/backend.php, so an
// admin-only run never signs in a member; the SAFE-01 fixture decisions from support/backend.php ensure-decisions-fixture.
import { decisionsFixtureIds } from './auth.mjs';
import { seededAuditEvent } from './backend.mjs';
import { demoIds } from './garage.mjs';

/** Tokens the admin's routes use (ADM-44-event: the newest seeded audit event, ADR-223). */
export const ADMIN_TOKENS = ['auditEvent'];
/** SAFE-01-staff and SAFE-01-reversal (M3.2): the decisions of decisions.fixture, the same within a run. */
export const DECISION_FIXTURE_TOKENS = ['staffDecision', 'reversalDecision'];

/** @type {Promise<Record<string, string>>|null} */
let admin = null;

export function adminIds() {
  admin ??= seededAuditEvent().then((event) => ({ auditEvent: event.id }));
  admin.catch(() => (admin = null));
  return admin;
}

async function decisionFixtureValues() {
  const { staff_decision, reversal } = await decisionsFixtureIds();
  return { staffDecision: staff_decision, reversalDecision: reversal };
}

/**
 * Every value the given token names need, and nothing more.
 * @param {string[]} names
 * @returns {Promise<Record<string, string|undefined>>}
 */
export async function tokenValues(names) {
  const needAdmin = names.some((n) => ADMIN_TOKENS.includes(n));
  const needDecisions = names.some((n) => DECISION_FIXTURE_TOKENS.includes(n));
  const needDemo = names.some((n) => !ADMIN_TOKENS.includes(n) && !DECISION_FIXTURE_TOKENS.includes(n));
  return {
    ...(needDemo ? await demoIds() : {}),
    ...(needAdmin ? await adminIds() : {}),
    ...(needDecisions ? await decisionFixtureValues() : {}),
  };
}
