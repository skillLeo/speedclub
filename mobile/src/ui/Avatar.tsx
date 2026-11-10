import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size as sizeTokens, useMotion, type TypeVariant } from '@/theme';

import { useImagePlaceholder } from './imagePlaceholder';
import { useEagerImages } from './qaVisualState';
import { Text, typeStyle } from './Text';

export type AvatarSize = 24 | 32 | 40 | 56 | 96;

export type AvatarProps = {
  /** Display name or username: the accessible name and the source of the initials. */
  name: string;
  uri?: string | null;
  blurhash?: string | null;
  size?: AvatarSize;
  /** Hides the avatar from screen readers when the name is next to it. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  root: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    justifyContent: 'center',
  },
  image: { borderRadius: t.radius.full },
  innerBorder: {
    borderColor: t.color.avatar.innerBorder,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    pointerEvents: 'none',
  },
}));

/**
 * ADR-150: the circle has a fixed size, so the initials follow the avatar and not the font scale, on every platform. The
 * name next to the avatar carries the scaled text. `allowFontScaling` covers native; web scales through the Text style,
 * which the unscaled style replaces.
 */
export function initialsVariant(size: AvatarSize): TypeVariant {
  switch (size) {
    case sizeTokens.avatar.xs:
      return 'caption';
    case sizeTokens.avatar.sm:
      return 'labelS';
    case sizeTokens.avatar.lg:
      return 'titleS';
    case sizeTokens.avatar.xl:
      return 'titleM';
    default:
      return 'label';
  }
}

/** The DOM audit accepts the unscaled pair on an avatar's initials only, and counts it (web/tests/e2e/support/dom-audit.mjs). */
const FIXED_GLYPH = { qaExempt: 'fixed-glyph' } as const;

export function initialsOf(name: string, limit: number): string {
  const parts = name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  // DQ-270: a digit is no initial. "lena.911" gives "L", "kenji.r34" gives "KR"; a name of digits only keeps its first.
  const lettered = parts.filter((word) => /^\p{L}/u.test(word));
  const words = lettered.length > 0 ? lettered : parts;
  return words
    .slice(0, limit)
    .map((word) => (Array.from(word)[0] ?? '').toLocaleUpperCase('de-DE'))
    .join('');
}

/** §8 avatar: 24/32/40/56/96, 1 inner border, initials on bg.raised as the fallback. */
export function Avatar({ name, uri, blurhash, size = 40, decorative = false, style, testID }: AvatarProps) {
  const styles = useStyles();
  const motion = useMotion();
  const eager = useEagerImages();
  const placeholder = useImagePlaceholder(blurhash, 'cover');
  const box = { width: size, height: size };
  const initials = initialsOf(name, size === sizeTokens.avatar.xs ? 1 : 2);
  const variant = initialsVariant(size);

  return (
    <View
      accessible={!decorative}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative}
      testID={testID}
      style={[styles.root, box, style]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          loading={eager ? 'eager' : undefined}
          {...placeholder}
          contentFit="cover"
          transition={motion.reduced ? null : motion.duration.small}
          recyclingKey={uri}
          alt=""
          accessibilityLabel=""
          accessible={false}
          style={[styles.image, box]}
          testID={testID ? `${testID}.image` : undefined}
        />
      ) : initials === '' ? null : (
        // DQ-415: no name, no initials node (an empty one would carry the fixed-glyph exemption on a 0×0 box).
        <Text
          variant={variant}
          color="text.secondary"
          allowFontScaling={false}
          selectable={false}
          aria-hidden
          dataSet={FIXED_GLYPH}
          style={typeStyle(variant, 1)}
        >
          {initials}
        </Text>
      )}
      <View style={[StyleSheet.absoluteFill, styles.innerBorder]} />
    </View>
  );
}
