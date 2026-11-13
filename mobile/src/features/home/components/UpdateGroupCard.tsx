import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { BuildUpdateRowData, FeedVehicle } from '@/api/queries/home';
import { photoFields } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, useTheme } from '@/theme';
import { IconButton, Photo, PressableScale, SampleBadges, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { ReactionPicker, SaveToggle } from '@/ui/motion/kit';
import { joinLabel } from '@/ui/rowParts';
import { metaLineText, vehicleNameText } from '@/ui/textBreaks';

import { useFeedCardActions } from '../feedActions';
import { parseDate } from '../model';
import { changeCaption } from './HomeFeedCard';

const CAPTION_LINES = 2;
/** A guest who acts on a card of Folge ich comes back to it after signing in. */
const FOLLOWING_PATH = '/?tab=following';

const useStyles = createStyles((t) => ({
  card: { gap: t.space[4] },
  body: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[8] },
  thumb: { flexShrink: 0, width: t.size.thumb.row },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  caption: { marginTop: t.space[2] },
  actions: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  // The skeleton's rows in the loaded card's geometry.
  skeletonBody: { flexDirection: 'row', gap: t.space[12], paddingVertical: t.space[8] },
  skeletonText: { flex: 1, gap: t.space[4] },
}));

export type UpdateGroupCardProps = {
  /** One or more consecutive updates of the same build, newest first. */
  updates: readonly [BuildUpdateRowData, ...BuildUpdateRowData[]];
  onOpen: (vehicle: FeedVehicle, updateId?: string) => void;
  testID: string;
};

/**
 * DQ-1027 (09 §7.3 Folge ich, §14.3 "no identical-card stack"): an update without media of its own is a compact card, not the build's
 * 4:5 cover again: the cover as a 56 thumb (radius 8), the car's name, the change, "@owner · vor 2 Std." and the action row.
 * Consecutive updates of one build are one card ("3 Updates", with the newest change). The full feed card stays for a first publish.
 * Lane B gap: `media[]` on updates; with it, an update with photos gets the full feed card.
 */
export const UpdateGroupCard = memo(function UpdateGroupCard({ updates, onOpen, testID }: UpdateGroupCardProps) {
  const { t } = useTranslation('home');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const format = useFormat();
  const { fontScale } = useTheme();
  const latest = updates[0];
  const vehicle = latest.vehicle;
  const actions = useFeedCardActions({ vehicle, updateId: latest.id, routeId: testID.split('.')[0] ?? 'HOME-01', returnTo: FOLLOWING_PATH });
  const when = parseDate(latest.created_at);
  const count = updates.length;
  const meta = [vehicle.owner ? `@${vehicle.owner.username}` : null, when ? format.relative(when) : null, count > 1 ? t('following.updates', { count }) : null]
    .filter(Boolean)
    .join(' · ');
  const caption = changeCaption(latest);
  const large = fontScale > 1;
  const { reaction, save, onShare, sheet } = actions;

  return (
    <View style={styles.card} testID={testID}>
      <PressableScale
        role="link"
        aria-label={isWeb ? undefined : joinLabel([vehicle.full_title, caption, meta])}
        onPress={() => onOpen(vehicle, latest.id)}
        contentStyle={styles.body}
        testID={`${testID}.open`}
      >
        <Photo {...photoFields(vehicle.cover, size.thumb.row)} aspect="1:1" corner="sm" style={styles.thumb} testID={`${testID}.thumb`} />
        <View style={styles.text}>
          <SampleBadges flags={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }} testID={`${testID}.sample`} />
          <Text variant="headline" hyphenate={false} numberOfLines={large ? undefined : 1} testID={`${testID}.title`}>
            {large ? vehicleNameText(vehicle.full_title) : vehicle.full_title}
          </Text>
          {caption ? (
            <Text variant="body" numberOfLines={large ? undefined : CAPTION_LINES} style={styles.caption} testID={`${testID}.caption`}>
              {caption}
            </Text>
          ) : null}
          <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={`${testID}.meta`}>
            {large ? metaLineText(meta) : meta}
          </Text>
        </View>
      </PressableScale>
      {reaction || save || onShare ? (
        <View style={styles.actions}>
          {reaction ? <ReactionPicker {...reaction} testID={`${testID}.reaction`} /> : null}
          {save ? <SaveToggle saved={save.saved} onToggle={save.onToggle} saveLabel={common('actions.save')} itemKey={latest.id} testID={`${testID}.save`} /> : null}
          {onShare ? <IconButton icon="share-network" label={common('actions.share')} onPress={onShare} testID={`${testID}.share`} /> : null}
        </View>
      ) : null}
      {sheet}
    </View>
  );
});

/** The compact card while it loads: the 56 thumb, name, two caption lines, the meta line and the action row (DQ-1083). */
export function UpdateGroupCardSkeleton({ testID }: { testID?: string }) {
  return (
    <Skeleton testID={testID}>
      <UpdateGroupCardSkeletonRows />
    </Skeleton>
  );
}

/** The same geometry without its own Skeleton, for a skeleton that holds several (HOME-01 Folge ich). */
export function UpdateGroupCardSkeletonRows() {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.skeletonBody}>
        <SkeletonBlock width={size.thumb.row} height={size.thumb.row} corner="sm" />
        <View style={styles.skeletonText}>
          <SkeletonText variant="headline" width="60%" />
          <SkeletonText variant="body" width="100%" lines={CAPTION_LINES} lastLineWidth="55%" />
          <SkeletonText variant="caption" width="40%" />
        </View>
      </View>
      <View style={styles.actions}>
        {ACTION_KEYS.map((key) => (
          <SkeletonBlock key={key} width={size.touchMin} height={size.touchMin} corner="full" />
        ))}
      </View>
    </View>
  );
}

/** Reaction, save and share: the loaded card's action row. */
const ACTION_KEYS = ['reaction', 'save', 'share'] as const;
