import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { newIdempotencyKey, ApiError } from '@/api/client';
import { berlinMonth, builtGroupsOf, plansOf, useInstallPlan, useReorderPlans, type PlanRow } from '@/api/queries/plans';
import type { PublicModRow, PublicVehicle } from '@/api/queries/vehicles';
import { SortHandleSlot, Sortable } from '@/features/garage/components/Sortable';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useGarageAccess } from '@/features/garage/components/frames';
import { createStyles, size } from '@/theme';
import { Badge } from '@/ui/Badge';
import { BuildSheetRow, type BuildSheetMod } from '@/ui/BuildSheet';
import { Dialog } from '@/ui/Dialog';
import { Icon } from '@/ui/icons/Icon';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { categoryIcon } from '../model';
import { planHref } from '../navigation';
import { SectionEmpty, SectionTitle } from './OnePageSections';
import { useModSheetRows } from './ProfileSections';
import { RowCard } from './RowCard';

const useStyles = createStyles((t) => ({
  hint: { marginBottom: t.space[12] },
  privateNote: { marginTop: t.space[12] },
  sortRow: {
    alignItems: 'center',
    backgroundColor: t.color.bg.surface,
    flexDirection: 'row',
    gap: t.space[12],
    height: t.size.row.mod,
    paddingLeft: t.space[16],
  },
  sortRowActive: { backgroundColor: t.color.bg.raised },
  sortText: { flex: 1, minWidth: 0 },
  // The sample plan of the owner's empty Pläne (09 §4.9 "never empty"): the real row anatomy, badged "Beispiel", not pressable.
  sample: { gap: t.space[12] },
  sampleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  sampleTile: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    height: t.size.modTile,
    justifyContent: 'center',
    width: t.size.modTile,
  },
  sampleText: { flex: 1, gap: t.space[4], minWidth: 0 },
  samplePills: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
}));

/** The owner's empty Pläne: a sample plan in a system the car has no mod in yet (brakes last, as the fallback). */
const PLAN_SAMPLES = [
  { key: 'suspension', icon: 'coilover' },
  { key: 'exhaust', icon: 'exhaust' },
  { key: 'wheels_tires', icon: 'wheel' },
  { key: 'brakes', icon: 'brake-disc' },
] as const;

export type PlansSectionProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** The owner's page (VEH-01 of your own build, GAR-02): reorder, "Als verbaut markieren", the budget, the empty invitation. */
  owner: boolean;
  onOpenMod: (mod: PublicModRow) => void;
  /** While a plan is held for reordering, so the page stops scrolling under the finger. */
  onDragging?: (dragging: boolean) => void;
};

/** The row's pills: the target month (or "Fällig" once it has come, for the owner) and the priority; the legal status keeps its own. */
function planStatus(mod: PlanRow, owner: boolean, t: (key: string, values?: Record<string, unknown>) => string): Pick<BuildSheetMod, 'status' | 'priority' | 'priorityLabel'> {
  const month = mod.target_label ?? null;
  const status = month ? (owner && mod.is_due ? t('plans.due', { month }) : t('plans.target', { month })) : mod.status_label;
  return {
    status,
    ...(mod.priority_label ? { priority: mod.priority_label, priorityLabel: t('plans.priority', { label: mod.priority_label }) } : {}),
  };
}

/**
 * 10 §5.9 Pläne: the upcoming mods in the owner's order, each with its target month (Monat Jahr), an optional priority and, for the
 * owner alone, the private budget. The owner reorders them (the garage's Sortable: hold or drag the grip, arrow keys on web) and
 * marks one "Als verbaut markieren": it moves to Mods dated this month, with the success haptic.
 */
