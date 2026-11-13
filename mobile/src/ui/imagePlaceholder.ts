import type { ImageContentFit, ImageProps } from 'expo-image';
import { useMemo } from 'react';

import { blurhashToDataUrl } from '@/lib/blurhash';
import { isWeb } from '@/lib/platform';

export type ImagePlaceholderProps = Pick<ImageProps, 'placeholder' | 'placeholderContentFit'>;

/**
 * The placeholder props for expo-image: the thumbhash when there is one, else the blurhash.
 *
 * Native keeps `{ blurhash }`. Web gets the same hash drawn as a 32 × 32 PNG `data:` URL, because expo-image's web blurhash is
 * a `blob:` URL that it revokes on unmount, and WebKit then fails a load still in flight. A plain URL placeholder is fitted
 * with `placeholderContentFit` (default `scale-down`), whereas a hash placeholder follows `contentFit`, so web passes `fit`
 * along to keep the look.
 */
export function imagePlaceholder(blurhash: string | null | undefined, fit: ImageContentFit, thumbhash?: string | null): ImagePlaceholderProps {
  // 09 §4.6: the thumbhash where the media has one (computed at upload or seed), else the blurhash. expo-image draws a
  // thumbhash as a `data:` URL on web too, so it needs none of the blurhash's web detour.
  if (thumbhash) return { placeholder: { thumbhash } };
  if (!blurhash) return {};
  if (!isWeb) return { placeholder: { blurhash } };
  const uri = blurhashToDataUrl(blurhash);
  return uri ? { placeholder: { uri }, placeholderContentFit: fit } : {};
}

/** `imagePlaceholder`, stable across renders. */
export function useImagePlaceholder(blurhash: string | null | undefined, fit: ImageContentFit, thumbhash?: string | null): ImagePlaceholderProps {
  return useMemo(() => imagePlaceholder(blurhash, fit, thumbhash), [blurhash, fit, thumbhash]);
}
