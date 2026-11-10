import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDeleteMedia, useUpdateVehicle, type GarageMedia, type GarageVehicle } from '@/api/queries/garage';
import type { UploadItem } from '@/state/uploads';
import { createStyles } from '@/theme';
import { Icon, Text, toast } from '@/ui';

import { isGone, saveErrorMessage } from '../errors';
import { VEHICLE_PHOTO_LIMIT } from '../photos';
import { usePhotoUploads } from '../uploads';
import { PhotoGrid } from './PhotoGrid';
import { DeletePhotoDialog, PhotoActionsSheet, UploadSheet } from './PhotoSheets';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  reminder: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  reminderText: { flex: 1 },
}));

export type VehiclePhotosProps = {
  vehicle: GarageVehicle;
  /** Offline: the grid takes no taps. */
  disabled?: boolean;
  /**
   * Restricted: no new photos, no cover and no edits (POST and PATCH media answer 403), but deleting stays, because a member
   * can always take their own content down (ADR-146 b).
   */
  locked?: boolean;
  /** GAR-07 opens GAR-08 from a photo's sheet; the wizard has no editor of its own. */
  onEditPhoto?: (photo: GarageMedia) => void;
  /**
   * GAR-07: uploads that failed on the server (BH-46). They are no photos of the vehicle: no order, count, cover or limit, and
   * the only thing to do with one is to delete it. media:prune removes them after 30 days.
   */
  failedPhotos?: readonly GarageMedia[];
  routeId: string;
};

/** The photos of one vehicle with the upload queue, the cover choice and deleting behind a dialog. */
export function VehiclePhotos({ vehicle, disabled = false, locked = false, onEditPhoto, failedPhotos = [], routeId }: VehiclePhotosProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [selected, setSelected] = useState<GarageMedia | null>(null);
  const [deleting, setDeleting] = useState<GarageMedia | null>(null);
  const [upload, setUpload] = useState<UploadItem | null>(null);
  const update = useUpdateVehicle(vehicle.id);
  const remove = useDeleteMedia(vehicle);
  const uploads = usePhotoUploads({ kind: 'vehicle', vehicleId: vehicle.id }, vehicle.photos, VEHICLE_PHOTO_LIMIT);
  const coverId = vehicle.cover_media_id ?? vehicle.cover?.id ?? null;
  const readyCount = vehicle.photos.filter((photo) => photo.status === 'ready').length;

  const makeCover = (photo: GarageMedia) => {
    update.mutate(
      { cover_media_id: photo.id },
      {
        onSuccess: () => toast(t('photos.coverSet'), { testID: `${routeId}.toast` }),
        onError: (error) => toast(saveErrorMessage(t, error), { testID: `${routeId}.toast` }),
      },
    );
  };
  const confirmDelete = (photo: GarageMedia) => {
    remove.mutate(photo.id, {
      onSuccess: () => {
        setDeleting(null);
        toast(t('photos.deleted'), { testID: `${routeId}.toast` });
      },
      onError: (error) => {
        setDeleting(null);
        // A failed upload can be gone by itself: what the member asked for has happened.
        const alreadyGone = photo.status === 'failed' && isGone(error);
        toast(alreadyGone ? t('photos.deleted') : saveErrorMessage(t, error), { testID: `${routeId}.toast` });
      },
    });
  };

  return (
    <View style={styles.root}>
      <PhotoGrid
        photos={vehicle.photos}
        uploads={uploads.uploads}
        coverId={coverId}
        canAdd={uploads.remaining > 0}
        adding={uploads.picking}
        onAdd={() => void uploads.add()}
        onPressPhoto={(photo) => setSelected(photo)}
        onPressUpload={setUpload}
        failed={failedPhotos}
        onPressFailed={setDeleting}
        disabled={disabled}
        addDisabled={locked}
        fallbackAlt={vehicle.full_title}
        testID={`${routeId}.photos`}
      />
      <Text variant="helper" color="text.secondary" testID={`${routeId}.photos.count`}>
        {t('photos.count', { count: vehicle.photos.length + uploads.uploads.length, max: VEHICLE_PHOTO_LIMIT })}
      </Text>
      <View style={styles.reminder} testID={`${routeId}.plateReminder`}>
        <Icon name="info" size={16} color="text.secondary" />
        <Text variant="helper" color="text.secondary" style={styles.reminderText}>
          {t('photos.plateReminder')}
        </Text>
      </View>
      <PhotoActionsSheet
        photo={selected}
        isCover={selected?.id === coverId}
        onClose={() => setSelected(null)}
        onMakeCover={locked ? undefined : makeCover}
        onEdit={locked ? undefined : onEditPhoto}
        onDelete={setDeleting}
        testID={`${routeId}.photoSheet`}
      />
      <DeletePhotoDialog
        photo={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        deleting={remove.isPending}
        lastOfPublished={vehicle.status === 'published' && readyCount <= 1 && deleting?.status === 'ready'}
        body={deleting?.status === 'failed' ? t('photos.failedBody') : undefined}
        testID={`${routeId}.deletePhoto`}
      />
      <UploadSheet item={upload} onClose={() => setUpload(null)} onRetry={uploads.retry} onCancel={uploads.cancel} testID={`${routeId}.uploadSheet`} />
    </View>
  );
}

/** For the review step: photos the vehicle has, and ones still on their way. */
export function usePhotoCounts(vehicle: GarageVehicle) {
  const uploads = usePhotoUploads({ kind: 'vehicle', vehicleId: vehicle.id }, vehicle.photos, VEHICLE_PHOTO_LIMIT);
  return { ready: vehicle.photos.filter((photo) => photo.status === 'ready').length, pending: uploads.busy };
}
