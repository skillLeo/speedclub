import { useRouter } from 'expo-router';
import { Fragment, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBusinessesOn } from '@/api/queries/businesses';
import { usePartsOn } from '@/api/queries/parts';
import type { BuildUpdate, PublicModRow, PublicVehicle, VehicleMedia } from '@/api/queries/vehicles';
import { createStyles, layout as layoutTokens, size, space } from '@/theme';
import { type BuildSheetLink, type BuildSheetMod } from '@/ui/BuildSheet';
import { Button } from '@/ui/Button';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { SpecRow } from '@/ui/SpecRow';
import { Text } from '@/ui/Text';
import { type TimelineEntry } from '@/ui/Timeline';
import { TranslatableText } from '@/features/ai/TranslatableText';
import { journeyPair } from '@/features/score/journey';
import { unpairedPhotos, updatePairs } from '@/features/updates/model';

import { useLegalPill } from '../legal';
import { photoFields } from '../media';
import {
  categoryIcon,
  changeLines,
  historyMetaLine,
  historyTitle,
  modValues,
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
  emptyBlock: { alignItems: 'flex-start', gap: t.space[4] },
  descriptionTitle: { marginBottom: t.space[8] },
  closingAction: { marginLeft: -t.size.buttonPaddingX.s },
}));

export type OverviewSectionProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** GAR-02: the owner's completeness hints and anything else only the owner sees, first in the section. */
  ownerContent?: ReactNode;
  /**
   * M5.9c ★ the Build Score section (gauge, stage, ranks, "So entsteht …", the owner's "Nächstes Upgrade"), after the owner's lines
   * and before the description. A render function told whether it is the first block, so it brings its own gap and leaves none when
   * it has nothing to show (as `pins`, DQ-1056).
   */
  score?: (first: boolean) => ReactNode;
  /**
   * 09 §7.6 Überblick: the owner-pinned Highlights rail, right after the description (M4.11). A render function told whether it is
   * the first block, so the rail adds its own gap (above it, or below it when first) and an empty rail leaves none (DQ-1056).
   */
  pins?: (first: boolean) => ReactNode;
  /** 10 §5.6 / §6.2: the Build-Fortschritt card, last in Überblick; null when this reader gets none. */
  progress?: ReactNode;
  /** R5-5: the entry to the car's own comments, after the description and the Highlights; null when this reader gets none. */
  comments?: ReactNode;
  /** The owner's one action when Überblick has no description ("Beschreibung schreiben"). */
  onWriteDescription?: () => void;
  /** DQ-M53-05: `owner` reads description → Build-Fortschritt → Build Score → Highlights; `visitor` puts the score first. */
  order?: 'owner' | 'visitor';
};

/**
 * 10 §5.6 Überblick (one scroll, ADR-505): the owner's lines, the Build Score, the description, the Highlights rail and the
 * Build-Fortschritt card. Mods, Verlauf and the photos are sections of their own now.
 */
export function OverviewSection({ vehicle, routeId, ownerContent, score, pins, progress, comments, onWriteDescription, order = 'visitor' }: OverviewSectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const description = vehicle.description?.trim();
  const own = vehicle.is_owner || Boolean(vehicle.owner?.is_self);

  const descriptionBody = description ? (
    // M3.7 ai.translate: another member's description gets "Übersetzen" under it; the owner reads their own words.
    own ? (
      <Description text={description} testID={`${routeId}.description`} moreTestID={`${routeId}.more`} />
    ) : (
      <TranslatableText
        source="vehicle_description"
        id={vehicle.id}
        text={description}
        render={(shown) => <Description key={shown} text={shown} testID={`${routeId}.description`} moreTestID={`${routeId}.more`} />}
        testID={`${routeId}.description`}
      />
    )
  ) : (
    <View style={styles.emptyBlock}>
      <Text variant="body" color="text.secondary" testID={`${routeId}.overviewEmpty`}>
        {t('overview.empty')}
      </Text>
      {onWriteDescription ? (
        <Button label={t('overview.write')} variant="tertiary" size="s" onPress={onWriteDescription} style={styles.closingAction} testID={`${routeId}.overview.write`} />
      ) : null}
    </View>
  );
  // Client feedback CF-3: the owner's own words are labelled "Beschreibung", for visitors and the owner alike.
  const descriptionBlock = (
    <View testID={`${routeId}.descriptionBlock`}>
      <Text variant="headline" role="heading" {...({ 'aria-level': 3 } as object)} style={styles.descriptionTitle} testID={`${routeId}.descriptionTitle`}>
        {t('overview.descriptionTitle')}
      </Text>
      {descriptionBody}
    </View>
  );

  // DQ-M53-05 (10 §5.6, "simpler, not busier"): the owner reads the build first — description, Build-Fortschritt, then the Build Score
  // and the Highlights; a visitor gets the score's verdict first. The owner's meta line (HU, spots) stays on top in both.
  const sequence: readonly OverviewPart[] =
    order === 'owner'
      ? ['owner', 'description', 'progress', 'score', 'pins', 'comments']
      : ['owner', 'score', 'description', 'pins', 'comments', 'progress'];
  const blockOf: Record<'owner' | 'description' | 'progress' | 'comments', ReactNode> = {
    owner: ownerContent ?? null,
    description: descriptionBlock,
    progress: progress ?? null,
    comments: comments ?? null,
  };

  // One flat list keyed by what each part is, never by its position: the owner's lines load after the first frame (VehicleScreen's next
  // HU and spot line), and a block keyed by index moved the score section into another parent, which remounted it and closed its open
  // "So entsteht …" or "Journey teilen" sheet. A self-spacing part (score, rail) is told whether a block came before it (DQ-1056).
  const parts: ReactNode[] = [];
  let blocks = 0;
  for (const part of sequence) {
    if (part === 'score' || part === 'pins') {
      const render = part === 'score' ? score : pins;
      parts.push(<Fragment key={part}>{render ? render(blocks === 0) : null}</Fragment>);
      continue;
    }
    const block = blockOf[part];
    if (!block) continue;
    parts.push(
      <View key={`block-${part}`} style={blocks === 0 ? styles.first : styles.section}>
        {block}
      </View>,
    );
    blocks += 1;
  }

  return <View>{parts}</View>;
}

