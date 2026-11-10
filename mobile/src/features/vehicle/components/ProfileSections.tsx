import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { usePublicVehicleUpdates, type BuildUpdate, type PublicModRow, type PublicVehicle, type VehicleMedia } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { createStyles, space } from '@/theme';
import { Button, Icon, ModRow, Photo, PressableScale, SectionHeader, SpecRow, Text } from '@/ui';
import { joinLabel, RowBody, useStacksAtFontScale } from '@/ui/rowParts';
import { ValueText } from '@/ui/ValueText';
import { TranslatableText } from '@/features/ai/TranslatableText';

import { useLegalPill } from '../legal';
import { photoFields } from '../media';
import {
  categoryIcon,
  changeLines,
  groupByMonth,
  mergeUpdates,
  modValues,
  ownerName,
  previewPhotos,
  provenanceOf,
  specGroupsOf,
} from '../model';
import { Description } from './Description';
import { GroupHeader, RowCard } from './RowCard';

/** Changes an entry of Verlauf shows before "und 2 weitere Änderungen"; VEH-05 has all of them. */
export const HISTORY_CHANGES_SHOWN = 3;
/** The photo preview of FS-3 is 2 × 2. */
const PREVIEW_COLUMNS = 2;
const PREVIEW_TILE_WIDTH = 320;

const useStyles = createStyles((t) => ({
  section: { marginTop: t.space[32] },
  first: { marginTop: 0 },
  headerToContent: { marginBottom: t.space[12] },
  groupGap: { marginTop: t.space[24] },
  previewRows: { gap: t.space[8] },
  previewRow: { flexDirection: 'row', gap: t.space[8] },
  previewTile: { flex: 1 },
  previewVisual: { borderRadius: t.radius.sm },
  closing: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, marginTop: t.space[32], padding: t.space[16] },
  closingBody: { marginTop: t.space[4] },
  closingAction: { marginTop: t.space[12] },
  disclaimer: { marginTop: t.space[16] },
  month: { marginTop: t.space[24] },
  monthFirst: { marginTop: 0 },
  timeline: {
    borderLeftColor: t.color.border.default,
    borderLeftWidth: isWeb ? t.size.border.control : StyleSheet.hairlineWidth,
    marginTop: t.space[8],
  },
  entry: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8], paddingLeft: t.space[16], paddingRight: t.space[8], paddingVertical: t.space[8] },
  entryText: { flex: 1, gap: t.space[2], minWidth: 0 },
  change: { gap: t.space[2] },
  caret: { paddingTop: t.space[2] },
  loadOlder: { alignSelf: 'flex-start', marginTop: t.space[16] },
  loadError: { marginTop: t.space[16] },
}));

type Navigation = {
  onOpenMod: (mod: PublicModRow) => void;
};

export type OverviewSectionProps = Navigation & {
  vehicle: PublicVehicle;
  routeId: string;
  /** GAR-02: the owner's completeness hints and anything else only the owner sees, first in the tab. */
  ownerContent?: ReactNode;
  /** The closing owner card of FS-3, with its action; null leaves the card out. */
  closingAction?: { label: string; onPress: () => void } | null;
  /** False on a desktop, where the thumbnails under the hero show the same photos (WEB-01 does the same). */
  showPhotoPreview?: boolean;
  /** [SIG] FS-3 "Ähnliche Builds", after the photos and before the closing owner card (M2.3, features/discover). */
  similar?: ReactNode;
  onShowMods: () => void;
  onOpenGallery: () => void;
  /** The index in the vehicle's photos. */
  onOpenPhoto: (index: number) => void;
};

