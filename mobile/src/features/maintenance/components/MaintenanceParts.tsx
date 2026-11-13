import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { numberOrNull, useSetOdometer, type MaintenanceCosts, type MaintenanceItem, type MaintenanceLog } from '@/api/queries/maintenance';
import type { GarageVehicle } from '@/api/queries/garage';
import { photoFields } from '@/features/profile/media';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { formatLongDate, formatMonthYear } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space } from '@/theme';
import {
  Badge,
  Button,
  DisplayTitle,
  ListRow,
  MaintenanceCard,
  Photo,
  PhotoScrim,
  SectionHeader,
  Sheet,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  TextInput,
  Timeline,
  toast,
  type TimelineEntry,
} from '@/ui';
import { RowGroup } from '@/ui/RowGroup';

import {
  distanceText,
  dueModel,
  euroText,
  itemTitle,
  parseWhole,
  plainNumber,
  toUnit,
  fromUnit,
  dayDate,
  type DistanceUnit,
} from '../model';
import type { MaintenanceOutboxOp } from '../outbox';
import { queueMaintenance } from '../outbox';

export const ROUTE = 'MNT-01';
const LOG_PHOTOS_SHOWN = 3;
/** Width the photo variants are picked for: the band is the screen's width at most. */
const BAND_PHOTO_WIDTH = 1080;
const THUMB_WIDTH = 480;

const useStyles = createStyles((t) => ({
  band: { overflow: 'hidden' },
  bandText: { bottom: 0, gap: t.space[4], left: 0, paddingBottom: t.space[16], paddingHorizontal: t.space[20], position: 'absolute', right: 0 },
  section: { gap: t.space[8], paddingTop: t.space[32] },
  // DQ-1098: one header system on MNT-01, the SectionHeader at the gutter with 12 to its group.
  pageSection: { gap: t.space[12], paddingTop: t.space[32] },
  headerAction: { flexShrink: 0, marginBottom: -t.space[8], marginRight: -t.size.buttonPaddingX.s, marginTop: -t.space[4] },
  sectionFirst: { gap: t.space[8], paddingTop: t.space[24] },
  hero: { paddingTop: t.space[24] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  pendingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], paddingBottom: t.space[12], paddingHorizontal: t.space[16] },
  costsHead: { gap: t.space[4], paddingHorizontal: t.space[16], paddingVertical: t.space[16] },
  sheetBody: { gap: t.space[16], paddingBottom: t.space[8] },
  skeleton: { gap: t.space[24] },
  skeletonHero: { alignItems: 'center', flexDirection: 'row', gap: t.space[20] },
  skeletonText: { flex: 1, gap: t.space[8] },
  skeletonRows: { gap: t.space[8] },
}));

/**
 * 09 §7.12: the car whose maintenance this is, as a 16:9 photo band with its name over the scrim and the private note. Full
 * bleed on phones (0 radius); inset with radius 20 from 768 (the caller passes `inset`).
 */
export function VehicleBand({ vehicle, inset, width }: { vehicle: Pick<GarageVehicle, 'cover' | 'full_title'>; inset: boolean; width: number }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View style={styles.band} testID={`${ROUTE}.band`}>
      <Photo {...photoFields(vehicle.cover, BAND_PHOTO_WIDTH)} aspect="16:9" corner={inset ? 'xl' : 'none'} label={vehicle.full_title} testID={`${ROUTE}.photo`}>
        <PhotoScrim />
        <View style={styles.bandText}>
          <DisplayTitle placement="card" layoutWidth={Math.max(0, width - 2 * space[20])} color="onPhoto.primary" testID={`${ROUTE}.vehicle`}>
            {vehicle.full_title}
          </DisplayTitle>
          <Text variant="callout" color="onPhoto.primary">
            {t('maintenance.private')}
          </Text>
        </View>
      </Photo>
    </View>
  );
}

type CardProps = { item: MaintenanceItem; unit: DistanceUnit; hero?: boolean; status?: string | null; divider?: boolean; onOpen?: (item: MaintenanceItem) => void };

