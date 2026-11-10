import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { vehicleCardProps } from '@/features/profile/media';
import { keepFiguresTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, useTheme } from '@/theme';
import { estimateLines, PressableScale, SkeletonText, Text, VehicleCard, VehicleCardSkeleton } from '@/ui';
import { joinLabel, LARGE_FONT_SCALE, useStacksAtFontScale } from '@/ui/rowParts';
import { ValueText } from '@/ui/ValueText';

import { feedOwner, latestChangeMeta } from '../model';
import { OwnerLink, OwnerLinkSkeleton } from './OwnerLink';

const useStyles = createStyles((t) => ({
  change: { marginTop: t.space[8] },
  changeBody: {
    borderRadius: t.radius.sm,
    gap: t.space[2],
    justifyContent: 'center',
    minHeight: t.size.touchMin,
    paddingVertical: t.space[4],
  },
}));

/** Typical length of a latest change ("Fahrwerk: Serie → Tein Mono Sport · −35 mm"). */
const TYPICAL_SUMMARY_CHARS = 42;
/** The summary is a teaser for its entry, so it is clamped: two lines, and from an enlarged font three, or the clamp hides the new value (DQ-200). */
const SUMMARY_MAX_LINES = 2;
const SUMMARY_MAX_LINES_LARGE = 3;

export type FeedVehicleCardSkeletonProps = {
  width: number;
  /** The owner row as its own link (Home), or inside the card (DISC-02). */
  ownerLink?: boolean;
  /**
   * DQ-205: draw the latest change. Most cards of a feed have none, and a skeleton is never longer than its content (§8), so a screen
   * asks for it only where the card usually has one.
   */
  latest?: boolean;
  testID?: string;
};

/**
 * DQ-191: the loading card in the loaded card's geometry: photo, title, sub-line, chips, the owner row and, with `latest`, the
 * latest change with its kind and summary, from the same styles. Put it inside a `Skeleton`.
 */
export function FeedVehicleCardSkeleton({ width, ownerLink = false, latest = true, testID }: FeedVehicleCardSkeletonProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const maxLines = useStacksAtFontScale() ? SUMMARY_MAX_LINES_LARGE : SUMMARY_MAX_LINES;
  const summaryLines = Math.min(maxLines, estimateLines(TYPICAL_SUMMARY_CHARS, 'supporting', fontScale, width));
  return (
    <View testID={testID}>
      <VehicleCardSkeleton owner={!ownerLink} testID={testID ? `${testID}.card` : undefined} />
      {ownerLink ? <OwnerLinkSkeleton /> : null}
      {latest ? (
        <View style={[styles.change, styles.changeBody]} testID={testID ? `${testID}.latest` : undefined}>
          <SkeletonText variant="caption" width="40%" />
          <SkeletonText variant="supporting" width="85%" lastLineWidth="50%" lines={summaryLines} />
        </View>
      ) : null}
    </View>
  );
}

export type FeedVehicleCardProps = {
  vehicle: FeedVehicle;
  /** The column width, for the photo variant. */
  width: number;
  onOpen: (vehicle: FeedVehicle) => void;
  /** VEH-05 of the latest change. */
  onOpenUpdate: (vehicle: FeedVehicle) => void;
  /** DQ-289: off when the same change is the update row right above, so the page never says it twice. */
  showLatest?: boolean;
  /** PROF-02 of the owner (M2.2: owner rows open the profile). Without it the owner row stays a part of the card. */
  onOpenOwner?: (username: string) => void;
  testID: string;
};

/**
 * §1.2 build card: 4:3 photo, make and model, the spec chips, the owner row and the latest change. No like, view, save or
 * comment count exists, and none is drawn. The owner row (PROF-02) and the latest change (its Verlauf entry) are links of their own
 * below the card body, because controls must not nest.
 */
export const FeedVehicleCard = memo(function FeedVehicleCard({ vehicle, width, onOpen, onOpenUpdate, onOpenOwner, showLatest = true, testID }: FeedVehicleCardProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const format = useFormat();
  const card = vehicleCardProps(vehicle, width);
  const owner = feedOwner(vehicle, format.relative);
  const update = vehicle.latest_update;
  const meta = latestChangeMeta(vehicle, format.relative);
  const summary = update?.summary.trim() ?? '';
  const { fontScale } = useTheme();
  const largeFont = useStacksAtFontScale();

  return (
    <View>
      <VehicleCard {...card} isMain={false} owner={onOpenOwner ? undefined : owner} onPress={() => onOpen(vehicle)} testID={testID} />
      {owner && vehicle.owner && onOpenOwner ? (
        <OwnerLink
          owner={owner}
          label={t('card.ownerProfile', { name: owner.username })}
          onPress={() => onOpenOwner(vehicle.owner?.username ?? '')}
          testID={`${testID}.owner`}
        />
      ) : null}
      {showLatest && update && (summary || meta) ? (
        <PressableScale
          role="link"
          aria-label={isWeb ? undefined : joinLabel([t('card.latestChange'), meta, summary])}
          onPress={() => onOpenUpdate(vehicle)}
          style={styles.change}
          contentStyle={styles.changeBody}
          testID={`${testID}.latest`}
        >
          {meta ? (
            <Text variant="caption" color="text.tertiary">
              {meta}
            </Text>
          ) : null}
          {summary ? (
            // DQ-216: a figure keeps its unit and tnum stays on the numeric segments. A summary can be wider than the card,
            // so its words wrap at their spaces (keepFiguresTogether).
            <ValueText
              variant="supporting"
              color="text.secondary"
              numberOfLines={largeFont ? SUMMARY_MAX_LINES_LARGE : SUMMARY_MAX_LINES}
              // DQ-230: below this scale the summary wraps at its spaces. At 1.3 a hyphen would split a word that fits the next line whole.
              hyphenate={fontScale >= LARGE_FONT_SCALE}
              values={keepFiguresTogether(summary, !largeFont)}
              wholeValues={false}
            />
          ) : null}
        </PressableScale>
      ) : null}
    </View>
  );
});
