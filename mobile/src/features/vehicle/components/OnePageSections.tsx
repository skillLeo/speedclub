/**
 * VEH-01 one scroll (10 §5, ADR-505): the sections after Überblick — Daten, Mods, Verlauf, Galerie — the Build-Fortschritt card of
 * Überblick, the forum slot and the footer. Pläne lives in PlansSection. Each section brings its heading; the page sets the gaps.
 */
import { useRouter } from 'expo-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { builtGroupsOf, type BuildProgress } from '@/api/queries/plans';
import type { BuildUpdate, PublicModRow, PublicVehicle } from '@/api/queries/vehicles';
import { BuildDiscussions } from '@/features/forum/components/ForumModules';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space, useBreakpoint } from '@/theme';
import { BuildSheetRow } from '@/ui/BuildSheet';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Timeline } from '@/ui/Timeline';
import { joinLabel } from '@/ui/rowParts';

import { visiblePhotos } from '../media';
import { previewPhotos, provenanceOf, specGroupsOf } from '../model';
import { HISTORY_SHOWN, keySpecsOf, MODS_SHOWN_PER_GROUP, type ProfileSection } from '../sections';
import { useHeadingRef } from './sectionFocus';
import { InlineReveal } from './InlineReveal';
import { historyEntry, PhotoPreview, SpecsSection, useModSheetRows } from './ProfileSections';
import { GroupHeader, RowCard } from './RowCard';

const useStyles = createStyles((t) => ({
  title: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', marginBottom: t.space[16] },
  titleText: { flexShrink: 1 },
  titleAction: { marginLeft: 'auto', marginRight: -t.size.buttonPaddingX.s },
  empty: { alignItems: 'flex-start', gap: t.space[8] },
  emptyAction: { marginLeft: -t.size.buttonPaddingX.s },
  // Daten: the key specs as an editorial grid on the canvas, label over value, hairline between rows; no box.
  grid: { columnGap: t.space[16], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[16] },
  cell: { gap: t.space[4], minWidth: 0 },
  expandRow: { alignItems: 'flex-start', marginTop: t.space[16] },
  expandButton: { marginLeft: -t.size.buttonPaddingX.s },
  expanded: { marginTop: t.space[24] },
  group: { marginTop: t.space[32] },
  groupFirst: { marginTop: 0 },
  groupHeader: { marginBottom: t.space[12] },
  groupMore: { alignItems: 'flex-start', marginTop: t.space[8] },
  disclaimer: { marginTop: t.space[16] },
  // Build-Fortschritt: one card on surface (radius 12), the percent as the numeral, a 4 line as the bar; never a second gauge.
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  cardHead: { alignItems: 'baseline', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: t.space[4] },
  numeral: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[4] },
  track: { backgroundColor: t.color.border.subtle, borderRadius: t.radius.full, height: t.space[4], overflow: 'hidden' },
  fill: { backgroundColor: t.color.text.primary, borderRadius: t.radius.full, height: t.space[4] },
  cardFoot: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardLink: { marginRight: -t.size.buttonPaddingX.s },
  footer: { alignItems: 'flex-start', gap: t.space[4] },
  footerAction: { marginLeft: -t.size.buttonPaddingX.s },
}));

export type SectionTitleProps = {
  title: string;
  /** Tabular, tertiary, after the title: "Mods 14". */
  count?: number;
  countLabel?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string; locked?: string | null; testID: string };
  /** The section this heading opens: the index moves keyboard and screen-reader focus here after a jump (review SF-4). */
  section?: ProfileSection;
  testID: string;
};

/** A section's heading: `title.2` (09 §4.2 section heroes), level 2, with its count in tabular figures and one text action. */
export function SectionTitle({ title, count, countLabel, action, section, testID }: SectionTitleProps) {
  const styles = useStyles();
  const headingRef = useHeadingRef(section);
  return (
    <View style={styles.title} testID={testID}>
      <Text
        ref={headingRef}
        variant="title2"
        role="heading"
        {...({ 'aria-level': 2 } as object)}
        aria-label={count === undefined || !countLabel ? undefined : joinLabel([title, countLabel])}
        style={styles.titleText}
        testID={`${testID}.text`}
      >
        {title}
        {count === undefined ? null : (
          <>
            {' '}
            <Text variant="title2" color="text.tertiary" numeric testID={`${testID}.count`}>
              {String(count)}
            </Text>
          </>
        )}
      </Text>
      {action ? (
        <Button
          label={action.label}
          variant="tertiary"
          size="s"
          accessibilityLabel={action.accessibilityLabel}
          onPress={action.onPress}
          locked={action.locked}
          style={styles.titleAction}
          testID={action.testID}
        />
      ) : null}
    </View>
  );
}