export const ItemCard = memo(function ItemCard({ item, unit, hero = false, status, divider, onOpen }: CardProps) {
  const { t } = useTranslation('garage');
  const format = useFormat();
  const model = dueModel(t, item, unit, format.locale);
  const meta = [model.season, model.enabled ? model.last : t('maintenance.off')].filter(Boolean).join(' · ') || null;
  return (
    <MaintenanceCard
      variant={hero ? 'hero' : 'row'}
      title={model.title}
      glyph={model.glyph}
      due={model.due ?? t('maintenance.due.none')}
      countdown={model.enabled ? (hero && model.figure ? model.heroCountdown : model.countdown) : null}
      figure={hero && model.figure ? { value: format.number(model.figure.value), unit: model.figure.unit } : null}
      meta={meta}
      tone={model.tone}
      progress={model.progress}
      status={status}
      divider={divider}
      onPress={onOpen ? () => onOpen(item) : undefined}
      testID={`${ROUTE}.${hero ? 'next' : 'item'}.${item.id}`}
    />
  );
});

/** What a waiting write says about itself. */
export function opStatus(t: (key: string) => string, op: MaintenanceOutboxOp, online: boolean): string {
  if (op.status === 'failed') return op.error ? `${t('maintenance.state.failed')}: ${op.error}` : t('maintenance.state.failed');
  return online ? t('maintenance.state.sending') : t('maintenance.state.waiting');
}

/** The writes of this vehicle that have not reached the server: with "Erneut versuchen" and "Verwerfen" once one failed. */
export function PendingGroup({
  ops,
  items,
  onRetry,
  onDiscard,
  unit,
}: {
  unit: DistanceUnit;
  ops: readonly MaintenanceOutboxOp[];
  items: readonly MaintenanceItem[];
  onRetry: (op: MaintenanceOutboxOp) => void;
  onDiscard: (op: MaintenanceOutboxOp) => void;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const titleOf = (op: MaintenanceOutboxOp): string => {
    const known = items.find((item) => item.id === op.target);
    switch (op.kind) {
      case 'item.create':
        return itemTitle(t, { type: op.payload.body.type, title: op.payload.body.title ?? null });
      case 'item.update':
        return known ? itemTitle(t, known) : t('maintenance.outbox.pendingTitle');
      case 'item.delete':
        return t('maintenance.outbox.deleteItem', { title: known ? itemTitle(t, known) : t('maintenance.type.custom') });
      case 'log.create': {
        const day = dayDate(op.payload.body.done_at);
        return t('maintenance.outbox.log', { date: day ? formatLongDate(day, format.locale) : op.payload.body.done_at });
      }
      case 'log.update':
        return t('maintenance.log.edit', { title: t('maintenance.history') });
      case 'log.delete':
        return t('maintenance.outbox.deleteLog');
      case 'odometer.set':
        return t('maintenance.outbox.odometer', { distance: distanceText(op.payload.km, unit, format.locale) });
      default:
        return t('maintenance.outbox.pendingTitle');
    }
  };
  return (
    <View style={styles.section} testID={`${ROUTE}.pending`}>
      <RowGroup title={t('maintenance.outbox.pendingTitle')}>
        {ops.map((op, index) => (
          <View key={op.id} testID={`${ROUTE}.pending.${op.target}`}>
            <ListRow
              title={titleOf(op)}
              subtitle={opStatus(t as unknown as (key: string) => string, op, online)}
              icon={op.status === 'failed' ? 'warning' : 'clock'}
              divider={index < ops.length - 1 && op.status !== 'failed'}
              testID={`${ROUTE}.pending.${op.target}.row`}
            />
            {op.status === 'failed' ? (
              <View style={styles.pendingActions}>
                <Button label={t('maintenance.outbox.retry')} variant="secondary" size="s" onPress={() => onRetry(op)} testID={`${ROUTE}.pending.${op.target}.retry`} />
                <Button label={t('maintenance.outbox.discard')} variant="tertiary" size="s" onPress={() => onDiscard(op)} testID={`${ROUTE}.pending.${op.target}.discard`} />
              </View>
            ) : null}
          </View>
        ))}
      </RowGroup>
    </View>
  );
}

/**
 * "Kilometerstand" (DQ-1098, DQ-1102): a page section like the others, with "Aktualisieren" (a sheet) as the header's action, so
 * the value keeps the row's width ("48.200 km" as the title, "Stand vom …" under it). Writes go through the outbox offline.
 */
export function OdometerRow({
  vehicleId,
  km,
  recordedAt,
  unit,
  disabled,
}: {
  vehicleId: string;
  km: number | null;
  recordedAt: string | null;
  unit: DistanceUnit;
  disabled: boolean;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const recorded = recordedAt ? t('maintenance.odometer.recorded', { date: formatLongDate(new Date(recordedAt), format.locale) }) : null;
  return (
    <View style={styles.pageSection}>
      <SectionHeader
        title={t('maintenance.odometer.title')}
        trailing={
          // DQ-1127: the Button S overhangs the title line as SectionHeader's own action does (DQ-298), so this header is as high
          // as the plain "Als Nächstes" beside it and both titles stand on one line on the desktop grid.
          <View style={styles.headerAction}>
            <Button
              label={t('maintenance.odometer.update')}
              accessibilityLabel={t('maintenance.odometer.updateLabel')}
              variant="tertiary"
              size="s"
              disabled={disabled}
              onPress={() => setOpen(true)}
              testID={`${ROUTE}.odometer.update`}
            />
          </View>
        }
        testID={`${ROUTE}.odometerHeader`}
      />
      <RowGroup>
        <ListRow
          title={km === null ? t('maintenance.odometer.unknown') : distanceText(km, unit, format.locale)}
          subtitle={km === null ? undefined : (recorded ?? undefined)}
          hyphenate={false}
          icon="cruise-route"
          testID={`${ROUTE}.odometer`}
        />
      </RowGroup>
      <OdometerSheet visible={open} onClose={() => setOpen(false)} vehicleId={vehicleId} km={km} unit={unit} />
    </View>
  );
}

function OdometerSheet({ visible, onClose, vehicleId, km, unit }: { visible: boolean; onClose: () => void; vehicleId: string; km: number | null; unit: DistanceUnit }) {
  const { t } = useTranslation('garage');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('maintenance.odometer.sheetTitle')} narrow testID={`${ROUTE}.odometerSheet`}>
      <OdometerForm onClose={onClose} vehicleId={vehicleId} km={km} unit={unit} />
    </Sheet>
  );
}

