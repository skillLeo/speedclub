import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { GarageMedia } from '@/api/queries/garage';
import type { UploadItem } from '@/state/uploads';
import { createStyles, space } from '@/theme';
import { Dialog, ListRow, Sheet, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  message: { paddingBottom: t.space[12] },
}));

export type PhotoActionsSheetProps = {
  photo: GarageMedia | null;
  isCover: boolean;
  onClose: () => void;
  onMakeCover?: (photo: GarageMedia) => void;
  /** GAR-08: crop, focal point, alt text. */
  onEdit?: (photo: GarageMedia) => void;
  onDelete: (photo: GarageMedia) => void;
  testID: string;
};

/** The cover-photo action overlay of the register: Titelbild, Bearbeiten, Löschen (behind a dialog, never next to the rest). */
export function PhotoActionsSheet({ photo, isCover, onClose, onMakeCover, onEdit, onDelete, testID }: PhotoActionsSheetProps) {
  const { t } = useTranslation('garage');
  const rows = photo
    ? [
        onMakeCover && !isCover && photo.status === 'ready'
          ? { key: 'cover', icon: 'star' as const, title: t('photos.makeCover'), onPress: () => onMakeCover(photo), destructive: false }
          : null,
        onEdit && photo.status === 'ready'
          ? { key: 'edit', icon: 'pencil-simple' as const, title: t('photos.edit'), onPress: () => onEdit(photo), destructive: false }
          : null,
        { key: 'delete', icon: 'trash' as const, title: t('photos.delete'), onPress: () => onDelete(photo), destructive: true },
      ].filter((row) => row !== null)
    : [];
  return (
    <Sheet visible={photo !== null} onClose={onClose} title={t('photos.actionsTitle')} expandable={false} narrow testID={testID}>
      {rows.map((row, index) => (
        <ListRow
          key={row.key}
          icon={row.icon}
          title={row.title}
          role="button"
          chevron={false}
          destructive={row.destructive}
          onPress={() => {
            onClose();
            row.onPress();
          }}
          inset={space[0]}
          divider={index < rows.length - 1}
          testID={`${testID}.${row.key}`}
        />
      ))}
    </Sheet>
  );
}

export function DeletePhotoDialog({
  photo,
  onCancel,
  onConfirm,
  deleting,
  lastOfPublished,
  body,
  testID,
}: {
  photo: GarageMedia | null;
  onCancel: () => void;
  onConfirm: (photo: GarageMedia) => void;
  deleting: boolean;
  /** ADR-142 c: allowed, but the public page then shows no photo. */
  lastOfPublished: boolean;
  /** Replaces the usual text. */
  body?: string;
  testID: string;
}) {
  const { t } = useTranslation('garage');
  return (
    <Dialog
      visible={photo !== null}
      onClose={onCancel}
      title={t('photos.deleteTitle')}
      body={body ?? (lastOfPublished ? t('photos.deleteLastBody') : t('photos.deleteBody'))}
      testID={testID}
      actions={[
        { label: t('common.cancel'), variant: 'secondary', onPress: onCancel, testID: `${testID}.cancel` },
        { label: t('photos.deleteConfirm'), destructive: true, loading: deleting, onPress: () => photo && onConfirm(photo), testID: `${testID}.confirm` },
      ]}
    />
  );
}

/** A queue item's overlay: why it failed, retry, remove; or cancel while it runs. */
export function UploadSheet({ item, onClose, onRetry, onCancel, testID }: { item: UploadItem | null; onClose: () => void; onRetry: (id: string) => void; onCancel: (id: string) => void; testID: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const failed = item?.status === 'failed';
  const waiting = item?.status === 'waiting';
  return (
    <Sheet visible={item !== null} onClose={onClose} title={failed ? t('upload.failedTitle') : t('upload.runningTitle')} expandable={false} narrow testID={testID}>
      {item?.error ? (
        <View style={styles.message}>
          <Text variant="body" color="text.secondary" testID={`${testID}.message`}>
            {item.error}
          </Text>
        </View>
      ) : null}
      {item && (failed || waiting) && item.retryable ? (
        <ListRow
          icon="arrow-clockwise"
          title={t('upload.retry')}
          role="button"
          chevron={false}
          onPress={() => {
            onClose();
            onRetry(item.id);
          }}
          inset={space[0]}
          divider
          testID={`${testID}.retry`}
        />
      ) : null}
      {item ? (
        <ListRow
          icon="x"
          title={failed ? t('upload.remove') : t('upload.cancel')}
          role="button"
          chevron={false}
          destructive
          onPress={() => {
            onClose();
            onCancel(item.id);
          }}
          inset={space[0]}
          testID={`${testID}.cancel`}
        />
      ) : null}
    </Sheet>
  );
}
