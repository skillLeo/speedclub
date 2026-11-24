import '@/features/events/i18n';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import type { EventDetail } from '@/api/queries/events';
import {
  canModeratePhotos,
  flattenPhotos,
  galleryOf,
  PHOTO_ALREADY_REVIEWED,
  useEventGallery,
  useGalleryEnabled,
  useReviewEventPhoto,
  type EventPhoto,
} from '@/api/queries/eventGallery';
import { photoFields } from '@/features/profile/media';
import { haptics } from '@/lib/haptics';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Photo } from '@/ui/Photo';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { EventSection } from './EventParts';

const THUMB = size.thumb.row;

const useStyles = createStyles((t) => ({
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], padding: t.space[12] },
  rowText: { flex: 1, gap: t.space[8], minWidth: 0 },
  buttons: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  thumb: { width: THUMB },
  skeleton: { gap: t.space[8] },
}));

/**
 * M5.6 EVT-06 "Fotos freigeben" (m5.6-contract §4.5), behind `events.gallery`: the attendees' photos waiting for the organiser, each
 * with its uploader and "Freigeben" / "Ablehnen". A decision takes the row out at once and puts it back when the call fails. Hidden
 * while the flag is off or the server sends no gallery for this event.
 */
export function GalleryReview({ event, routeId }: { event: EventDetail; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const enabled = useGalleryEnabled();
  const info = enabled ? galleryOf(event) : null;
  const shown = info !== null && canModeratePhotos(event);
  const query = useEventGallery(event.slug, 'pending', shown);
  const review = useReviewEventPhoto(event.slug);
  const photos = useMemo(() => flattenPhotos(query.data?.pages), [query.data?.pages]);

  if (!shown) return null;

  const decide = (photo: EventPhoto, decision: 'approve' | 'reject') => {
    haptics.selection();
    review.mutate(
      { id: photo.id, decision },
      {
        onSuccess: () => toast(t(decision === 'approve' ? 'gallery.review.approved' : 'gallery.review.rejected'), { testID: `${routeId}.galleryReview.toast` }),
        onError: (error) =>
          toast(error instanceof ApiError && error.code === PHOTO_ALREADY_REVIEWED ? t('gallery.review.alreadyReviewed') : t('gallery.review.failed'), {
            haptic: 'warning',
            testID: `${routeId}.galleryReview.toast`,
          }),
      },
    );
  };

  let body;
  if (!query.data && query.isPending && query.fetchStatus !== 'paused') {
    body = (
      <Skeleton testID={`${routeId}.galleryReview.skeleton`}>
        <View style={[styles.list, styles.row]}>
          <SkeletonBlock width={THUMB} aspectRatio={1} corner="sm" />
          <View style={[styles.rowText, styles.skeleton]}>
            <SkeletonText variant="callout" width="40%" />
            <SkeletonBlock width="60%" height={size.button.s} corner="sm" />
          </View>
        </View>
      </Skeleton>
    );
  } else if (!query.data) {
    body = (
      <ErrorState
        title={t('gallery.review.error')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${routeId}.galleryReview.error`}
      />
    );
  } else if (photos.length === 0) {
    body = (
      <Text variant="callout" color="text.secondary" testID={`${routeId}.galleryReview.empty`}>
        {t('gallery.review.empty')}
      </Text>
    );
  } else {
    body = (
      <View style={styles.list} role="list" testID={`${routeId}.galleryReview.list`}>
        {photos.map((photo, index) => (
          <View key={photo.id} role="listitem">
            {index > 0 ? <Hairline /> : null}
            <View style={styles.row} testID={`${routeId}.galleryReview.photo.${photo.id}`}>
              <Photo
                {...photoFields(photo.media, THUMB)}
                aspect="1:1"
                corner="sm"
                label={t('gallery.photoLabel', { username: photo.uploader.username })}
                style={styles.thumb}
              />
              <View style={styles.rowText}>
                <Text variant="callout" color="text.secondary" numberOfLines={2}>
                  {t('gallery.review.by', { username: photo.uploader.username })}
                </Text>
                <View style={styles.buttons}>
                  <Button
                    label={t('gallery.review.approve')}
                    variant="secondary"
                    size="s"
                    accessibilityLabel={t('gallery.review.approveLabel', { username: photo.uploader.username })}
                    disabled={!online}
                    onPress={() => decide(photo, 'approve')}
                    testID={`${routeId}.galleryReview.approve.${photo.id}`}
                  />
                  <Button
                    label={t('gallery.review.reject')}
                    variant="tertiary"
                    size="s"
                    accessibilityLabel={t('gallery.review.rejectLabel', { username: photo.uploader.username })}
                    disabled={!online}
                    onPress={() => decide(photo, 'reject')}
                    testID={`${routeId}.galleryReview.reject.${photo.id}`}
                  />
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }

  const waiting = info.pending ?? photos.length;
  return (
    <EventSection
      title={t('gallery.review.title')}
      trailing={
        waiting > 0 ? (
          <Text variant="caption" color="text.secondary" numeric testID={`${routeId}.galleryReview.waiting`}>
            {t('gallery.review.waiting', { count: waiting, value: format.number(waiting) })}
          </Text>
        ) : undefined
      }
      testID={`${routeId}.galleryReview`}
    >
      <Text variant="callout" color="text.secondary">
        {t('gallery.review.body')}
      </Text>
      {body}
      {query.hasNextPage ? (
        <Button
          label={t('gallery.more')}
          variant="tertiary"
          size="s"
          flush="start"
          loading={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
          testID={`${routeId}.galleryReview.more`}
        />
      ) : null}
    </EventSection>
  );
}
