import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { createStyles } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';

const useStyles = createStyles(() => ({
  box: { overflow: 'hidden', position: 'relative' },
  layer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
}));

/**
 * DQ-M54R2-02: on a screen the sticker sits on its own stage, so the server's square surface behind the die line goes: a Round
 * sticker is a circle, not a circle on a tile. The film (`#material`) keeps the substrate colour inside the cut.
 */
export function svgOnStage(svg: string): string {
  return svg.replace(/<rect id="surface"[^>]*\/>/, '');
}

/**
 * The server's drawing for "am Auto": the film itself, without the stage behind it. The preview SVG (m5.4-contract §6.5) draws the
 * sticker on its surface (`#surface`) and the film (`#material`); on a photo the transparent film disappears and only the inks stay,
 * white vinyl keeps its white shape. A mirrored print is seen from outside through the glass, so its artwork turns back.
 */
export function svgOnCar(svg: string, material: 'transparent' | 'white_vinyl'): string {
  let out = svg.replace(/<rect id="surface"[^>]*\/>/, '');
  if (material === 'transparent') out = out.replace(/(<path id="material"[^>]*?)fill="[^"]*"/, '$1fill="none"');
  out = out.replace(/<g id="artwork" transform="matrix\(-1 0 0 1 [\d.]+ 0\)">/, '<g id="artwork">');
  // The faint die line belongs to the screen preview, not to a sticker on a car.
  if (material === 'transparent') out = out.replace(/<path id="edge"[^>]*\/>/, '');
  return out;
}

export type StickerArtProps = {
  /** SVG markup from the server (preview or a version's preview.svg). */
  svg: string;
  /** Drawn width; the height follows the sticker's millimetres. */
  width: number;
  widthMm: number;
  heightMm: number;
  /** The accessible description of the picture ("Sticker Classic, 156 × 65 mm, …"). */
  label: string;
  /** Template switch: the new drawing fades in over the last one (effect.default, 10 §2.3). */
  crossfade?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The sticker as the server draws it, at a given width, with an accessible description and an optional crossfade. */
export function StickerArt({ svg: raw, width, widthMm, heightMm, label, crossfade = false, style, testID }: StickerArtProps) {
  const svg = svgOnStage(raw);
  const styles = useStyles();
  const motion = useMotionPreference();
  const height = widthMm > 0 ? (width * heightMm) / widthMm : 0;
  const [previous, setPrevious] = useState<string | null>(null);
  const shown = useRef(svg);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (shown.current === svg) return;
    const last = shown.current;
    shown.current = svg;
    if (!crossfade || !motion.enabled) return;
    setPrevious(last);
    fade.set(0);
    const done = () => setPrevious(null);
    fade.set(motion.effectTo(1, 'default'));
    // The old drawing goes once the new one has settled (the token's settle time).
    const timer = setTimeout(done, motionDuration('effect.default'));
    return () => clearTimeout(timer);
  }, [svg, crossfade, motion, fade]);

  const top = useAnimatedStyle(() => ({ opacity: fade.get() }));

  return (
    <View
      role="img"
      aria-label={label}
      style={[styles.box, { width, height }, style]}
      dataSet={{ qaExempt: 'qr' }}
      testID={testID}
    >
      {previous ? (
        <View style={styles.layer} aria-hidden>
          <SvgXml xml={previous} width={width} height={height} />
        </View>
      ) : null}
      <Animated.View style={[styles.layer, top]} aria-hidden>
        <SvgXml xml={svg} width={width} height={height} />
      </Animated.View>
    </View>
  );
}