export function PlansSection({ vehicle, routeId, owner, onOpenMod, onDragging }: PlansSectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const online = useOnline();
  // SF-1 (M3.5 rule): a write that cannot go through looks off and says why before the tap: staff in view-as, a publishing
  // restriction (both from the garage's access), or no connection.
  const access = useGarageAccess();
  const locked = owner ? (access.restriction ?? (online ? null : t('plans.offline'))) : null;
  const rows = useModSheetRows(routeId, onOpenMod);
  const ref = { id: vehicle.id, slug: vehicle.slug };
  const install = useInstallPlan(ref);
  const reorder = useReorderPlans(ref);
  const plans = plansOf(vehicle);
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<PlanRow[] | null>(null);
  const [confirming, setConfirming] = useState<PlanRow | null>(null);
  // One key per "Als verbaut markieren" intent: a retry of the same plan replays the first answer (contract §4.2).
  const keys = useRef(new Map<string, string>());

  const month = berlinMonth();
  const [year = '', monthPart = ''] = month.split('-');
  // Mid-month in UTC: the same month whatever time zone the formatter uses.
  const monthLabel = format.monthYear(new Date(Date.UTC(Number(year), Number(monthPart) - 1, 15)));

  const confirmInstall = () => {
    const plan = confirming;
    if (!plan) return;
    const idempotencyKey = keys.current.get(plan.id) ?? newIdempotencyKey();
    keys.current.set(plan.id, idempotencyKey);
    // The dialog stays open with its spinner until the answer (review N4); the row has already moved behind it.
    install.mutate(
      { plan, idempotencyKey, as: { month, monthLabel, statusLabel: t('plans.installedStatus') } },
      {
        onSuccess: () => {
          keys.current.delete(plan.id);
          setConfirming(null);
          haptics.success();
          toast(t('plans.installed', { name: plan.title }));
        },
        onError: (error) => {
          setConfirming(null);
          haptics.error();
          // An answer that settles it (already built, gone, refused) ends this intent; a lost answer keeps its key for the retry.
          if (error instanceof ApiError && error.kind !== 'network') keys.current.delete(plan.id);
          toast(error instanceof ApiError ? error.message : t('plans.installFailed'));
        },
      },
    );
  };

  const finishSorting = () => {
    const next = order;
    setSorting(false);
    setOrder(null);
    if (!next || next.every((mod, index) => mod.id === plans[index]?.id)) return;
    reorder.mutate(
      next.map((mod) => mod.id),
      {
        onSuccess: () => toast(t('plans.sortSaved')),
        onError: (error) => toast(error instanceof ApiError ? error.message : t('plans.sortFailed')),
      },
    );
  };

  const titleAction =
    owner && plans.length > 1
      ? sorting
        ? { label: t('plans.sortDone'), onPress: finishSorting, testID: `${routeId}.plans.sortDone` }
        : { label: t('plans.sort'), onPress: () => setSorting(true), locked, testID: `${routeId}.plans.sort` }
      : undefined;

  // M5.3: GAR-10 as a plan; it asks for the system first.
  const addPlan = () => router.push(planHref(vehicle.id));

  if (plans.length === 0) {
    if (!owner) return null;
    // DQ-M53-14 b: the sample proposes a system this car has nothing in yet, never a part it already has.
    const built = new Set(builtGroupsOf(vehicle).map((group) => group.category.key));
    const sample = PLAN_SAMPLES.find((entry) => !built.has(entry.key)) ?? PLAN_SAMPLES[PLAN_SAMPLES.length - 1]!;
    return (
      <View testID={`${routeId}.plans`}>
        <SectionTitle title={t('sections.plans')} section="plans" testID={`${routeId}.section.plans.title`} />
        <View style={styles.sample}>
          <RowCard testID={`${routeId}.plans.sample`}>
            <View style={styles.sampleRow} aria-hidden>
              <View style={styles.sampleTile}>
                <Icon name={categoryIcon(sample.icon)} size={24} color="text.secondary" />
              </View>
              <View style={styles.sampleText}>
                <Text variant="headline">{t(`plans.samples.${sample.key}.name`)}</Text>
                <Text variant="caption" color="text.secondary">
                  {t(`plans.samples.${sample.key}.brand`)}
                </Text>
                <View style={styles.samplePills}>
                  <StatusPill label={t('plans.target', { month: t('plans.sample.month') })} />
                  <StatusPill label={t('plans.sample.priority')} />
                  <Badge kind="sample" />
                </View>
              </View>
            </View>
          </RowCard>
          <SectionEmpty text={t('plans.empty')} action={{ label: t('plans.add'), onPress: addPlan, testID: `${routeId}.plans.add` }} testID={`${routeId}.plansEmpty`} />
        </View>
      </View>
    );
  }

  const planRow = (mod: PlanRow): BuildSheetMod => {
    const base = rows.row(mod);
    const budget = owner && mod.budget ? mod.budget.label : null;
    const values = [base.values, budget].filter((part): part is string => Boolean(part)).join(' · ');
    return {
      ...base,
      ...planStatus(mod, owner, t as (key: string, values?: Record<string, unknown>) => string),
      ...(values ? { values } : {}),
      links: owner
        ? [
            ...(base.links ?? []),
            {
              key: 'install',
              label: t('plans.install'),
              icon: 'check',
              accessibilityLabel: t('plans.installLabel', { name: mod.title }),
              onPress: () => setConfirming(mod),
              locked,
              testID: `${routeId}.plan.${mod.id}.install`,
            },
          ]
        : base.links,
      testID: `${routeId}.plan.${mod.id}`,
    };
  };

  const shown = order ?? plans;
  return (
    <View testID={`${routeId}.plans`}>
      <SectionTitle
        title={t('sections.plans')}
        section="plans"
        count={plans.length}
        countLabel={t('plans.count', { count: plans.length })}
        action={titleAction}
        testID={`${routeId}.section.plans.title`}
      />
      {sorting ? (
        <>
          <Text variant="callout" color="text.secondary" style={styles.hint} testID={`${routeId}.plans.sortHint`}>
            {isWeb ? t('plans.sortHintWeb') : t('plans.sortHint')}
          </Text>
          <RowCard>
            <Sortable
              items={shown}
              keyOf={(mod) => mod.id}
              labelOf={(mod) => mod.title}
              rowHeight={size.row.mod}
              gap={0}
              onChange={setOrder}
              onDragging={onDragging}
              renderItem={(mod, { active }) => (
                <View style={[styles.sortRow, active ? styles.sortRowActive : null]}>
                  <Icon name={categoryIcon(mod.category.icon)} size={24} color="text.secondary" />
                  <View style={styles.sortText}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {mod.title}
                    </Text>
                  </View>
                  {mod.target_label ? <StatusPill label={mod.target_label} /> : null}
                  <SortHandleSlot />
                </View>
              )}
              testID={`${routeId}.plans.sortable`}
            />
          </RowCard>
        </>
      ) : (
        <RowCard testID={`${routeId}.plans.list`}>
          {shown.map((mod, index) => (
            <BuildSheetRow key={mod.id} mod={planRow(mod)} divider={index < shown.length - 1} />
          ))}
        </RowCard>
      )}
      {owner ? (
        <Text variant="caption" color="text.tertiary" style={styles.privateNote} testID={`${routeId}.plans.private`}>
          {t('plans.budgetPrivate')}
        </Text>
      ) : null}
      <Dialog
        visible={confirming !== null}
        onClose={() => {
          if (!install.isPending) setConfirming(null);
        }}
        title={t('plans.installTitle', { name: confirming?.title ?? '' })}
        body={t('plans.installBody', { month: monthLabel })}
        actions={[
          { label: t('plans.cancel'), variant: 'secondary', onPress: () => setConfirming(null), disabled: install.isPending, testID: `${routeId}.plans.installDialog.cancel` },
          { label: t('plans.installConfirm'), variant: 'primary', onPress: confirmInstall, loading: install.isPending, testID: `${routeId}.plans.installDialog.confirm` },
        ]}
        testID={`${routeId}.plans.installDialog`}
      />
    </View>
  );
}
