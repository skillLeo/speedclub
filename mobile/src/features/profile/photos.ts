/**
 * Picks and prepares a profile image: the system photo picker (no permission needed, the camera stays off), scaled down to
 * what the server keeps anyway and re-encoded as JPEG without metadata; the server re-encodes again (05_ARCHITECTURE §9).
 *
 * The avatar is cropped square where the platform offers it. The cover is cropped 16:9 (ADR-451) on Android only: the iOS cropper is
 * always square, so iOS and the web send the whole photo and the profile crops it around its centre.
 */
import * as ImagePicker from 'expo-image-picker';

import type { ProfileImageSlot } from '@/api/queries/profile';
import { jpegForm, prepareJpeg, type PickedPhoto } from '@/features/auth/avatar';
import { isAndroid, isWeb } from '@/lib/platform';

const PICKER: Record<ProfileImageSlot, ImagePicker.ImagePickerOptions> = {
  avatar: { mediaTypes: ['images'], allowsEditing: !isWeb, aspect: [1, 1], quality: 1, exif: false },
  cover: { mediaTypes: ['images'], allowsEditing: isAndroid, aspect: [16, 9], quality: 1, exif: false },
};

export async function pickProfilePhoto(slot: ProfileImageSlot): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync(PICKER[slot]);
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
}

export async function profilePhotoForm(photo: PickedPhoto, slot: ProfileImageSlot): Promise<FormData> {
  // On web the image comes back as a data URI and is decoded in memory: the CSP refuses fetch(blob:) (OBS-R11-1).
  return jpegForm(await prepareJpeg(photo), `${slot}.jpg`);
}
