import { memo, useMemo } from 'react';

import type { FeedVehicle } from '@/api/queries/home';
import { changeCaption } from '@/features/home/components/HomeFeedCard';
import { parseDate } from '@/features/home/model';
import { photoFields, variantUrl } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { size } from '@/theme';
import { MediaCard, MediaCardSkeleton } from '@/ui';

export type ResultFeedCardProps = {
  vehicle: FeedVehicle;
  /** The card's width: the screen on a phone (edge to edge), the column wider. */
  width: number;
  onOpen: (vehicle: FeedVehicle) => void;
  /** PROF-02 of the owner. */
  onOpenOwner: (username: string) => void;
  /** `DISC-02.vehicle.<id>`: `.header`, `.open.0`, `.owner`, `.caption` (MediaCard `feed`). */
  testID: string;
};

/**
 * DQ-1037 (09 §5 MediaCard `feed`): a result in the list view as the feed draws a build: the car's name and the time in the header,
 * its cover edge to edge on a phone, the owner under the photo and the latest change as the caption. No counts of any kind.
 */
export const ResultFeedCard = memo(function ResultFeedCard({ vehicle, width, onOpen, onOpenOwner, testID }: ResultFeedCardProps) {
  const format = useFormat();
  const when = parseDate(vehicle.updated_at ?? vehicle.published_at);
  const photos = useMemo(() => [{ ...photoFields(vehicle.cover, width), alt: vehicle.full_title }], [vehicle.cover, vehicle.full_title, width]);
  const owner = vehicle.owner
    ? { username: vehicle.owner.username, avatarUri: variantUrl(vehicle.owner.avatar, size.avatar.sm), avatarBlurhash: vehicle.owner.avatar?.blurhash ?? null }
    : undefined;
  return (
    <MediaCard
      variant="feed"
      title={vehicle.full_title}
      photos={photos}
      vehicleAvatar={{ uri: variantUrl(vehicle.cover, size.avatar.sm), blurhash: vehicle.cover?.blurhash ?? null }}
      owner={owner}
      onOwnerPress={owner ? () => onOpenOwner(owner.username) : undefined}
      time={when ? format.relative(when) : ''}
      caption={changeCaption(vehicle.latest_update)}
      sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
      onPress={() => onOpen(vehicle)}
      testID={testID}
    />
  );
});

/** The card while the first answer loads: header, the 4:5 photo on the stage and two caption lines. */
export function ResultFeedCardSkeleton({ testID }: { testID?: string }) {
  return <MediaCardSkeleton variant="feed" lines={2} testID={testID} />;
}
