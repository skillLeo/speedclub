/**
 * Picking and preparing garage photos (02_PRODUCT_SPEC §3.2, 05_ARCHITECTURE §9): the system photo picker (no broad media
 * permission, Play policy), several at once; then scaled to 2560 px on the long edge and re-encoded as JPEG, which also turns
 * HEIC into JPEG and drops the metadata. The server re-encodes again. On web the picker is a file input.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { resizeFor } from '@/features/auth/avatar';
import { isWeb } from '@/lib/platform';
import type { PickedPhoto } from '@/state/uploads';

/** 02_PRODUCT_SPEC §3.2. */
export const VEHICLE_PHOTO_LIMIT = 30;
export const MOD_PHOTO_LIMIT = 6;

const JPEG_QUALITY = 0.85;
const UPLOAD_NAME = 'photo.jpg';
const UPLOAD_TYPE = 'image/jpeg';

/** Null when the member closed the picker. At most `limit` photos, in the order they were picked. */
export async function pickPhotos(limit: number): Promise<PickedPhoto[] | null> {
  if (limit <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return null;
  return result.assets.slice(0, limit).map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height }));
}

/**
 * On web the picker hands out `blob:` URLs (URL.createObjectURL of the chosen file), which hold the file until revoked.
 * The queue calls this once an item has left it: its tile is gone, and the upload no longer needs the file.
 */
export function releasePicked(photo: PickedPhoto): void {
  if (isWeb && photo.uri.startsWith('blob:')) URL.revokeObjectURL(photo.uri);
}

const DATA_PREFIX = `data:${UPLOAD_TYPE};base64,`;

/**
 * The JPEG to send: 2560 px at most on the long edge. On web it comes back as a data URI: the member web's CSP allows
 * connections to 'self' only (connect-src), so a blob: URL could not be read back with fetch for the upload.
 */
export async function preparePhoto(photo: PickedPhoto): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const size = resizeFor(photo);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: isWeb });
  return isWeb && saved.base64 ? `${DATA_PREFIX}${saved.base64}` : saved.uri;
}

/** A data URI as a Blob, decoded in memory: no request, so no CSP rule applies. */
export function dataUriToBlob(uri: string): Blob {
  const [head = '', data = ''] = uri.split(',');
  const type = /^data:([^;]+)/.exec(head)?.[1] ?? UPLOAD_TYPE;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function photoForm(uri: string): Promise<FormData> {
  const form = new FormData();
  if (isWeb) {
    const blob = uri.startsWith('data:') ? dataUriToBlob(uri) : await (await globalThis.fetch(uri)).blob();
    form.append('file', blob, UPLOAD_NAME);
  } else {
    // React Native's FormData takes this shape for a file on disk.
    form.append('file', { uri, name: UPLOAD_NAME, type: UPLOAD_TYPE } as unknown as Blob);
  }
  return form;
}