/** A section that has nothing yet: one line, and for the owner the one action that fills it. */
export function SectionEmpty({ text, action, testID }: { text: string; action?: { label: string; onPress: () => void; testID: string } | null; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text variant="body" color="text.secondary" testID={testID}>
        {text}
      </Text>
      {action ? <Button label={action.label} variant="tertiary" size="s" onPress={action.onPress} style={styles.emptyAction} testID={action.testID} /> : null}
    </View>
  );
}

type SectionProps = { vehicle: PublicVehicle; routeId: string; owner: boolean };

/** Columns of Daten's key-spec grid: two on a phone, three from 768. */
function gridColumns(kind: 'phone' | 'tablet' | 'desktop'): number {
  return kind === 'phone' ? 2 : 3;
}

/**
 * 10 §5.7 Daten: the six key specs as a grid (label in `label.caps`, value in `body.strong`, tabular, provenance under a measured
 * value), and "Alle Daten anzeigen", which opens every spec table in place (spring.default).
 */
export function DataSection({ vehicle, routeId, owner, width }: SectionProps & { width: number }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const { kind } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const keySpecs = keySpecsOf(vehicle);
  const groups = specGroupsOf(vehicle);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const columns = gridColumns(kind);
  const cellWidth = Math.max(0, (width - (columns - 1) * space[16]) / columns);

  return (
    <View>
      <SectionTitle title={t('sections.specs')} section="specs" testID={`${routeId}.section.specs.title`} />
      {keySpecs.length === 0 ? (
        <SectionEmpty
          text={t('specs.empty')}
          action={owner ? { label: t('specs.add'), onPress: () => router.push(`/garage/${vehicle.id}/specs`), testID: `${routeId}.specs.add` } : null}
          testID={`${routeId}.specsEmpty`}
        />
      ) : (
        <>
          <View role="list" aria-label={t('specs.keyLabel')} style={styles.grid} testID={`${routeId}.keySpecs`}>
            {keySpecs.map((row) => {
              const provenance = provenanceOf(row);
              return (
                <View key={row.key} role="listitem" accessible aria-label={joinLabel([row.label, row.value, provenance])} style={[styles.cell, { width: cellWidth }]} testID={`${routeId}.keySpec.${row.key}`}>
                  <Text variant="labelCaps" color="text.secondary" hyphenate={false}>
                    {row.label}
                  </Text>
                  <Text variant="bodyStrong" numeric testID={`${routeId}.keySpec.${row.key}.value`}>
                    {row.value}
                  </Text>
                  {provenance ? (
                    <Text variant="caption" color="text.tertiary">
                      {provenance}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
          {total > keySpecs.length ? (
            <View style={styles.expandRow}>
              <Button
                label={open ? t('specs.showLess') : t('specs.showAll')}
                variant="tertiary"
                size="s"
                expanded={open}
                controls={panelId}
                onPress={() => setOpen((value) => !value)}
                style={styles.expandButton}
                testID={`${routeId}.specs.toggle`}
              />
            </View>
          ) : null}
          {open ? (
            <InlineReveal nativeID={panelId} style={styles.expanded} testID={`${routeId}.specs.all`}>
              <SpecsSection vehicle={vehicle} routeId={routeId} />
            </InlineReveal>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * 10 §5.8 Mods: the built part of the build by system (BuildSheet), each system its first three and "+ 5 weitere", which opens the
 * rest of that system in place. Plans are in Pläne. Counts in tabular figures; the disclaimer of 08_LEGAL §7 closes the list.
 */
export function ModsSection({ vehicle, routeId, owner, onOpenMod }: SectionProps & { onOpenMod: (mod: PublicModRow) => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  // Review N6: ids unique per screen (two VEH-01 stacked on web), for each group's aria-controls.
  const restBase = useId();
  const rows = useModSheetRows(routeId, onOpenMod);
  const groups = builtGroupsOf(vehicle);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  const toggle = (key: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <View>
      <SectionTitle title={t('sections.mods')} section="mods" count={total > 0 ? total : undefined} countLabel={t('mods.count', { count: total })} testID={`${routeId}.section.mods.title`} />
      {groups.length === 0 ? (
        <SectionEmpty
          text={t('mods.empty')}
          action={owner ? { label: t('mods.add'), onPress: () => router.push(`/garage/${vehicle.id}/mods`), testID: `${routeId}.mods.add` } : null}
          testID={`${routeId}.modsEmpty`}
        />
      ) : (
        <View testID={`${routeId}.buildSheet`}>
          {groups.map((group, index) => {
            const key = group.category.key;
            const open = openGroups.has(key);
            const shown = group.items.slice(0, MODS_SHOWN_PER_GROUP);
            const rest = group.items.slice(MODS_SHOWN_PER_GROUP);
            const restId = `${restBase}-${key}`;
            return (
              <View key={key} style={index === 0 ? styles.groupFirst : styles.group} testID={`${routeId}.mods.${key}`}>
                {/* 09 §5 BuildSheet: the system's glyph, its name and the count in tabular figures over one grouped card. */}
                <GroupHeader
                  title={group.category.name}
                  icon={rows.icon(group.category.icon)}
                  count={group.items.length}
                  countLabel={t('mods.count', { count: group.items.length })}
                  style={styles.groupHeader}
                  testID={`${routeId}.mods.${key}.header`}
                />
                <RowCard>
                  {shown.map((mod, rowIndex) => (
                    <BuildSheetRow key={mod.id} mod={rows.row(mod)} divider={rowIndex < shown.length - 1 || (open && rest.length > 0)} />
                  ))}
                  {open && rest.length > 0 ? (
                    <InlineReveal nativeID={restId} testID={`${routeId}.mods.${key}.rest`}>
                      {rest.map((mod, rowIndex) => (
                        <BuildSheetRow key={mod.id} mod={rows.row(mod)} divider={rowIndex < rest.length - 1} />
                      ))}
                    </InlineReveal>
                  ) : null}
                </RowCard>
                {rest.length > 0 ? (
                  <View style={styles.groupMore}>
                    <Button
                      label={open ? t('mods.less') : t('mods.more', { count: rest.length })}
                      accessibilityLabel={open ? t('mods.lessLabel', { group: group.category.name }) : t('mods.moreLabel', { count: rest.length, group: group.category.name })}
                      variant="tertiary"
                      size="s"
                      expanded={open}
                      controls={restId}
                      onPress={() => toggle(key)}
                      style={styles.expandButton}
                      testID={`${routeId}.mods.${key}.toggle`}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
          <Text variant="caption" color="text.tertiary" style={styles.disclaimer} testID={`${routeId}.legalDisclaimer`}>
            {t('mods.disclaimer')}
          </Text>
        </View>
      )}
    </View>
  );
}

/** 10 §5.10 Verlauf: the latest three entries on the Timeline, then "Ganzen Verlauf anzeigen (12)" to VEH-08. */
export function HistoryPreview({
  vehicle,
  routeId,
  onOpenUpdate,
  onShowAll,
}: Omit<SectionProps, 'owner'> & { onOpenUpdate: (update: BuildUpdate) => void; onShowAll: () => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const latest = vehicle.updates.slice(0, HISTORY_SHOWN);
  const total = Math.max(vehicle.updates_count, vehicle.updates.length);
  return (
    <View>
      <SectionTitle title={t('sections.history')} section="history" count={total > 0 ? total : undefined} countLabel={t('history.count', { count: total })} testID={`${routeId}.section.history.title`} />
      {latest.length === 0 ? (
        <SectionEmpty text={t('history.empty')} testID={`${routeId}.historyEmpty`} />
      ) : (
        <>
          <Timeline
            entries={latest.map((update) => historyEntry(update, t, () => onOpenUpdate(update), `${routeId}.update.${update.id}`, (value) => format.number(value)))}
            groupTestID={(index) => `${routeId}.month.${index}`}
            testID={`${routeId}.timeline`}
          />
          {total > latest.length ? (
            <View style={styles.expandRow}>
              <Button
                label={t('history.showAll', { count: total })}
                variant="secondary"
                size="m"
                role="link"
                onPress={onShowAll}
                testID={`${routeId}.history.showAll`}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** 10 §5.11 Galerie: the 3-column wall (1:1, 2 apart) and "Alle Fotos (12)" to VEH-03. Only for a build with photos. */
export function GallerySection({
  vehicle,
  routeId,
  onOpenGallery,
  onOpenPhoto,
}: Omit<SectionProps, 'owner'> & { onOpenGallery: () => void; onOpenPhoto: (index: number) => void }) {
  const { t } = useTranslation('vehicle');
  const preview = previewPhotos(vehicle);
  return (
    <View testID={`${routeId}.photoPreview`}>
      <SectionTitle
        title={t('sections.gallery')}
        section="gallery"
        count={vehicle.photo_count > 0 ? vehicle.photo_count : undefined}
        countLabel={t('gallery.count', { count: vehicle.photo_count })}
        action={{ label: t('gallery.showAll'), accessibilityLabel: t('overview.allPhotos', { count: vehicle.photo_count }), onPress: onOpenGallery, testID: `${routeId}.photoPreview.header.action` }}
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
    </View>
  );
}

export type BuildProgressCardProps = {
  progress: BuildProgress | null;
  routeId: string;
  owner: boolean;
  onShowPlans: () => void;
  onPlan: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * 10 §6.2 Build-Fortschritt in Überblick: "57 %", a line for built ÷ (built + planned), "4 von 7 Mods verbaut · 3 geplant" and the
 * way to Pläne. 10 §16.3: the Build Score gauge replaces the ring, so this is a line, never a second gauge. A visitor sees it only
 * with a plan; the owner always, without a plan as the invitation to the first one.
 */
export function BuildProgressCard({ progress, routeId, owner, onShowPlans, onPlan, style }: BuildProgressCardProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const planned = progress?.planned ?? 0;
  if (!owner && planned < 1) return null;
  if (!progress || planned < 1) {
    return (
      <View style={[styles.card, style]} testID={`${routeId}.progress`}>
        <Text variant="headline" role="heading" {...({ 'aria-level': 3 } as object)}>
          {t('progress.title')}
        </Text>
        <Text variant="body" color="text.secondary" testID={`${routeId}.progress.empty`}>
          {t('progress.empty')}
        </Text>
        <View style={styles.cardFoot}>
          <Button label={t('plans.add')} variant="secondary" size="s" onPress={onPlan} testID={`${routeId}.progress.plan`} />
        </View>
      </View>
    );
  }
  const percent = Math.max(0, Math.min(100, progress.percent));
  return (
    <View style={[styles.card, style]} testID={`${routeId}.progress`}>
      <View style={styles.cardHead}>
        <Text variant="headline" role="heading" {...({ 'aria-level': 3 } as object)}>
          {t('progress.title')}
        </Text>
        <View style={styles.numeral} accessible aria-label={t('progress.percentLabel', { percent })}>
          <Text variant="heroNumeralS" numeric testID={`${routeId}.progress.percent`}>
            {format.number(percent)}
          </Text>
          <Text variant="labelUnit" color="text.secondary">
            %
          </Text>
        </View>
      </View>
      <View style={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('progress.title')} testID={`${routeId}.progress.bar`}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <View style={styles.cardFoot}>
        <Text variant="callout" color="text.secondary" testID={`${routeId}.progress.line`}>
          {t('progress.line', { built: format.number(progress.built), total: format.number(progress.total), planned: format.number(progress.planned) })}
        </Text>
        <Button label={t('progress.showPlans')} variant="tertiary" size="s" flush="start" onPress={onShowPlans} testID={`${routeId}.progress.showPlans`} />
      </View>
    </View>
  );
}

/**
 * 10 §5.12 "Diskussionen zu diesem Build": the Forum's threads about this car (M5.8, features/forum BuildDiscussions). The slot is in
 * the page's order and draws nothing while the `forum` flag is off; with it on, a visitor sees it only when threads exist.
 */
export function BuildDiscussionsSlot({
  vehicle,
  routeId,
  style,
}: {
  vehicle: PublicVehicle;
  routeId: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const forum = useFlag('forum');
  if (!forum) return null;
  return <BuildDiscussions vehicle={vehicle} routeId={routeId} style={style} />;
}

/** Whether the page lists the discussions row at all: only while the forum flag is on (the slot then decides what it draws). */
export function useDiscussionsSlot(): boolean {
  return useFlag('forum');
}

/** The page's footer (09 §7.6 (6)): a guest's line to sign in and write the owner, and "Melden" for someone else's build. */
export function ProfileFooter({
  routeId,
  guestLine,
  report,
}: {
  routeId: string;
  guestLine: { text: string; label: string; onPress: () => void } | null;
  report: { label: string; onPress: () => void } | null;
}) {
  const styles = useStyles();
  if (!guestLine && !report) return null;
  return (
    <View style={styles.footer} testID={`${routeId}.footer`}>
      {guestLine ? (
        <View style={styles.footer} testID={`${routeId}.closingOwner`}>
          <Text variant="callout" color="text.secondary">
            {guestLine.text}
          </Text>
          <Button label={guestLine.label} variant="tertiary" size="s" onPress={guestLine.onPress} style={styles.footerAction} testID={`${routeId}.closingMessage`} />
        </View>
      ) : null}
      {report ? <Button label={report.label} variant="tertiary" size="s" icon="flag" onPress={report.onPress} style={styles.footerAction} testID={`${routeId}.footer.report`} /> : null}
    </View>
  );
}
