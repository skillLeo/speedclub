import '@/features/events/i18n';

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { LIMIT_REACHED, type EventDetail } from '@/api/queries/events';
import {
  canAddPhotos,
  flattenPhotos,
  GALLERY_CLOSED,
  GALLERY_NOT_ATTENDEE,
  GALLERY_PICK_MAX,
  galleryOf,
  useDeleteEventPhoto,
  useEventGallery,
  useGalleryEnabled,
  useUploadEventPhoto,
  type EventPhoto,
} from '@/api/queries/eventGallery';
import { photoForm, pickPhotos, preparePhoto, releasePicked } from '@/features/garage/photos';
import { photoFields } from '@/features/profile/media';
import { appendPlateBlur } from '@/features/media/plateBlur/model';
import { usePlateBlurReview } from '@/features/media/plateBlur/PlateBlurReview';
import { useReport } from '@/features/safety/useReport';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, space } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { IconButton } from '@/ui/IconButton';
import { ImageViewer, type ViewerImage } from '@/ui/ImageViewer';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { dayText, parseInstant } from '../model';
import { EventSection } from './EventParts';

/** Three tiles a row, 2 apart (09 §5 result walls: 2 px gaps, square tiles, the group rounded once). */
const COLUMNS = 3;
const GAP = space[2];
/** The viewer's photos: the largest variant a phone needs. */
const VIEWER_WIDTH = 1600;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12] },
  grid: {
    borderRadius: t.radius.md,
    columnGap: GAP,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    rowGap: GAP,
  },
  actions: { alignItems: 'flex-start', gap: t.space[8] },
  viewerActions: { flexDirection: 'row' },
}));

/**
 * M5.6 EVT-02 "Fotos vom Treffen" (10 §4; m5.6-contract §4), behind `events.gallery`: the approved photos as a square wall (the first
 * six, "Alle Fotos" opens the rest in place), each opening the viewer with "Melden" and, for its uploader or the organiser,
 * "Löschen"; "Fotos hinzufügen" for the organiser and the attendees while the window is open, through the plate blur step. An
 * attendee's photo waits for the organiser, and the section says so. Nothing at all while the flag is off, the server sends no
 * gallery, or there is nothing to show and nothing to add.
 */
