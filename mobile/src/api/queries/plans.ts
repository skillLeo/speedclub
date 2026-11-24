/**
 * M5.3 Pläne and Build-Fortschritt (docs/10_CLIENT_ROUND_1.md §5.9, §6.2; contract docs/reports/phase-5/m5.3-contract.md).
 *
 * Planned mods are public wherever mods are (contract §0); only the budget is the owner's. The page carries `plans` (the owner's
 * order) and `build_progress`; "Als verbaut markieren" is `POST mods/{id}/install`, the owner's order `PUT vehicles/{id}/plans/order`.
 * Typed by `schema.d.ts` (the M5.3 export).
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, apiData, withIdempotency } from '@/api/client';
import { refreshVehicle } from '@/api/queries/garage';
import { modKeys, type OwnerMod } from '@/api/queries/mods';
import { vehicleKeys, type ModGroup, type PublicModRow, type PublicVehicle } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { now as clockNow } from '@/lib/clock';

export type ModPriority = components['schemas']['ModPriority'];

/** A planned mod row: target month, priority, plan order and, for the owner alone, the budget (contract §2). */
export type PlanRow = PublicModRow;

export type BuildProgress = NonNullable<PublicVehicle['build_progress']>;

const BY_PLAN_ORDER = (a: PlanRow, b: PlanRow) => (a.plan_sort ?? Number.MAX_SAFE_INTEGER) - (b.plan_sort ?? Number.MAX_SAFE_INTEGER);

/**
 * The planned mods in the owner's order: the page's `plans`. A cached page from before M5.3 (read offline) has none; its planned
 * rows of `mods.groups` stand in.
 */
export function plansOf(vehicle: PublicVehicle): PlanRow[] {
  const plans = (vehicle as Partial<Pick<PublicVehicle, 'plans'>>).plans;
  if (plans) return plans.items;
  return vehicle.mods.groups.flatMap((group) => group.items).filter((mod) => mod.status === 'planned').sort(BY_PLAN_ORDER);
}

