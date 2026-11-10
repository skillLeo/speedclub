import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { avatarUrlOf, type Me } from '@/api/queries/auth';
import { useUploadProfileImage, type ProfileImageSlot } from '@/api/queries/profile';
import type { PickedPhoto } from '@/features/auth/avatar';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { createStyles } from '@/theme';
import { Avatar, Button, IconButton, Photo, Progress, Text } from '@/ui';

import { photoFields } from '../media';
import { pickProfilePhoto, profilePhotoForm } from '../photos';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  composite: { paddingBottom: t.space[4] },
  cover: { position: 'relative' },
  coverButton: { bottom: t.space[4], position: 'absolute', right: t.space[4] },
  avatarBox: { alignSelf: 'flex-start', marginLeft: t.space[16], marginTop: -t.space[32] },
  ring: {
    backgroundColor: t.color.bg.canvas,
    borderRadius: t.radius.full,
    bottom: -t.space[2],
    left: -t.space[2],
    position: 'absolute',
    right: -t.space[2],
    top: -t.space[2],
  },
  avatarButton: { bottom: -t.space[4], position: 'absolute', right: -t.space[12] },
  centre: { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  // The ring of §8 on a photo sits on the chip circle, so it reads on any image.
  badge: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    height: t.size.iconButtonOnPhoto,
    justifyContent: 'center',
    width: t.size.iconButtonOnPhoto,
  },
  failure: { alignItems: 'flex-start', gap: t.space[4] },
}));

type PhotoPick = { slot: ProfileImageSlot; photo: PickedPhoto; key: string };
type Failure = PhotoPick & { message: string };

function UploadBadge({ value, label, testID }: { value: number; label: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={[StyleSheet.absoluteFill, styles.centre]}>
      <View style={styles.badge}>
        <Progress variant="ring" value={value} onPhoto label={label} testID={testID} />
      </View>
    </View>
  );
}

export type ProfileImagesEditorProps = {
  me: Me;
  /** Width of the form column, for the cover variant. */
  width: number;
  /** Offline or restricted. */
  disabled?: boolean;
};

/**
 * PROF-03: cover 3:1 with the avatar over its corner, as on the profile. A pick uploads at once with its progress on the
 * image; the same pick keeps its idempotency key across retries, so a retried upload cannot arrive twice.
 */
export function ProfileImagesEditor({ me, width, disabled = false }: ProfileImagesEditorProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const avatar = useUploadProfileImage('avatar');
  const cover = useUploadProfileImage('cover');
  const [failure, setFailure] = useState<Failure | null>(null);
  const name = me.display_name || me.username || '';
  const percent = (value: number | null) => Math.round((value ?? 0) * 100);

  const send = async (pick: PhotoPick) => {
    setFailure(null);
    const upload = pick.slot === 'avatar' ? avatar : cover;
    try {
      const form = await profilePhotoForm(pick.photo, pick.slot);
      await upload.mutateAsync({ form, idempotencyKey: pick.key });
    } catch (error) {
      setFailure({ ...pick, message: error instanceof ApiError ? error.message : t('edit.photos.failed') });
    }
  };

  const choose = async (slot: ProfileImageSlot) => {
    let photo: PickedPhoto | null = null;
    try {
      photo = await pickProfilePhoto(slot);
    } catch {
      setFailure(null);
      return;
    }
    if (photo) await send({ slot, photo, key: newIdempotencyKey() });
  };

  return (
    <View style={styles.root} testID="PROF-03.images">
      <View style={styles.composite}>
        <View style={styles.cover}>
          <Photo {...photoFields(me.cover, width)} aspect="3:1" corner="md" testID="PROF-03.cover" />
          {cover.progress !== null ? (
            <UploadBadge
              value={cover.progress}
              label={t('edit.photos.coverUploading', { percent: percent(cover.progress) })}
              testID="PROF-03.cover.progress"
            />
          ) : null}
          <IconButton
            variant="onPhoto"
            icon="camera"
            label={me.cover ? t('edit.photos.cover') : t('edit.photos.coverAdd')}
            onPress={() => void choose('cover')}
            disabled={disabled}
            loading={cover.isPending}
            style={styles.coverButton}
            testID="PROF-03.cover.pick"
          />
        </View>
        <View style={styles.avatarBox}>
          <View style={styles.ring} />
          <Avatar name={name} uri={avatarUrlOf(me.avatar)} blurhash={me.avatar?.blurhash} size={96} decorative testID="PROF-03.avatar" />
          {avatar.progress !== null ? (
            <UploadBadge
              value={avatar.progress}
              label={t('edit.photos.avatarUploading', { percent: percent(avatar.progress) })}
              testID="PROF-03.avatar.progress"
            />
          ) : null}
          <IconButton
            variant="onPhoto"
            icon="camera"
            label={me.avatar ? t('edit.photos.avatar') : t('edit.photos.avatarAdd')}
            onPress={() => void choose('avatar')}
            disabled={disabled}
            loading={avatar.isPending}
            style={styles.avatarButton}
            testID="PROF-03.avatar.pick"
          />
        </View>
      </View>
      <Text variant="helper" color="text.secondary" testID="PROF-03.images.hint">
        {t('edit.photos.hint')}
      </Text>
      {failure ? (
        <View style={styles.failure}>
          <FormNotice message={failure.message} testID="PROF-03.images.error" />
          <Button
            label={t('edit.photos.retry')}
            variant="tertiary"
            size="m"
            disabled={disabled}
            onPress={() => void send(failure)}
            testID="PROF-03.images.retry"
          />
        </View>
      ) : null}
    </View>
  );
}