/** Lives inside the sheet, so every opening starts from the last known mileage. */
function OdometerForm({ onClose, vehicleId, km, unit }: { onClose: () => void; vehicleId: string; km: number | null; unit: DistanceUnit }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const online = useOnline();
  const save = useSetOdometer(vehicleId);
  const [text, setText] = useState(() => (km === null ? '' : plainNumber(toUnit(km, unit))));
  const [error, setError] = useState<string | undefined>(undefined);
  const queue = (next: number) => {
    queueMaintenance(vehicleId, vehicleId, { kind: 'odometer.set', payload: { km: next } });
    toast(t('maintenance.outbox.queued'), { testID: `${ROUTE}.toast` });
    onClose();
  };
  const submit = () => {
    const value = parseWhole(text);
    if (value === null || value === undefined) {
      haptics.warning();
      setError(t('maintenance.validation.distance'));
      return;
    }
    const next = fromUnit(value, unit);
    if (!online) {
      queue(next);
      return;
    }
    save.mutate(next, {
      onSuccess: () => {
        toast(t('maintenance.odometer.saved'), { haptic: 'success', testID: `${ROUTE}.toast` });
        onClose();
      },
      onError: (failure) => {
        if (!(failure instanceof ApiError) || failure.kind === 'network') {
          queue(next);
          return;
        }
        setError(failure.fieldErrors.km?.[0] ?? failure.message);
      },
    });
  };
  return (
    <View style={styles.sheetBody}>
      <TextInput
        label={t('maintenance.odometer.label', { unit })}
        value={text}
        onChangeText={(next) => {
          setText(next);
          setError(undefined);
        }}
        helper={t('maintenance.odometer.helper')}
        error={error}
        keyboardType="number-pad"
        inputMode="numeric"
        autoFocus
        onSubmitEditing={submit}
        testID={`${ROUTE}.odometerSheet.input`}
      />
      <Button label={t('maintenance.odometer.save')} size="l" fullWidth loading={save.isPending} onPress={submit} testID={`${ROUTE}.odometerSheet.save`} />
    </View>
  );
}

/**
 * DQ-1127: "0 € Wartung · 6.500 € Umbauten" with each amount bound to its word (no-break spaces), so a narrow column breaks only at
 * the separator, between the two pairs.
 */
export function costLine(t: ReturnType<typeof useTranslation<'garage'>>['t'], maintenance: string, mods: string): string {
  const bind = (text: string) => text.replace(/ /g, '\u00A0');
  return `${bind(t('maintenance.costs.maintenancePart', { amount: maintenance }))} · ${bind(t('maintenance.costs.modsPart', { amount: mods }))}`;
}