/** The Mods section's groups: the built part of the build, without the plans (contract §3: the 2.1 app shows those in Pläne). */
export function builtGroupsOf(vehicle: PublicVehicle): ModGroup[] {
  return vehicle.mods.groups
    .map((group) => {
      const items = group.items.filter((mod) => mod.status !== 'planned');
      return { ...group, items, count: items.length };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * Build-Fortschritt (10 §6.2): built ÷ (built + planned), rounded down, null without any mod (no number without data). The page's
 * own numbers; a cached page from before M5.3 gets the same count from its rows.
 */
export function buildProgressOf(vehicle: PublicVehicle): BuildProgress | null {
  const sent = (vehicle as Partial<Pick<PublicVehicle, 'build_progress'>>).build_progress;
  if (sent !== undefined) return sent;
  const rows = vehicle.mods.groups.flatMap((group) => group.items);
  const built = rows.filter((mod) => mod.status === 'installed').length;
  const planned = rows.filter((mod) => mod.status === 'planned').length;
  const total = built + planned;
  return total === 0 ? null : { built, planned, total, percent: Math.floor((built / total) * 100) };
}

/** The current month in Europe/Berlin as YYYY-MM: the server's default for "Als verbaut markieren". */
export function berlinMonth(now: Date = clockNow()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(now.getFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

type VehicleRef = { id: string; slug: string };

/** Every cached copy of the page (any viewer) gets the same change, so the owner's page moves at once. */
function updatePages(client: QueryClient, slug: string, change: (vehicle: PublicVehicle) => PublicVehicle): [readonly unknown[], PublicVehicle | undefined][] {
  const pages = client.getQueriesData<PublicVehicle>({ queryKey: vehicleKeys.of(slug), predicate: (query) => query.queryKey[3] === 'page' });
  for (const [key, page] of pages) if (page) client.setQueryData(key, change(page));
  return pages;
}

function restorePages(client: QueryClient, pages: [readonly unknown[], PublicVehicle | undefined][] | undefined) {
  for (const [key, page] of pages ?? []) client.setQueryData(key, page);
}

/** What "Verbaut" makes of a plan row, ahead of the server (contract §1): the plan fields go, the budget stays. */
export type InstalledAs = { month: string; monthLabel: string | null; statusLabel: string };

/** The page with one plan moved to Mods as built in `as.month`, labelled as built (what the server answers, ahead of its answer). */
export function installedLocally(vehicle: PublicVehicle, modId: string, as: InstalledAs): PublicVehicle {
  const page = vehicle as Partial<Pick<PublicVehicle, 'plans' | 'build_progress'>> & Omit<PublicVehicle, 'plans' | 'build_progress'>;
  const asBuilt = (mod: PublicModRow): PublicModRow =>
    mod.id === modId
      ? { ...mod, status: 'installed', status_label: as.statusLabel, installed_on: as.month, installed_label: as.monthLabel ?? mod.installed_label, target_month: null, target_label: null, is_due: false, priority: null, priority_label: null, plan_sort: null }
      : mod;
  const groups = vehicle.mods.groups.map((group) => ({ ...group, items: group.items.map(asBuilt) }));
  const items = plansOf(vehicle).filter((mod) => mod.id !== modId);
  const progress = buildProgressOf(vehicle);
  const next = {
    ...page,
    mods: { ...vehicle.mods, groups },
    ...(page.plans ? { plans: { count: items.length, items } } : {}),
    ...(page.build_progress !== undefined && progress
      ? {
          build_progress: {
            built: progress.built + 1,
            planned: Math.max(0, progress.planned - 1),
            total: progress.total,
            percent: Math.floor(((progress.built + 1) / Math.max(1, progress.total)) * 100),
          },
        }
      : {}),
  };
  return next as PublicVehicle;
}

/**
 * The page with one plan back as it was, after its "Verbaut" failed: only that row and the counts it moved, so a second install
 * that is still running keeps its own move (review N4).
 */
export function restoredLocally(vehicle: PublicVehicle, original: PlanRow): PublicVehicle {
  const page = vehicle as Partial<Pick<PublicVehicle, 'plans' | 'build_progress'>> & Omit<PublicVehicle, 'plans' | 'build_progress'>;
  const current = vehicle.mods.groups.flatMap((group) => group.items).find((mod) => mod.id === original.id);
  // Already a plan again (the page was read anew meanwhile): nothing to undo.
  if (!current || current.status === 'planned') return vehicle;
  const groups = vehicle.mods.groups.map((group) => ({ ...group, items: group.items.map((mod) => (mod.id === original.id ? original : mod)) }));
  const items = [...plansOf(vehicle).filter((mod) => mod.id !== original.id), original].sort(BY_PLAN_ORDER);
  const progress = page.build_progress;
  const next = {
    ...page,
    mods: { ...vehicle.mods, groups },
    ...(page.plans ? { plans: { count: items.length, items } } : {}),
    ...(progress
      ? {
          build_progress: {
            built: Math.max(0, progress.built - 1),
            planned: progress.planned + 1,
            total: progress.total,
            percent: Math.floor((Math.max(0, progress.built - 1) / Math.max(1, progress.total)) * 100),
          },
        }
      : {}),
  };
  return next as PublicVehicle;
}

/** The server's answer for the row it built: status, its label and the month, as the API words them. */
export function savedLocally(vehicle: PublicVehicle, saved: Pick<OwnerMod, 'id' | 'status' | 'status_label' | 'installed_on' | 'installed_label'>): PublicVehicle {
  const groups = vehicle.mods.groups.map((group) => ({
    ...group,
    items: group.items.map((mod) =>
      mod.id === saved.id ? { ...mod, status: saved.status, status_label: saved.status_label, installed_on: saved.installed_on, installed_label: saved.installed_label } : mod,
    ),
  }));
  return { ...vehicle, mods: { ...vehicle.mods, groups } };
}

/** The page with its plans in `ids` order. */
export function reorderedLocally(vehicle: PublicVehicle, ids: readonly string[]): PublicVehicle {
  const page = vehicle as Partial<Pick<PublicVehicle, 'plans'>> & PublicVehicle;
  const position = new Map(ids.map((id, index) => [id, index]));
  const sorted = (rows: PlanRow[]) =>
    rows.map((mod) => (position.has(mod.id) ? { ...mod, plan_sort: position.get(mod.id) ?? null } : mod)).sort(BY_PLAN_ORDER);
  if (page.plans) return { ...page, plans: { ...page.plans, items: sorted(page.plans.items) } };
  // Before M5.3 the order lives in the group rows' plan_sort.
  const groups = vehicle.mods.groups.map((group) => ({
    ...group,
    items: group.items.map((mod) => (position.has(mod.id) ? { ...mod, plan_sort: position.get(mod.id) ?? null } : mod)),
  }));
  return { ...vehicle, mods: { ...vehicle.mods, groups } };
}

/**
 * "Als verbaut markieren" (contract §4.2): the plan moves to Mods at once, dated this month and labelled as built; the server's answer
 * then replaces the row and fills the mod's own cache (GAR-10). A failure puts only this plan back. Afterwards every view of the
 * vehicle reads again, as after any mod write (`refreshVehicle`: VEH-01, GAR-02, GAR-01, GAR-11's Verlauf, the sticker lists) and
 * GAR-09's list. A 409 `mod_not_planned` means it was built elsewhere: the page read again shows that.
 */
export function useInstallPlan(vehicle: VehicleRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ plan, idempotencyKey, as }: { plan: PlanRow; idempotencyKey: string; as: InstalledAs }) =>
      (
        await apiData(
          api.POST('/mods/{modification}/install', {
            params: { path: { modification: plan.id } },
            // DQ-M53-09: the plan's budget becomes the cost when none is entered (contract §4.2 lets the app prefill it).
            body: { installed_on: as.month, ...(plan.budget && !plan.cost ? { cost_cents: plan.budget.cents } : {}) },
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
    onMutate: async ({ plan, as }) => {
      await client.cancelQueries({ queryKey: vehicleKeys.of(vehicle.slug) });
      updatePages(client, vehicle.slug, (page) => installedLocally(page, plan.id, as));
    },
    onSuccess: (saved) => {
      client.setQueryData(modKeys.mod(saved.id), saved);
      updatePages(client, vehicle.slug, (page) => savedLocally(page, saved));
    },
    onError: (_error, { plan }) => {
      updatePages(client, vehicle.slug, (page) => restoredLocally(page, plan));
    },
    onSettled: () => {
      refreshVehicle(client, vehicle);
      void client.invalidateQueries({ queryKey: modKeys.list(vehicle.id) });
    },
  });
}

/** The owner's order of the plans (contract §4.3): every planned id once. The list moves at once and goes back when the call fails. */
export function useReorderPlans(vehicle: VehicleRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await apiData(api.PUT('/vehicles/{vehicle}/plans/order', { params: { path: { vehicle: vehicle.id } }, body: { ids } }))).data,
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: vehicleKeys.of(vehicle.slug) });
      return { pages: updatePages(client, vehicle.slug, (page) => reorderedLocally(page, ids)) };
    },
    onError: (_error, _ids, context) => restorePages(client, context?.pages),
    // GAR-09's rows carry plan_sort too.
    onSettled: () => {
      void client.invalidateQueries({ queryKey: vehicleKeys.of(vehicle.slug) });
      void client.invalidateQueries({ queryKey: modKeys.list(vehicle.id) });
    },
  });
}