/** FS-3 Übersicht: description, three highlights with "Alle Mods (14)", the photo preview with "Alle Fotos (12)", owner card. */
export function OverviewSection({
  vehicle,
  routeId,
  ownerContent,
  closingAction,
  showPhotoPreview = true,
  similar,
  onShowMods,
  onOpenGallery,
  onOpenPhoto,
  onOpenMod,
}: OverviewSectionProps) {
  const { t } = useTranslation('vehicle');
  const legalPill = useLegalPill();
  const styles = useStyles();
  const description = vehicle.description?.trim();
  const preview = showPhotoPreview ? previewPhotos(vehicle) : [];
  const blocks: ReactNode[] = [];

  if (ownerContent) blocks.push(<View key="owner">{ownerContent}</View>);
  if (description) {
    // M3.7 ai.translate: another member's description gets "Übersetzen" under it; the owner reads their own words.
    const own = vehicle.is_owner || Boolean(vehicle.owner?.is_self);
    blocks.push(
      own ? (
        <Description key="description" text={description} testID={`${routeId}.description`} moreTestID={`${routeId}.more`} />
      ) : (
        <TranslatableText
          key="description"
          source="vehicle_description"
          id={vehicle.id}
          text={description}
          render={(shown) => <Description key={shown} text={shown} testID={`${routeId}.description`} moreTestID={`${routeId}.more`} />}
          testID={`${routeId}.description`}
        />
      ),
    );
  }
  if (vehicle.highlights.length > 0) {
    blocks.push(
      <View key="highlights" testID={`${routeId}.highlights`}>
        <SectionHeader
          title={t('overview.highlights')}
          actionLabel={t('overview.allMods', { count: vehicle.mods.count })}
          onAction={onShowMods}
          wraps
          style={styles.headerToContent}
          testID={`${routeId}.highlights.header`}
        />
        <RowCard>
          {vehicle.highlights.map((mod, index) => (
            <ModRow
              key={mod.id}
              icon={categoryIcon(mod.category.icon)}
              name={mod.title}
              values={modValues(mod)}
              status={mod.status_label}
              {...legalPill(mod)}
              onPress={() => onOpenMod(mod)}
              divider={index < vehicle.highlights.length - 1}
              inset={space[16]}
              testID={`${routeId}.highlight.${index}`}
            />
          ))}
        </RowCard>
        {/* 08_LEGAL §7: a stated legal status always shows with the disclaimer, here as under the Mods tab. */}
        {vehicle.highlights.some((mod) => legalPill(mod).legalStatus) ? (
          <Text variant="helper" color="text.tertiary" style={styles.disclaimer} testID={`${routeId}.highlights.legalDisclaimer`}>
            {t('mods.disclaimer')}
          </Text>
        ) : null}
      </View>,
    );
  }
  if (preview.length > 0) {
    blocks.push(
      <View key="photos" testID={`${routeId}.photoPreview`}>
        <SectionHeader
          title={t('overview.photos')}
          actionLabel={t('overview.allPhotos', { count: vehicle.photo_count })}
          onAction={onOpenGallery}
          wraps
          style={styles.headerToContent}
          testID={`${routeId}.photoPreview.header`}
        />
        <PhotoPreview
          photos={preview}
          total={vehicle.photo_count}
          fallbackAlt={vehicle.full_title}
          onOpen={(position) => onOpenPhoto(position + 1)}
          testID={`${routeId}.photoPreview.tile`}
        />
      </View>,
    );
  }
  if (!description && vehicle.highlights.length === 0 && preview.length === 0) {
    blocks.push(
      <Text key="empty" variant="body" color="text.secondary" testID={`${routeId}.overviewEmpty`}>
        {t('overview.empty')}
      </Text>,
    );
  }
  if (similar) blocks.push(<View key="similar">{similar}</View>);

  return (
    <View>
      {blocks.map((block, index) => (
        <View key={index} style={index === 0 ? styles.first : styles.section}>
          {block}
        </View>
      ))}
      {vehicle.owner && closingAction ? (
        <View style={styles.closing} testID={`${routeId}.closingOwner`}>
          <Text variant="titleS">{t('overview.closingTitle', { name: ownerName(vehicle.owner) })}</Text>
          <Text variant="supporting" color="text.secondary" style={styles.closingBody}>
            {t('overview.closingBody')}
          </Text>
          <Button
            label={closingAction.label}
            variant="primary"
            size="m"
            onPress={closingAction.onPress}
            style={styles.closingAction}
            testID={`${routeId}.closingMessage`}
          />
        </View>
      ) : null}
    </View>
  );
}

