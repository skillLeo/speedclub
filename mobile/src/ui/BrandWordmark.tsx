import { Image } from 'expo-image';
import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

/** A wordmark published in the admin (M3.5 ADM-28): its address and its intrinsic width / height. */
export type CustomWordmark = { uri: string; ratio: number };

export type BrandWordmarkProps = {
  /** Width in px; the height follows the file, so the logo can never be distorted. */
  width: number;
  /** A box of this height, with the logo fitted inside, where the rows below need a whole-pixel edge. */
  height?: number;
  /** `wide` is the horizontal logo; `square` the stacked one. */
  shape?: 'wide' | 'square';
  /** `auto` follows the theme: white on dark, black on light. On a photo pass `white`. */
  tone?: 'auto' | 'white' | 'black';
  /**
   * The published wide wordmarks, per tone (features/auth/AppWordmark). A tone without one, a failed load or the square shape keep the
   * bundled file.
   */
  custom?: { white: CustomWordmark | null; black: CustomWordmark | null };
  /** Hides the logo from screen readers when the name is next to it. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The product name: the accessible name of the logo, the same in every language. */
const BRAND_NAME = 'SPEED CLUB';

const FILES = {
  wide: {
    white: require('../../assets/brand/logo-wide-white.png') as number,
    black: require('../../assets/brand/logo-wide-black.png') as number,
    // Pixel size of the client's files.
    ratio: 1200 / 359,
  },
  square: {
    white: require('../../assets/brand/logo-square-white.png') as number,
    black: require('../../assets/brand/logo-square-black.png') as number,
    ratio: 900 / 591,
  },
} as const;

/**
 * The box of a wide wordmark of `ratio` in a slot made for the bundled one at `width`: a wider logo takes the full width and is
 * lower; a narrower one keeps the bundled height and is narrower. So it never grows taller than the layout planned, and is never
 * stretched.
 */
export function wordmarkBox(width: number, ratio: number): { width: number; aspectRatio: number } {
  const bundled = FILES.wide.ratio;
  return { width: ratio >= bundled ? width : (width * ratio) / bundled, aspectRatio: ratio };
}

const FIXED_BOX = { justifyContent: 'center' } as const;

/** The largest box of `ratio` inside width × height. */
function fitInto(width: number, height: number, ratio: number): { width: number; height: number } {
  return width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio };
}

/** §2 the client's logo, only ever white or black, for brand moments only. */
export function BrandWordmark({ width, height, shape = 'wide', tone = 'auto', custom, decorative = false, style, testID }: BrandWordmarkProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const file = FILES[shape];
  const resolved = tone === 'auto' ? (theme.colorScheme === 'dark' ? 'white' : 'black') : tone;
  const published = shape === 'wide' ? (custom?.[resolved] ?? null) : null;
  const own = published && published.uri !== failed ? published : null;
  const box =
    height !== undefined ? { height, width } : own ? wordmarkBox(width, own.ratio) : { aspectRatio: file.ratio, width };
  // In a fixed box a published logo of another ratio fits inside it, from the start edge and centred on the box's middle line.
  const image = height !== undefined && own ? fitInto(width, height, own.ratio) : box;
  return (
    <View
      {...(decorative ? { 'aria-hidden': true } : { accessible: true, role: 'img' as const, 'aria-label': BRAND_NAME })}
      testID={testID}
      style={[box, image === box ? null : FIXED_BOX, style]}
    >
      <Image
        source={own ? { uri: own.uri } : file[resolved]}
        contentFit="contain"
        onError={own ? () => setFailed(own.uri) : undefined}
        alt=""
        accessibilityLabel=""
        accessible={false}
        style={image}
        testID={testID ? `${testID}.image` : undefined}
      />
    </View>
  );
}
