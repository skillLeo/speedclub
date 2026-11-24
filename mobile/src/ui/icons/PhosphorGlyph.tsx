import { memo, type ReactElement } from 'react';
import Svg, { G } from 'react-native-svg';

/** The weights the app draws (Icon.tsx `IconWeight`); the subset holds these two only. */
export type GlyphWeight = 'regular' | 'fill';

export type GlyphProps = {
  size?: number;
  weight?: GlyphWeight;
  color?: string;
  testID?: string;
};

export type Glyph = (props: GlyphProps) => ReactElement | null;

type GlyphBaseProps = GlyphProps & { name: string; weights: ReadonlyMap<GlyphWeight, ReactElement> };

/**
 * Phosphor's IconBase for the props the app passes (size, weight, colour, testID), drawing the same SVG: the 256 viewBox, `fill` in the
 * icon's colour on a group, Phosphor's class name and test ID (M5.12a). Its own file, because phosphor-react-native exports its base
 * only through the package root, which would bundle every icon of the library again.
 */
function GlyphBase({ name, weights, size = 24, weight = 'regular', color, testID }: GlyphBaseProps) {
  return (
    <Svg
      className={`${name}-${weight}__svg-icon-phosphor`}
      testID={testID ?? `phosphor-react-native-${name}-${weight}`}
      fill="currentColor"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      color={color}
    >
      <G fill={color}>{weights.get(weight)}</G>
    </Svg>
  );
}

export const PhosphorGlyph = memo(GlyphBase);