type PhotoPreviewProps = {
  photos: readonly VehicleMedia[];
  /** All photos of the vehicle, for "Foto 2 von 12". */
  total: number;
  fallbackAlt: string;
  /** The index inside `photos`. */
  onOpen: (index: number) => void;
  testID: string;
};

function PhotoPreview({ photos, total, fallbackAlt, onOpen, testID }: PhotoPreviewProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const rows: VehicleMedia[][] = [];
  for (let start = 0; start < photos.length; start += PREVIEW_COLUMNS) rows.push(photos.slice(start, start + PREVIEW_COLUMNS));
  return (
    <View style={styles.previewRows}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.previewRow}>
          {row.map((photo, cell) => {
            const position = rowIndex * PREVIEW_COLUMNS + cell;
            return (
              <PressableScale
                key={photo.id}
                role="button"
                aria-label={t('hero.open', { alt: photo.alt || fallbackAlt, current: position + 2, total })}
                onPress={() => onOpen(position)}
                style={styles.previewTile}
                contentStyle={styles.previewVisual}
                testID={`${testID}.${position}`}
              >
                <Photo {...photoFields(photo, PREVIEW_TILE_WIDTH)} aspect="4:3" corner="sm" />
              </PressableScale>
            );
          })}
          {row.length < PREVIEW_COLUMNS ? <View style={styles.previewTile} /> : null}
        </View>
      ))}
    </View>
  );
}

/** FS-3 Technik: the API's groups (Fahrzeug, Motor, Leistung, Antrieb) as spec tables with provenance. */
export function SpecsSection({ vehicle, routeId }: { vehicle: PublicVehicle; routeId: string }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const groups = specGroupsOf(vehicle);
  if (groups.length === 0) {
    return (
      <Text variant="body" color="text.secondary" testID={`${routeId}.specsEmpty`}>
        {t('specs.empty')}
      </Text>
    );
  }
  return (
    <View>
      {groups.map((group, index) => (
        <View key={group.key} style={index === 0 ? null : styles.groupGap} testID={`${routeId}.specs.${group.key}`}>
          <GroupHeader title={group.label} style={styles.headerToContent} />
          <RowCard>
            {group.rows.map((row, rowIndex) => (
              <SpecRow
                key={row.key}
                label={row.label}
                value={row.value}
                provenance={provenanceOf(row)}
                divider={rowIndex < group.rows.length - 1}
                inset={space[16]}
                testID={`${routeId}.spec.${row.key}`}
              />
            ))}
          </RowCard>
        </View>
      ))}
    </View>
  );
}

/** FS-3 Mods: groups by category (glyph, `title.s`, count) with mod rows, then the disclaimer of 08_LEGAL §7. */
export function ModsSection({ vehicle, routeId, onOpenMod }: Navigation & { vehicle: PublicVehicle; routeId: string }) {
  const { t } = useTranslation('vehicle');
  const legalPill = useLegalPill();
  const styles = useStyles();
  const groups = vehicle.mods.groups.filter((group) => group.items.length > 0);
  if (groups.length === 0) {
    return (
      <Text variant="body" color="text.secondary" testID={`${routeId}.modsEmpty`}>
        {t('mods.empty')}
      </Text>
    );
  }
  return (
    <View>
      {groups.map((group, index) => (
        <View key={group.category.key} style={index === 0 ? null : styles.groupGap} testID={`${routeId}.mods.${group.category.key}`}>
          <GroupHeader
            title={group.category.name}
            icon={categoryIcon(group.category.icon)}
            count={group.count}
            countLabel={t('mods.count', { count: group.count })}
            style={styles.headerToContent}
          />
          <RowCard>
            {group.items.map((mod, rowIndex) => (
              <ModRow
                key={mod.id}
                icon={categoryIcon(mod.category.icon)}
                name={mod.title}
                values={modValues(mod)}
                status={mod.status_label}
                {...legalPill(mod)}
                onPress={() => onOpenMod(mod)}
                divider={rowIndex < group.items.length - 1}
                inset={space[16]}
                testID={`${routeId}.mod.${mod.id}`}
              />
            ))}
          </RowCard>
        </View>
      ))}
      <Text variant="helper" color="text.tertiary" style={styles.disclaimer} testID={`${routeId}.legalDisclaimer`}>
        {t('mods.disclaimer')}
      </Text>
    </View>
  );
}