/** Private costs (ADR-441): the current year and the years before, maintenance and modifications. Never shown to anybody else. */
export function CostsBlock({ costs }: { costs: MaintenanceCosts | undefined }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  if (!costs) return null;
  const total = numberOrNull(costs.total_cents) ?? 0;
  return (
    <View style={styles.pageSection} testID={`${ROUTE}.costs`}>
      <SectionHeader title={t('maintenance.costs.title')} />
      <RowGroup>
        <View style={styles.costsHead}>
          <Text variant="heroNumeralS" numeric testID={`${ROUTE}.costs.total`}>
            {euroText(total, format.locale)}
          </Text>
          <Text variant="caption" color="text.secondary">
            {total === 0 ? t('maintenance.costs.empty') : t('maintenance.costs.note')}
          </Text>
        </View>
        {costs.years.map((year, index) => (
          <ListRow
            key={year.year}
            title={String(year.year)}
            subtitle={costLine(t, euroText(year.maintenance_cents, format.locale), euroText(year.mods_cents, format.locale))}
            hyphenate={false}
            value={euroText(year.total_cents, format.locale)}
            divider={index < costs.years.length - 1}
            testID={`${ROUTE}.costs.${year.year}`}
          />
        ))}
      </RowGroup>
    </View>
  );
}

/** Verlauf: one timeline entry per service log entry, grouped by month; cost and photos are the owner's alone. */
export function logEntries(
  t: ReturnType<typeof useTranslation<'garage'>>['t'],
  logs: readonly MaintenanceLog[],
  unit: DistanceUnit,
  locale: 'de' | 'en',
  onOpen: (log: MaintenanceLog) => void,
): TimelineEntry[] {
  return logs.map((log) => {
    const day = dayDate(log.done_at);
    const lines = [
      ...(log.workshop ? [{ key: 'workshop', label: t('maintenance.log.workshop', { name: log.workshop }), inline: true }] : []),
      ...(log.cost ? [{ key: 'cost', label: t('maintenance.log.cost', { cost: `${euroText(log.cost.cents, locale)} · ${t('maintenance.private')}` }), inline: true }] : []),
    ];
    return {
      key: log.id,
      date: day ? formatMonthYear(day, locale) : '',
      title: log.type === 'custom' || log.title ? (log.title ?? t('maintenance.type.custom')) : t(`maintenance.type.${log.type}`),
      lines,
      note: log.notes ?? undefined,
      mileage: log.mileage_km !== null ? distanceText(log.mileage_km, unit, locale) : undefined,
      photos: log.photos.slice(0, LOG_PHOTOS_SHOWN).map((photo, photoIndex) => {
        const variant = [...photo.variants].sort((a, b) => a.width - b.width).find((entry) => entry.width >= THUMB_WIDTH) ?? photo.variants[photo.variants.length - 1];
        return { source: variant?.url ?? null, blurhash: photo.blurhash, alt: t('maintenance.editor.photoAlt', { index: photoIndex + 1 }) };
      }),
      onPress: () => onOpen(log),
      testID: `${ROUTE}.log.${log.id}`,
    };
  });
}

export function HistoryTimeline({ entries }: { entries: TimelineEntry[] }) {
  return <Timeline entries={entries} testID={`${ROUTE}.history`} />;
}

/** The skeleton: band, the hero ring with its lines, then a group of rows (DQ-207 geometry). */
export function MaintenanceSkeleton({ band }: { band: boolean }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeleton}>
        {band ? <SkeletonBlock aspectRatio={16 / 9} corner="none" /> : null}
        <View style={styles.skeletonHero}>
          <SkeletonBlock width={size.avatar.xl} height={size.avatar.xl} corner="full" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="heroNumeralS" width="30%" />
            <SkeletonText variant="headline" width="50%" />
            <SkeletonText variant="callout" width="70%" />
          </View>
        </View>
        <View style={styles.skeletonRows}>
          <SkeletonText variant="calloutStrong" width="35%" />
          <SkeletonBlock height={size.row.withThumb * 3} corner="md" />
        </View>
      </View>
    </Skeleton>
  );
}

/** The empty state's preview (DQ-1033): a real hero card of an HU/AU due in four months, badged "Beispiel". */
export function SamplePreview() {
  const { t } = useTranslation('garage');
  const format = useFormat();
  const today = now();
  const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 4, 1, 12));
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  return (
    <View testID={`${ROUTE}.sample`}>
      <MaintenanceCard
        variant="hero"
        title={t('maintenance.type.hu_au')}
        glyph="hu-plakette"
        due={t('maintenance.due.month', { month: formatMonthYear(due, format.locale) })}
        countdown={t('maintenance.countdown.untilDue')}
        figure={{ value: format.number(days), unit: t('maintenance.unit.days', { count: days }) }}
        tone="ok"
        progress={0.82}
        badge={<Badge kind="sample" />}
      />
    </View>
  );
}
