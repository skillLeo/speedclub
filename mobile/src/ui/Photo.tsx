import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { aspect as aspectTokens, createStyles, radius } from '@/theme';

import { motionDuration, useMotionPreference } from './motion';
import { Icon } from './icons/Icon';
import { useImagePlaceholder } from './imagePlaceholder';
import { useEagerImages } from './qaVisualState';

export type PhotoAspect = (typeof aspectTokens)[keyof typeof aspectTokens];
/** 0 to 1 from the left and from the top: the focal point set in GAR-08. */
export type PhotoFocal = { x: number; y: number };
export type PhotoCorner = keyof typeof radius | 'none';

/** What a screen knows about one photo. `source` is a URL, or a bundled `require()`. */
export type PhotoFields = {
  source?: string | number | null;
  blurhash?: string | null;
  /** Preferred over the blurhash when the media has one (09 §4.6). */
  thumbhash?: string | null;
  focal?: PhotoFocal | null;
};

export type PhotoProps = PhotoFields & {
  /** Required, so the box is known before the image loads: no layout shift, no distortion. */
  aspect: PhotoAspect;
  /** Alt text. Leave it out when the name is next to the photo or on the pressable around it. */
  label?: string;
  corner?: PhotoCorner;
  /** expo-image's cache. `memory` keeps a private picture (a chat photo) off the disk; the default is expo-image's own. */
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  /** Drawn over the photo, for example PhotoScrim, badges and on-photo controls. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PERCENT = 100;

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch', backgroundColor: t.color.bg.raised, overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
}));

export function ratioOf(aspect: PhotoAspect): number {
  const [width = 1, height = 1] = aspect.split(':').map(Number);
  return width / height;
}

function percentOf(fraction: number): `${number}%` {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * PERCENT)}%`;
}

/** expo-image turns this into `object-position` on web and into the same crop on native. */
export function focalToPosition(focal: PhotoFocal) {
  return { left: percentOf(focal.x), top: percentOf(focal.y) };
}

/**
 * §7 photo: an explicit ratio, always `cover`, cropped around the focal point, blurhash until it loads, fade-in
 * 200 ms (off under reduced motion). A missing or broken image leaves the surface with one quiet glyph.
 */
export function Photo({ source, blurhash, thumbhash, focal, aspect, label, corner = 'none', cachePolicy, children, style, testID }: PhotoProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const eager = useEagerImages();
  // Holds the failed source and not a flag: FlashList recycles this component for the next photo.
  const [failed, setFailed] = useState<PhotoFields['source']>(null);
  const image = useMemo(() => (typeof source === 'string' ? { uri: source } : source), [source]);
  const position = useMemo(() => (focal ? focalToPosition(focal) : 'center'), [focal]);
  const shape = { aspectRatio: ratioOf(aspect), borderRadius: corner === 'none' ? 0 : radius[corner] };
  const showImage = Boolean(source) && failed !== source;
  const placeholder = useImagePlaceholder(blurhash, 'cover', thumbhash);

  return (
    <View dataSet={{ qaExempt: 'photo' }} testID={testID} style={[styles.root, shape, style]}>
      {showImage ? (
        <Image
          source={image}
          loading={eager ? 'eager' : undefined}
          {...placeholder}
          placeholderContentFit="cover"
          contentFit="cover"
          contentPosition={position}
          transition={motion.reduced ? null : motionDuration('effect.default')}
          recyclingKey={typeof source === 'string' ? source : undefined}
          {...(cachePolicy ? { cachePolicy } : {})}
          accessible={Boolean(label)}
          alt={label ?? ''}
          accessibilityLabel={label ?? ''}
          onError={() => setFailed(source)}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}.image` : undefined}
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, styles.fallback]}
          testID={testID ? `${testID}.fallback` : undefined}
          {...(label ? { accessible: true, role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true })}
        >
          <Icon name="image" size={24} color="text.tertiary" />
        </View>
      )}
      {children}
    </View>
  );
}