export type HistorySectionProps = {
  vehicle: PublicVehicle;
  routeId: string;
  onOpenUpdate: (update: BuildUpdate) => void;
};

/** FS-3 Verlauf: entries by month on one hairline, each opening VEH-05. Older entries load on request, 30 at a time. */
export function HistorySection({ vehicle, routeId, onOpenUpdate }: HistorySectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const [wantsOlder, setWantsOlder] = useState(false);
  const older = usePublicVehicleUpdates(vehicle.slug, wantsOlder);
  const pages = older.data?.pages.flatMap((page) => page.data) ?? [];
  const updates = mergeUpdates(vehicle.updates, pages);
  const months = groupByMonth(updates);
  const remaining = Math.max(0, vehicle.updates_count - updates.length);
  // Once the list route has answered, its cursor decides; the count can lag behind a hidden entry.
  const canLoadOlder = remaining > 0 && (!older.data || older.hasNextPage);
  const loadOlder = () => {
    if (!wantsOlder) setWantsOlder(true);
    else if (older.data) void older.fetchNextPage();
    else void older.refetch();
  };

  if (updates.length === 0) {
    return (
      <Text variant="body" color="text.secondary" testID={`${routeId}.historyEmpty`}>
        {t('history.empty')}
      </Text>
    );
  }

  return (
    <View>
      {months.map((month, index) => (
        <View key={`${month.label}-${index}`} style={index === 0 ? styles.monthFirst : styles.month} testID={`${routeId}.month.${index}`}>
          {month.label ? (
            <Text variant="labelS" color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)}>
              {month.label}
            </Text>
          ) : null}
          <View style={styles.timeline}>
            {month.updates.map((update) => (
              <HistoryEntry key={update.id} update={update} onPress={() => onOpenUpdate(update)} testID={`${routeId}.update.${update.id}`} />
            ))}
          </View>
        </View>
      ))}
      {older.isError && !older.isFetching ? (
        <Text variant="supporting" color="text.secondary" role="alert" style={styles.loadError} testID={`${routeId}.history.loadError`}>
          {t('history.loadError')}
        </Text>
      ) : null}
      {canLoadOlder ? (
        <Button
          label={t('history.loadOlder', { count: remaining })}
          variant="secondary"
          size="m"
          loading={older.isFetching}
          onPress={loadOlder}
          style={styles.loadOlder}
          testID={`${routeId}.history.loadOlder`}
        />
      ) : null}
    </View>
  );
}

function HistoryEntry({ update, onPress, testID }: { update: BuildUpdate; onPress: () => void; testID: string }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const { lines, more } = changeLines(update, HISTORY_CHANGES_SHOWN);
  const note = update.note?.trim();
  const moreText = more > 0 ? t('history.moreChanges', { count: more }) : undefined;

  return (
    <RowBody
      onPress={onPress}
      label={joinLabel([...lines.flatMap((line) => [line.label, line.diff]), lines.length === 0 ? update.type_label : null, note, moreText])}
      style={styles.entry}
      testID={testID}
    >
      <View style={styles.entryText}>
        {lines.length === 0 ? <Text variant="bodyStrong">{update.type_label}</Text> : null}
        {lines.map((line) => (
          <View key={line.key} style={styles.change}>
            <Text variant="bodyStrong">{line.label}</Text>
            {line.diff ? (
              <ValueText variant="supporting" color="text.secondary" hyphenate={largeFont} values={line.diff} wholeValues={!largeFont} />
            ) : null}
          </View>
        ))}
        {note ? (
          <Text variant="supporting" color="text.secondary">
            {note}
          </Text>
        ) : null}
        {moreText ? (
          <Text variant="caption" color="text.tertiary">
            {moreText}
          </Text>
        ) : null}
      </View>
      <View style={styles.caret}>
        <Icon name="caret-right" size={16} color="text.tertiary" />
      </View>
    </RowBody>
  );
}
