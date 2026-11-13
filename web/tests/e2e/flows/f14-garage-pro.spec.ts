// F14 Garage pro (09 §8.8, §8.12, §14.5; M4.13 app): on the member web the owner adds the HU/AU of a car on MNT-02, logs a service
// with a private cost, finds the item in GAR-01 "Nächste Fälligkeiten" with its reminder plan ready (the stages the app's local
// backups follow, ADR-441), then adds an item offline: it waits in the outbox on MNT-01 ("Wartet auf Verbindung") and goes out with
// its client ULID and Idempotency-Key as soon as the connection is back. Runs at 390 × carbon × de like the other flows.
import { expect, test } from '../support/fixtures';
import { browserOf, de, id, isCall, members, open } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type Item = { id: string; type: string; next_due: { month: string | null }; lead_days: number[] };
type Log = { id: string; cost: { cents: number } | null; mileage_km: number | null };
type Stage = { key: string; item_id: string; status: string; kind: string };

/** The month after the current one as the plakette shows it ("04/2027") and as the API answers it ("2027-04"). */
function nextMonth(): { typed: string; api: string } {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  return { typed: `${month}/${next.getUTCFullYear()}`, api: `${next.getUTCFullYear()}-${month}` };
}

test.describe('F14 Garage pro', () => {
  test('HU/AU item → service with cost → due on GAR-01 with a reminder plan → offline item queued, then sent', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const [owner] = await members('f14owner');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    const due = nextMonth();
    const session = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    const { page, context } = session;
    try {
      // 1. MNT-01 starts empty: the badged sample card and one action.
      await open(page, `/app/garage/${vehicle.id}/maintenance`);
      await expect(id(page, 'MNT-01.empty')).toBeVisible();
      await expect(id(page, 'MNT-01.sample')).toContainText(de('common', 'badges.sample'));
      await id(page, 'MNT-01.empty').getByText(de('garage', 'maintenance.empty.action')).click();

      // 2. MNT-02: the HU/AU month from the plakette; the lead times start from SET-23 (30/14/1).
      await expect(id(page, 'MNT-02.root')).toBeVisible();
      await expect(id(page, 'MNT-02.type.hu_au')).toHaveAttribute('aria-checked', 'true');
      for (const days of [30, 14, 1]) await expect(id(page, `MNT-02.lead.${days}`)).toHaveAttribute('aria-checked', 'true');
      await id(page, 'MNT-02.dueMonth').fill(due.typed);
      const created = page.waitForResponse(isCall('POST', `vehicles/${vehicle.id}/maintenance-items`));
      await id(page, 'MNT-02.cta.primary').click();
      const answer = await created;
      expect(answer.status()).toBe(201);
      const hu = ((await answer.json()) as { data: Item }).data;
      expect(hu.type).toBe('hu_au');
      expect(hu.next_due.month).toBe(due.api);
      expect(answer.request().headers()['idempotency-key']).toBeTruthy();
      await expect(id(page, `MNT-01.next.${hu.id}`)).toBeVisible();

      // 3. A service entry with mileage and a private cost, from the Verlauf header.
      await id(page, 'MNT-01.historyHeader.action').click();
      await expect(id(page, 'MNT-02.root')).toBeVisible();
      await id(page, 'MNT-02.item.__other').click();
      await id(page, 'MNT-02.logTitle').fill('Ölwechsel mit Filter');
      await id(page, 'MNT-02.km').fill('48200');
      await id(page, 'MNT-02.cost').fill('189,50');
      await id(page, 'MNT-02.workshop').fill('Werkstatt am Ring');
      const logged = page.waitForResponse(isCall('POST', `vehicles/${vehicle.id}/maintenance-logs`));
      await id(page, 'MNT-02.cta.primary').click();
      const logAnswer = await logged;
      expect(logAnswer.status()).toBe(201);
      const entry = ((await logAnswer.json()) as { data: Log }).data;
      expect(entry.cost?.cents).toBe(18950);
      expect(entry.mileage_km).toBe(48200);
      await expect(id(page, `MNT-01.log.${entry.id}`)).toBeVisible();
      await expect(id(page, `MNT-01.log.${entry.id}`)).toContainText('189,50');
      await expect(id(page, 'MNT-01.costs.total')).toContainText('189,50');

      // 4. GAR-01 "Nächste Fälligkeiten" lists the HU/AU of next month; the reminder plan holds its date stages with their keys.
      await open(page, '/app/garage');
      await expect(id(page, `GAR-01.due.${hu.id}`)).toBeVisible();
      await expect(id(page, `GAR-01.due.${hu.id}`)).toContainText(de('garage', 'maintenance.type.hu_au'));
      const plan = expectStatus(await owner.api.get('me/maintenance/reminders'), 200, 'GET me/maintenance/reminders').data as { stages: Stage[] };
      const stages = plan.stages.filter((stage) => stage.item_id === hu.id);
      expect(stages.length).toBeGreaterThan(0);
      for (const stage of stages) expect(stage.key.startsWith(`mnt:${hu.id}:`)).toBe(true);
      expect(stages.some((stage) => stage.kind === 'date' && stage.status === 'planned')).toBe(true);

      // 5. Offline: the editor saves into the outbox, MNT-01 shows the write waiting, and it goes out on reconnect.
      await id(page, `GAR-01.due.${hu.id}`).click();
      await expect(id(page, `MNT-01.next.${hu.id}`)).toBeVisible();
      await id(page, 'MNT-01.add').click();
      await id(page, 'MNT-01.addSheet.item').click();
      await expect(id(page, 'MNT-02.type')).toBeVisible();
      await context.setOffline(true);
      await id(page, 'MNT-02.type.oil_change').click();
      await id(page, 'MNT-02.intervalKm').fill('15000');
      await id(page, 'MNT-02.cta.primary').click();
      await expect(page.getByText(de('garage', 'maintenance.outbox.queued'))).toBeVisible();
      await expect(id(page, 'MNT-01.pending')).toBeVisible();
      await expect(id(page, 'MNT-01.pending')).toContainText(de('garage', 'maintenance.state.waiting'));
      const sent = page.waitForResponse(isCall('POST', `vehicles/${vehicle.id}/maintenance-items`));
      await context.setOffline(false);
      const queued = await sent;
      expect([200, 201]).toContain(queued.status());
      const oil = ((await queued.json()) as { data: Item }).data;
      expect(oil.type).toBe('oil_change');
      // The client ULID became the item's id, and the outbox sent its own Idempotency-Key.
      expect(oil.id).toMatch(/^[0-7][0-9a-hjkmnp-tv-z]{25}$/i);
      expect(queued.request().headers()['idempotency-key']).toBeTruthy();
      await expect(id(page, 'MNT-01.pending')).toHaveCount(0);
      await expect(id(page, `MNT-01.item.${oil.id}`)).toBeVisible();
      const items = expectStatus(await owner.api.get(`vehicles/${vehicle.id}/maintenance-items`), 200, 'GET items').data as Item[];
      expect(items.filter((item) => item.type === 'oil_change')).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
});
