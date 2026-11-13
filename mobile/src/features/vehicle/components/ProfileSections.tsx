import { useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { usePublicVehicleUpdates, type BuildUpdate, type PublicModRow, type PublicVehicle, type VehicleMedia } from '@/api/queries/vehicles';
import { createStyles, layout as layoutTokens, size, space } from '@/theme';
import { BuildSheet, BuildSheetRow, Button, Photo, PressableScale, SectionHeader, SpecRow, Text, Timeline, type BuildSheetSection, type TimelineEntry } from '@/ui';
import { TranslatableText } from '@/features/ai/TranslatableText';
import { unpairedPhotos, updatePairs } from '@/features/updates/model';
import { useFormat } from '@/lib/useFormat';

import { useLegalPill } from '../legal';
import { photoFields, visiblePhotos } from '../media';
import {
  categoryIcon,
  changeLines,
  historyMetaLine,
  historyTitle,
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
/** DQ-1078 (09 §7.6 Übersicht): the photo preview is a 3-up grid, 1:1 tiles 2 apart, edge to edge of the column. */
const PREVIEW_COLUMNS = 3;
const PREVIEW_TILE_WIDTH = 320;

const useStyles = createStyles((t) => ({
  section: { marginTop: t.space[32] },
  first: { marginTop: 0 },
  headerToContent: { marginBottom: t.space[12] },
  groupGap: { marginTop: t.space[24] },
  previewRows: { gap: t.space[2] },
  previewRow: { flexDirection: 'row', gap: t.space[2] },
  previewTile: { flex: 1 },
  previewVisual: { borderRadius: t.radius.none },
  closing: { alignItems: 'flex-start', gap: t.space[4], marginTop: t.space[32] },
  closingAction: { marginLeft: -t.space[12] },
  disclaimer: { marginTop: t.space[16] },
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
  /**
   * DQ-1057: a guest's one line under the content, "Melde dich an, um Lukas zu schreiben." with its link; null leaves it out (a
   * member writes from the action row's "Nachricht").
   */
  closingAction?: { label: string; onPress: () => void } | null;
  /** The photo preview (3-up, DQ-1078); on at every width since the desktop hero has no thumbnails (DQ-1048). */
  showPhotoPreview?: boolean;
  /** [SIG] FS-3 "Ähnliche Builds", after the photos and before the closing owner card (M2.3, features/discover). */
  similar?: ReactNode;
  /**
   * 09 §7.6 Übersicht: the owner-pinned Highlights rail, right after the description (M4.11). A render function told whether it is
   * the first block, so the rail adds its own gap (above it, or below it when first) and an empty rail leaves none (DQ-1056).
   */
  pins?: (first: boolean) => ReactNode;
  /** 09 §7.6 Übersicht: the latest update as a feed card, after the top mods. */
  latest?: ReactNode;
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
  pins,
  latest,
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
  // DQ-1056: no wrapper gap; the rail brings its own when it shows.
  const pinsNode = pins ? pins(blocks.length === 0) : null;
  const pinsIndex = blocks.length;
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
        {/* DQ-954: the same row as the Mods tab (BuildSheet's ModRow 2.0: glyph tile, brand, pills), without section headers. */}
        <RowCard>
          {vehicle.highlights.map((mod, index) => (
            <BuildSheetRow
              key={mod.id}
              mod={{
                key: mod.id,
                icon: categoryIcon(mod.category.icon),
                name: mod.title,
                brand: mod.brand ?? null,
                ...(modValues(mod) ? { values: modValues(mod) } : {}),
                status: mod.status_label,
                ...legalPill(mod),
                onPress: () => onOpenMod(mod),
                testID: `${routeId}.highlight.${index}`,
              }}
              divider={index < vehicle.highlights.length - 1}
            />
          ))}
        </RowCard>
        {/* 08_LEGAL §7: a stated legal status always shows with the disclaimer, here as under the Mods tab. */}
        {vehicle.highlights.some((mod) => legalPill(mod).legalStatus) ? (
          <Text variant="caption" color="text.tertiary" style={styles.disclaimer} testID={`${routeId}.highlights.legalDisclaimer`}>
            {t('mods.disclaimer')}
          </Text>
        ) : null}
      </View>,
    );
  }
  if (latest) blocks.push(<View key="latest">{latest}</View>);
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
          onOpen={(position) => {
            const photo = preview[position];
            const index = photo ? visiblePhotos(vehicle.photos).findIndex((item) => item.id === photo.id) : -1;
            onOpenPhoto(Math.max(0, index));
          }}
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
        <View key={index}>
          {index === pinsIndex ? pinsNode : null}
          <View style={index === 0 ? styles.first : styles.section}>{block}</View>
        </View>
      ))}
      {pinsIndex === blocks.length ? pinsNode : null}
      {vehicle.owner && closingAction ? (
        // DQ-1057: one line and a text link for a guest, no card that repeats the action row's "Nachricht".
        <View style={styles.closing} testID={`${routeId}.closingOwner`}>
          <Text variant="callout" color="text.secondary">
            {t('overview.closingGuest', { name: ownerName(vehicle.owner) })}
          </Text>
          <Button label={closingAction.label} variant="tertiary" size="s" onPress={closingAction.onPress} style={styles.closingAction} testID={`${routeId}.closingMessage`} />
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
  // The row starts after the hero's photo, or from the first one for a build with fewer than four (previewPhotos).
  const offset = total >= 4 ? 1 : 0;
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
                aria-label={t('hero.open', { alt: photo.alt || fallbackAlt, current: position + 1 + offset, total })}
                onPress={() => onOpen(position)}
                style={styles.previewTile}
                contentStyle={styles.previewVisual}
                testID={`${testID}.${position}`}
              >
                <Photo {...photoFields(photo, PREVIEW_TILE_WIDTH)} aspect="1:1" corner="none" />
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

/** FS-3 Mods: groups by category (glyph, `headline`, count) with mod rows, then the disclaimer of 08_LEGAL §7. */
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
  const sections: BuildSheetSection[] = groups.map((group) => ({
    key: group.category.key,
    title: group.category.name,
    icon: categoryIcon(group.category.icon),
    count: group.count,
    countLabel: t('mods.count', { count: group.count }),
    testID: `${routeId}.mods.${group.category.key}`,
    mods: group.items.map((mod) => ({
      key: mod.id,
      icon: categoryIcon(mod.category.icon),
      name: mod.title,
      // DQ-952: the brand caption on every row that has a brand, as the DEV-01 anatomy ("BBS LM" by BBS).
      brand: mod.brand ?? null,
      ...(modValues(mod) ? { values: modValues(mod) } : {}),
      status: mod.status_label,
      ...legalPill(mod),
      // Behaviour kept: a row opens VEH-02 (with the chevron). The inline expand waits for the details the API does not list
      // yet (photos, product link, "Eingebaut von"), which VEH-02 shows; costs stay private (09 §7.6 GAR-10).
      onPress: () => onOpenMod(mod),
      testID: `${routeId}.mod.${mod.id}`,
    })),
  }));
  return (
    <View>
      <BuildSheet sections={sections} testID={`${routeId}.buildSheet`} />
      <Text variant="caption" color="text.tertiary" style={styles.disclaimer} testID={`${routeId}.legalDisclaimer`}>
        {t('mods.disclaimer')}
      </Text>
    </View>
  );
}

/** Verlauf shows up to three photos per entry (Timeline's 3-up grid); a third of the column, a pair the whole column. */
const HISTORY_PHOTOS_SHOWN = 3;
const HISTORY_PHOTO_WIDTH = size.railCard;
const HISTORY_PAIR_WIDTH = layoutTokens.feedColumn;

export type HistorySectionProps = {
  vehicle: PublicVehicle;
  routeId: string;
  onOpenUpdate: (update: BuildUpdate) => void;
};

/** FS-3 Verlauf: entries by month on one hairline, each opening VEH-05. Older entries load on request, 30 at a time. */
export function HistorySection({ vehicle, routeId, onOpenUpdate }: HistorySectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const [wantsOlder, setWantsOlder] = useState(false);
  const older = usePublicVehicleUpdates(vehicle.slug, wantsOlder);
  const pages = older.data?.pages.flatMap((page) => page.data) ?? [];
  const updates = mergeUpdates(vehicle.updates, pages);
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
      <Timeline
        entries={updates.map((update) =>
          historyEntry(update, t, () => onOpenUpdate(update), `${routeId}.update.${update.id}`, (value) => format.number(value)),
        )}
        groupTestID={(index) => `${routeId}.month.${index}`}
        testID={`${routeId}.timeline`}
      />
      {older.isError && !older.isFetching ? (
        <Text variant="callout" color="text.secondary" role="alert" style={styles.loadError} testID={`${routeId}.history.loadError`}>
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

/** One entry of Verlauf as the Timeline shows it (09 §5): the type as title, its first changes, the note, the rest as a count. */
function historyEntry(
  update: BuildUpdate,
  t: TFunction<'vehicle'>,
  onPress: () => void,
  testID: string,
  number: (value: number) => string,
): TimelineEntry {
  // DQ-975: an update's own photos (M4.11) show in Verlauf, a before/after pair as the SM17 slider.
  const pair = updatePairs(update)[0];
  const photos = unpairedPhotos(update)
    .slice(0, HISTORY_PHOTOS_SHOWN)
    .map((photo) => ({ ...photoFields(photo, HISTORY_PHOTO_WIDTH), alt: photo.alt ?? undefined }));
  // DQ-977: a title that names the change is followed by the system and the key value only, never the change again.
  const meta = historyMetaLine(update);
  const { lines, more } = meta ? { lines: [meta], more: 0 } : changeLines(update, HISTORY_CHANGES_SHOWN);
  const note = update.note?.trim();
  return {
    key: update.id,
    date: update.month_label ?? '',
    title: historyTitle(update, (key, values) => t(`history.title.${key}`, values)),
    lines: lines.map((line) => ({ key: line.key, label: line.label, ...(line.diff ? { detail: line.diff } : {}), ...(meta ? { inline: true } : {}) })),
    ...(note ? { note } : {}),
    ...(more > 0 ? { more: t('history.moreChanges', { count: more }) } : {}),
    ...(pair
      ? {
          beforeAfter: {
            before: { ...photoFields(pair.before, HISTORY_PAIR_WIDTH), label: t('update.before') },
            after: { ...photoFields(pair.after, HISTORY_PAIR_WIDTH), label: t('update.after') },
            label: t('update.beforeAfter'),
          },
        }
      : photos.length > 0
        ? { photos }
        : {}),
    ...(update.mileage_km !== null ? { mileage: t('update.mileage', { value: number(update.mileage_km) }) } : {}),
    onPress,
    testID,
  };
}
