/**
 * Picks and prepares an avatar: the system photo picker (no permission needed, the camera stays off), scaled down to what
 * the server keeps anyway, and re-encoded there as well (05_ARCHITECTURE §9). The preparation and the form are shared with
 * the profile's avatar and cover (features/profile/photos.ts).
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { isWeb } from '@/lib/platform';

export const AVATAR_MAX_EDGE = 2560;
const JPEG_QUALITY = 0.85;
const UPLOAD_NAME = 'avatar.jpg';
const UPLOAD_TYPE = 'image/jpeg';
const DATA_PREFIX = `data:${UPLOAD_TYPE};base64,`;

export type PickedPhoto = { uri: string; width: number; height: number };

export async function pickPhoto(): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: !isWeb,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
}

/** The size to scale to, along the longer edge. Null when the photo is small enough. */
export function resizeFor(photo: Pick<PickedPhoto, 'width' | 'height'>): { width: number } | { height: number } | null {
  if (Math.max(photo.width, photo.height) <= AVATAR_MAX_EDGE) return null;
  return photo.width >= photo.height ? { width: AVATAR_MAX_EDGE } : { height: AVATAR_MAX_EDGE };
}

/**
 * The JPEG to send, 2560 px at most on the long edge. On web it comes back as a data URI: the member web's CSP allows
 * connections to 'self' only (connect-src), so the manipulator's blob: URL could not be read back with fetch (OBS-R11-1).
 */
export async function prepareJpeg(photo: PickedPhoto): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const size = resizeFor(photo);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: isWeb });
  return isWeb && saved.base64 ? `${DATA_PREFIX}${saved.base64}` : saved.uri;
}

/** A data URI as a Blob, decoded in memory: no request, so no CSP rule applies. */
export function dataUriToBlob(uri: string): Blob {
  const comma = uri.indexOf(',');
  const head = comma === -1 ? '' : uri.slice(0, comma);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? UPLOAD_TYPE;
  const binary = atob(comma === -1 ? '' : uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/**
 * The multipart form for a prepared JPEG. Web never fetches the image: a data URI is decoded here, and anything else (no
 * base64 from the manipulator) is refused rather than read over the network, which the CSP would block anyway.
 */
export function jpegForm(uri: string, name: string): FormData {
  const form = new FormData();
  if (isWeb) {
    if (!uri.startsWith('data:')) throw new Error('The prepared image is not a data URI');
    form.append('file', dataUriToBlob(uri), name);
  } else {
    // React Native's FormData takes this shape for a file on disk.
    form.append('file', { uri, name, type: UPLOAD_TYPE } as unknown as Blob);
  }
  return form;
}

export async function avatarFormData(photo: PickedPhoto): Promise<FormData> {
  return jpegForm(await prepareJpeg(photo), UPLOAD_NAME);
}
