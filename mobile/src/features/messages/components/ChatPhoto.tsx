import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';

import { createStyles } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import { Icon, type PhotoAspect } from '@/ui';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { ratioOf } from '@/ui/Photo';

import type { ChatMedia } from '../model';

const useStyles = createStyles((t) => ({
  // An explicit width: with only an aspect ratio the image has none of its own (0×0 in a bubble aligned to one side, M2.8).
  root: { alignSelf: 'stretch', width: '100%', backgroundColor: t.color.bg.raised, borderRadius: t.radius.sm, overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
}));

/** The smallest signed variant that fills `width` points on this screen, or the largest there is. */
export function chatPhotoUrl(media: Pick<ChatMedia, 'variants'> | null | undefined, width: number, pixelRatio: number = PixelRatio.get()): string | null {
  const variants = [...(media?.variants ?? [])].sort((a, b) => a.width - b.width);
  const needed = Math.ceil(width * pixelRatio);
  return (variants.find((variant) => variant.width >= needed) ?? variants[variants.length - 1])?.url ?? null;
}

export type ChatPhotoProps = {
  /** A signed URL of the server's copy, or the local file of a photo still on its way. */
  uri: string | null;
  blurhash: string | null;
  aspect: PhotoAspect;
  label: string;
  /**
   * The image did not load. For a signed URL that usually means it expired (ADR-208): the caller reads the conversation's newest
   * page once for fresh URLs, and the new URL loads in place.
   */
  onFailed?: (uri: string) => void;
  testID?: string;
};

/**
 * A chat photo (§7, ADR-208): explicit ratio, blurhash until it loads, 200 ms fade (off under reduced motion), and expo-image's
 * memory cache only, so a private photo never lands in the disk cache. No focal point: chat media carries none.
 */
export function ChatPhoto({ uri, blurhash, aspect, label, onFailed, testID }: ChatPhotoProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  // The failed URL and not a flag: a fresh URL after the refresh shows again, and FlashList recycles this view.
  const [failed, setFailed] = useState<string | null>(null);
  const source = useMemo(() => (uri ? { uri } : null), [uri]);
  const placeholder = useImagePlaceholder(blurhash, 'cover');
  const show = source !== null && failed !== uri;
  return (
    <View dataSet={{ qaExempt: 'photo' }} style={[styles.root, { aspectRatio: ratioOf(aspect) }]} testID={testID}>
      {show ? (
        <Image
          source={source}
          {...placeholder}
          placeholderContentFit="cover"
          contentFit="cover"
          cachePolicy="memory"
          transition={motion.reduced ? null : motionDuration('effect.default')}
          recyclingKey={uri ?? undefined}
          accessible
          alt={label}
          accessibilityLabel={label}
          onError={() => {
            if (!uri) return;
            setFailed(uri);
            onFailed?.(uri);
          }}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}.image` : undefined}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} accessible role="img" aria-label={label} testID={testID ? `${testID}.fallback` : undefined}>
          <Icon name="image" size={24} color="text.tertiary" />
        </View>
      )}
    </View>
  );
}