export function EventGallery({ event, routeId }: { event: EventDetail; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const enabled = useGalleryEnabled();
  const own = useSessionStore((state) => state.member?.username ?? null);
  const info = enabled ? galleryOf(event) : null;
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<EventPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const all = useEventGallery(event.slug, 'approved', expanded && info !== null);
  const upload = useUploadEventPhoto(event.slug);
  const remove = useDeleteEventPhoto(event.slug);
  const plateBlur = usePlateBlurReview(`${routeId}.gallery`);
  const report = useReport(null, { routeId: `${routeId}.gallery` });
  const keys = useRef<string[]>([]);

  const photos = useMemo(
    () => (expanded && all.data ? flattenPhotos(all.data.pages) : (info?.preview ?? [])),
    [all.data, expanded, info?.preview],
  );
  const images = useMemo<ViewerImage[]>(
    () =>
      photos.map((photo) => ({
        uri: String(photoFields(photo.media, VIEWER_WIDTH).source ?? ''),
        blurhash: photo.media.blurhash ?? undefined,
        aspectRatio: photo.media.width && photo.media.height ? photo.media.width / photo.media.height : undefined,
        alt: t('gallery.photoLabel', { username: photo.uploader.username }),
      })),
    [photos, t],
  );

  if (!info) return null;
  const mayAdd = canAddPhotos(event);
  const organiser = own !== null && own.toLowerCase() === event.organiser.username.toLowerCase();
  const pendingMine = info.mine_pending ?? 0;
  if (info.count === 0 && !mayAdd && pendingMine === 0) return null;

  const tile = width > 0 ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const closes = parseInstant(info.closes_at);
  const more = info.count > info.preview.length && !expanded;

  const add = async () => {
    const picked = await pickPhotos(GALLERY_PICK_MAX);
    if (!picked || picked.length === 0) return;
    const reviewed = await plateBlur.review(picked);
    if (!reviewed) {
      for (const photo of picked) releasePicked(photo);
      return;
    }
    setUploading(true);
    keys.current = reviewed.map((_, index) => keys.current[index] ?? newIdempotencyKey());
    let failed = 0;
    let refusal: string | null = null;
    for (const [index, photo] of reviewed.entries()) {
      try {
        const prepared = await preparePhoto(photo);
        await upload.mutateAsync({
          form: appendPlateBlur(await photoForm(prepared), photo.plateBlur),
          idempotencyKey: keys.current[index] ?? newIdempotencyKey(),
        });
      } catch (error) {
        failed += 1;
        if (error instanceof ApiError && error.code) refusal = error.code;
      } finally {
        releasePicked(photo);
      }
    }
    keys.current = [];
    setUploading(false);
    const done = reviewed.length - failed;
    if (failed === 0) {
      haptics.success();
      toast(t(organiser ? 'gallery.published' : 'gallery.uploaded', { count: done, value: format.number(done) }), {
        testID: `${routeId}.gallery.toast`,
      });
      return;
    }
    haptics.error();
    const message =
      refusal === GALLERY_CLOSED
        ? t('gallery.closed')
        : refusal === GALLERY_NOT_ATTENDEE
          ? t('gallery.notAttendee')
          : refusal === LIMIT_REACHED
            ? t('gallery.limit')
            : done > 0
              ? t('gallery.partlyFailed', { failed, total: reviewed.length })
              : t('gallery.uploadFailed');
    toast(message, { haptic: 'warning', testID: `${routeId}.gallery.toast` });
  };

  const confirmDelete = () => {
    const photo = deleting;
    if (!photo) return;
    remove.mutate(photo.id, {
      onSuccess: () => {
        setDeleting(null);
        setViewer(null);
        toast(t('gallery.deleted'), { testID: `${routeId}.gallery.toast` });
      },
      onError: () => {
        setDeleting(null);
        toast(t('gallery.deleteFailed'), { haptic: 'warning', testID: `${routeId}.gallery.toast` });
      },
    });
  };

  const onLayout = (layout: LayoutChangeEvent) => setWidth(Math.round(layout.nativeEvent.layout.width));
  const loadingAll = expanded && !all.data && all.isPending;

  return (
    <EventSection
      title={t('gallery.title')}
      trailing={
        more ? (
          <Button
            label={t('gallery.all')}
            variant="tertiary"
            size="s"
            flush="end"
            accessibilityLabel={t('gallery.allLabel', { value: format.number(info.count) })}
            onPress={() => setExpanded(true)}
            testID={`${routeId}.gallery.all`}
          />
        ) : undefined
      }
      testID={`${routeId}.gallery`}
    >
      <View style={styles.body} onLayout={onLayout}>
        {photos.length > 0 && tile > 0 ? (
          <View style={styles.grid} role="list" testID={`${routeId}.gallery.grid`}>
            {photos.map((photo, index) => (
              <PressableScale
                key={photo.id}
                role="button"
                aria-label={t('gallery.open', { username: photo.uploader.username })}
                onPress={() => setViewer(index)}
                style={{ width: tile }}
                testID={`${routeId}.gallery.photo.${photo.id}`}
              >
                <Photo {...photoFields(photo.media, tile)} aspect="1:1" corner="none" style={{ width: tile }} />
              </PressableScale>
            ))}
          </View>
        ) : null}
        {loadingAll ? (
          <Skeleton testID={`${routeId}.gallery.skeleton`}>
            <View style={styles.grid}>
              {Array.from({ length: COLUMNS }, (_, index) => (
                <SkeletonBlock key={index} width={tile} aspectRatio={1} corner="none" />
              ))}
            </View>
          </Skeleton>
        ) : null}
        {expanded && all.isError ? (
          <Button
            label={t('gallery.loadError')}
            icon="arrow-clockwise"
            variant="tertiary"
            size="s"
            flush="start"
            onPress={() => void all.refetch()}
            testID={`${routeId}.gallery.retry`}
          />
        ) : null}
        {expanded && all.hasNextPage ? (
          <Button
            label={t('gallery.more')}
            variant="tertiary"
            size="s"
            flush="start"
            loading={all.isFetchingNextPage}
            onPress={() => void all.fetchNextPage()}
            testID={`${routeId}.gallery.more`}
          />
        ) : null}
        {info.count > 0 ? (
          <Text variant="caption" color="text.secondary" numeric testID={`${routeId}.gallery.count`}>
            {t('gallery.count', { count: info.count, value: format.number(info.count) })}
          </Text>
        ) : mayAdd ? (
          <Text variant="body" color="text.secondary" testID={`${routeId}.gallery.empty`}>
            {t('gallery.emptyOpen')}
          </Text>
        ) : null}
        {pendingMine > 0 ? (
          <Text variant="callout" color="text.secondary" numeric testID={`${routeId}.gallery.minePending`}>
            {t('gallery.minePending', { count: pendingMine, value: format.number(pendingMine) })}
          </Text>
        ) : null}
        {mayAdd ? (
          <View style={styles.actions}>
            <Button
              label={uploading ? t('gallery.uploading') : t('gallery.add')}
              icon="image"
              variant="secondary"
              size="m"
              loading={uploading}
              disabled={!online}
              onPress={() => void add()}
              testID={`${routeId}.gallery.add`}
            />
            <Text variant="caption" color="text.secondary" testID={`${routeId}.gallery.hint`}>
              {organiser ? t('gallery.addHintOrganiser') : t('gallery.addHint')}
            </Text>
            {closes ? (
              <Text variant="caption" color="text.tertiary" numeric testID={`${routeId}.gallery.closes`}>
                {t('gallery.closesOn', { date: dayText(closes, format.locale, now()) })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <ImageViewer
        visible={viewer !== null}
        images={images}
        initialIndex={viewer ?? 0}
        onClose={() => setViewer(null)}
        actions={(index) => {
          const photo = photos[index];
          if (!photo) return null;
          return (
            <View style={styles.viewerActions}>
              {photo.can.report && report.available && !photo.is_sample ? (
                <IconButton
                  icon="flag"
                  label={t('gallery.report')}
                  variant="onPhoto"
                  onPress={() =>
                    report.openFor({
                      type: 'photo',
                      id: photo.media.id,
                      label: t('gallery.photoLabel', { username: photo.uploader.username }),
                      owner: photo.uploader.username,
                    })
                  }
                  testID={`${routeId}.gallery.report`}
                />
              ) : null}
              {photo.can.delete ? (
                <IconButton
                  icon="trash"
                  label={t('gallery.delete')}
                  variant="onPhoto"
                  onPress={() => setDeleting(photo)}
                  testID={`${routeId}.gallery.delete`}
                />
              ) : null}
            </View>
          );
        }}
        testID={`${routeId}.gallery.viewer`}
      />
      <Dialog
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('gallery.delete')}
        actions={[
          { label: t('editor.close'), variant: 'secondary', onPress: () => setDeleting(null), testID: `${routeId}.gallery.deleteDialog.back` },
          {
            label: t('gallery.delete'),
            destructive: true,
            loading: remove.isPending,
            onPress: confirmDelete,
            testID: `${routeId}.gallery.deleteDialog.confirm`,
          },
        ]}
        testID={`${routeId}.gallery.deleteDialog`}
      />
      {plateBlur.element}
      {report.element}
    </EventSection>
  );
}