type OverviewPart = 'owner' | 'score' | 'description' | 'pins' | 'comments' | 'progress';

type PhotoPreviewProps = {
  photos: readonly VehicleMedia[];
  /** All photos of the vehicle, for "Foto 2 von 12". */
  total: number;
  fallbackAlt: string;
  /** The index inside `photos`. */
  onOpen: (index: number) => void;
  testID: string;
};

export function PhotoPreview({ photos, total, fallbackAlt, onOpen, testID }: PhotoPreviewProps) {
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

/** The BuildSheet row of a mod (ModRow 2.0) with its catalogue, brand and "Eingebaut von" links, for Mods and Pläne. */
export function useModSheetRows(routeId: string, onOpenMod: (mod: PublicModRow) => void) {
  const { t } = useTranslation('vehicle');
  const legalPill = useLegalPill();
  const router = useRouter();
  const partsOn = usePartsOn();
  const businessesOn = useBusinessesOn();
  // M4.14: the catalogue product (BRD-02), its brand (BRD-01) and "Eingebaut von" (BIZ-01) under the row, while their flags are on.
  const modLinks = (mod: PublicModRow): BuildSheetLink[] => {
    const links: BuildSheetLink[] = [];
    const product = partsOn ? mod.product : null;
    if (product) {
      links.push({
        key: 'product',
        label: product.full_name,
        icon: 'part-box',
        accessibilityLabel: t('mods.links.productLabel', { product: product.full_name }),
        onPress: () => router.push({ pathname: '/products/[id]', params: { id: product.id } }),
        testID: `${routeId}.mod.${mod.id}.product`,
      });
      links.push({
        key: 'brand',
        label: t('mods.links.brand', { brand: product.brand.name }),
        accessibilityLabel: t('mods.links.brandLabel', { brand: product.brand.name }),
        onPress: () => router.push({ pathname: '/brands/[slug]', params: { slug: product.brand.slug || product.brand_slug } }),
        testID: `${routeId}.mod.${mod.id}.brand`,
      });
    }
    const installed = businessesOn ? mod.installed_by : null;
    if (installed) {
      links.push({
        key: 'installedBy',
        label: t('mods.links.installedBy', { business: installed.name }),
        icon: 'workshop',
        accessibilityLabel: t('mods.links.installedByLabel', { business: installed.name, city: installed.city }),
        onPress: () => router.push({ pathname: '/b/[slug]', params: { slug: installed.slug } }),
        testID: `${routeId}.mod.${mod.id}.installedBy`,
      });
    }
    return links;
  };
  const row = (mod: PublicModRow): BuildSheetMod => ({
    key: mod.id,
    icon: categoryIcon(mod.category.icon),
    name: mod.title,
    // DQ-952: the brand caption on every row that has a brand, as the DEV-01 anatomy ("BBS LM" by BBS).
    brand: mod.brand ?? null,
    ...(modValues(mod) ? { values: modValues(mod) } : {}),
    status: mod.status_label,
    ...legalPill(mod),
    links: modLinks(mod),
    // A row opens VEH-02 (with the chevron); costs stay private (09 §7.6 GAR-10).
    onPress: () => onOpenMod(mod),
    testID: `${routeId}.mod.${mod.id}`,
  });
  return { row, icon: categoryIcon };
}

/** Verlauf shows up to three photos per entry (Timeline's 3-up grid); a third of the column, a pair the whole column. */
const HISTORY_PHOTOS_SHOWN = 3;
const HISTORY_PHOTO_WIDTH = size.railCard;
const HISTORY_PAIR_WIDTH = layoutTokens.feedColumn;

/** One entry of Verlauf as the Timeline shows it (09 §5): the type as title, its first changes, the note, the rest as a count. */
export function historyEntry(
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
          // M5.9c Build Journey (contract §2): Verlauf sets a pair side by side; VEH-05 keeps the slider for the close look.
          beforeAfter: journeyPair(update, pair, t, HISTORY_PAIR_WIDTH / 2),
        }
      : photos.length > 0
        ? { photos }
        : {}),
    ...(update.mileage_km !== null ? { mileage: t('update.mileage', { value: number(update.mileage_km) }) } : {}),
    onPress,
    testID,
  };
}
