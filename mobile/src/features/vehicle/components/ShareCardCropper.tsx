import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { components } from '@/api/schema';
import { photoFields } from '@/features/profile/media';
import { useFinePointer } from '@/lib/platform';
import { createStyles, layout } from '@/theme';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { useMotionPreference } from '@/ui/motion';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';
import { keyOf } from '@/ui/useRovingKeys';

import {
  baseWindow,
  CROP_KEY_STEP,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
  CROP_ZOOM_STEP,
  cropWindow,
  nudgeCrop,
  panCrop,
  zoomCrop,
  type ShareCardCrop,
  type Size,
} from '../shareCardCrop';

type Media = components['schemas']['MediaResource'];

/** The crop stays in view on a phone, as the preview does: at most 480 high. */
const STAGE_MAX_HEIGHT = (layout.feedColumn * 3) / 4;

const MOVES: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-CROP_KEY_STEP, 0],
  ArrowRight: [CROP_KEY_STEP, 0],
  ArrowUp: [0, -CROP_KEY_STEP],
  ArrowDown: [0, CROP_KEY_STEP],
  moveLeft: [-CROP_KEY_STEP, 0],
  moveRight: [CROP_KEY_STEP, 0],
  moveUp: [0, -CROP_KEY_STEP],
  moveDown: [0, CROP_KEY_STEP],
};

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  stage: {
    alignSelf: 'center',
    backgroundColor: t.color.media.ground,
    borderRadius: t.radius.sm,
    overflow: 'hidden',
    width: '100%',
  },
  stageStart: { alignSelf: 'flex-start' },
  image: { left: 0, position: 'absolute', top: 0 },
  // The card's edge on the photo: a hairline, so the crop reads as a frame and not as a photo of its own.
  edge: { ...StyleSheet.absoluteFill, borderColor: t.color.onPhoto.border, borderRadius: t.radius.sm, borderWidth: t.size.border.control, pointerEvents: 'none' },
  controls: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  zoomValue: { minWidth: t.size.touchMin, textAlign: 'center' },
  reset: { marginLeft: 'auto' },
  resetBeside: { marginLeft: t.space[12] },
}));

export type ShareCardCropperProps = {
  media: Media;
  /** The photo's pixel size. */
  photo: Size;
  /** The template's photo box on this format: the aspect of the crop. */
  box: Size;
  /** Normalised (shareCardCrop normalizeCrop). */
  crop: ShareCardCrop;
  onChange: (crop: ShareCardCrop) => void;
  /** Whether the crop is the server's default: "Zurücksetzen" has nothing to undo. */
  isDefault: boolean;
  onReset: () => void;
  disabled?: boolean;
  /**
   * R5DQ-03, beside the card (from 768): the stage starts at the column's left edge and is never taller than this (about 0.6 × the
   * card preview), so the tool never outweighs the card it edits. Without it (phone) the stage is centred under the centred card.
   */
  maxStageHeight?: number;
  routeId: string;
};

/**
 * R5-2e VEH-07: the card's photo in the template's photo box. Drag moves the window, pinch or "−" / "+" zoom it (1 – 3), arrow keys
 * move it on the web, the screen reader gets the moves as actions. The view is the crop as the server draws it (shareCardCrop), at
 * once; the card itself is redrawn once the member stops. A release never glides on (no momentum), so reduced motion has nothing to
 * take away but the eased zoom of the buttons, which turns into the effect crossfade.
 */
export function ShareCardCropper({ media, photo, box, crop, onChange, isDefault, onReset, disabled = false, maxStageHeight, routeId }: ShareCardCropperProps) {
  const finePointer = useFinePointer();
  const { t, i18n } = useTranslation('vehicle');
  const styles = useStyles();
  const { springTo } = useMotionPreference();
  const [viewWidth, setViewWidth] = useState(0);
  const ratio = box.width / box.height;
  const beside = maxStageHeight !== undefined;
  const stageMaxWidth = Math.min(STAGE_MAX_HEIGHT, maxStageHeight ?? STAGE_MAX_HEIGHT) * ratio;

  // The image is laid out once at zoom 1 (the base window fills the view); zoom and position are a transform on the UI thread.
  const base = baseWindow(photo, box);
  const unit = viewWidth > 0 ? viewWidth / base.width : 0;
  const imageWidth = photo.width * unit;
  const imageHeight = photo.height * unit;
  const fields = photoFields(media, Math.round(imageWidth * 2));
  const placeholder = useImagePlaceholder(fields.blurhash, 'cover', fields.thumbhash);

  const zoom = useSharedValue(crop.zoom);
  const x = useSharedValue(crop.x);
  const y = useSharedValue(crop.y);
  const width = useSharedValue(viewWidth);
  const start = useSharedValue<ShareCardCrop>(crop);
  const active = useSharedValue(false);

  useEffect(() => {
    width.set(viewWidth);
  }, [viewWidth, width]);

  // A new crop from outside (the buttons, the keys, another template, "Zurücksetzen") eases there; a finger's crop is already there.
  useEffect(() => {
    if (active.get()) return;
    zoom.set(springTo(crop.zoom, 'calm'));
    x.set(springTo(crop.x, 'calm'));
    y.set(springTo(crop.y, 'calm'));
  }, [active, crop.zoom, crop.x, crop.y, springTo, x, y, zoom]);

  const commit = (zoomValue: number, xValue: number, yValue: number) => onChange({ zoom: zoomValue, x: xValue, y: yValue });

  const place = (next: ShareCardCrop) => {
    'worklet';
    zoom.set(next.zoom);
    x.set(next.x);
    y.set(next.y);
  };

  const begin = () => {
    'worklet';
    active.set(true);
    start.set({ zoom: zoom.get(), x: x.get(), y: y.get() });
  };

  const end = () => {
    'worklet';
    active.set(false);
    scheduleOnRN(commit, zoom.get(), x.get(), y.get());
  };

  const pan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      begin();
    },
    onUpdate: (event) => {
      'worklet';
      if (width.get() <= 0) return;
      place(panCrop(photo, box, start.get(), event.translationX, event.translationY, width.get()));
    },
    onDeactivate: () => {
      'worklet';
      end();
    },
  });

  const pinch = usePinchGesture({
    enabled: !disabled,
    onActivate: () => {
      'worklet';
      begin();
    },
    onUpdate: (event) => {
      'worklet';
      const from = start.get();
      place(zoomCrop(photo, box, { zoom: zoom.get(), x: x.get(), y: y.get() }, from.zoom * event.scale));
    },
    onDeactivate: () => {
      'worklet';
      end();
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch);

  const imageStyle = useAnimatedStyle(() => {
    const w = width.get();
    if (w <= 0) return { opacity: 0 };
    const current = { zoom: zoom.get(), x: x.get(), y: y.get() };
    const window = cropWindow(photo, box, current);
    const scale = w / base.width;
    const z = base.width / window.width;
    // Scaled about the image's centre (the transform's default origin): this moves the window's top left corner to the view's.
    const halfW = (photo.width * scale) / 2;
    const halfH = (photo.height * scale) / 2;
    return {
      opacity: 1,
      transform: [
        { translateX: -(halfW + z * (window.left * scale - halfW)) },
        { translateY: -(halfH + z * (window.top * scale - halfH)) },
        { scale: z },
      ],
    };
  });

  const zoomBy = (delta: number) => onChange(zoomCrop(photo, box, crop, crop.zoom + delta));
  const nudge = (move: readonly [number, number]) => onChange(nudgeCrop(photo, box, crop, move[0], move[1]));

  const zoomLabel = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(crop.zoom);
  const position = t('shareCard.cropPosition', { zoom: zoomLabel, x: Math.round(crop.x * 100), y: Math.round(crop.y * 100) });

  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    if (disabled) return;
    const key = keyOf(event) ?? '';
    const move = MOVES[key];
    if (move) {
      event.preventDefault?.();
      nudge(move);
    } else if (key === '+' || key === '=') {
      event.preventDefault?.();
      zoomBy(CROP_ZOOM_STEP);
    } else if (key === '-') {
      event.preventDefault?.();
      zoomBy(-CROP_ZOOM_STEP);
    }
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    const move = MOVES[name];
    if (move) nudge(move);
    else if (name === 'zoomIn') zoomBy(CROP_ZOOM_STEP);
    else if (name === 'zoomOut') zoomBy(-CROP_ZOOM_STEP);
    else return;
    AccessibilityInfo.announceForAccessibility(position);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setViewWidth((current) => (current === next ? current : next));
  };

  return (
    <View style={styles.root}>
      <Text variant="callout" color="text.secondary">
        {t(finePointer ? 'shareCard.cropHintKeys' : 'shareCard.cropHint')}
      </Text>
      <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
        <PressableScale
          role="button"
          aria-label={`${t('shareCard.crop')}: ${position}`}
          accessibilityHint={finePointer ? t('shareCard.cropKeys') : t('shareCard.cropActions')}
          accessibilityActions={
            disabled
              ? undefined
              : [
                  { name: 'zoomIn', label: t('shareCard.zoomIn') },
                  { name: 'zoomOut', label: t('shareCard.zoomOut') },
                  { name: 'moveLeft', label: t('shareCard.moveLeft') },
                  { name: 'moveRight', label: t('shareCard.moveRight') },
                  { name: 'moveUp', label: t('shareCard.moveUp') },
                  { name: 'moveDown', label: t('shareCard.moveDown') },
                ]
          }
          onAccessibilityAction={onAccessibilityAction}
          feedback={false}
          ring="inset"
          disabled={disabled}
          onLayout={onLayout}
          dataSet={{ qaExempt: 'photo' }}
          style={[styles.stage, beside ? styles.stageStart : null, { aspectRatio: ratio, maxWidth: stageMaxWidth }]}
          testID={`${routeId}.crop`}
          {...({ onKeyDown } as object)}
        >
          {fields.source && viewWidth > 0 ? (
            <Animated.View style={[styles.image, { width: imageWidth, height: imageHeight }, imageStyle]} testID={`${routeId}.crop.image`}>
              <Image
                source={typeof fields.source === 'string' ? { uri: fields.source } : fields.source}
                {...placeholder}
                contentFit="cover"
                draggable={false}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
          <View style={styles.edge} />
        </PressableScale>
      </GestureDetector>
      {/* R5DQ-03 r2: beside the card the stage can be narrower than "− 1,5× + Zurücksetzen"; the row then spans the column and
          "Zurücksetzen" follows the zoom controls, so it never wraps onto a row of its own. */}
      <View style={styles.controls} testID={`${routeId}.crop.controls`}>
        <IconButton
          icon="minus"
          label={t('shareCard.zoomOut')}
          onPress={() => zoomBy(-CROP_ZOOM_STEP)}
          disabled={disabled || crop.zoom <= CROP_ZOOM_MIN}
          testID={`${routeId}.crop.zoomOut`}
        />
        <Text variant="callout" color="text.secondary" numeric style={styles.zoomValue} testID={`${routeId}.crop.zoom`}>
          {t('shareCard.zoomValue', { zoom: zoomLabel })}
        </Text>
        <IconButton
          icon="plus"
          label={t('shareCard.zoomIn')}
          onPress={() => zoomBy(CROP_ZOOM_STEP)}
          disabled={disabled || crop.zoom >= CROP_ZOOM_MAX}
          testID={`${routeId}.crop.zoomIn`}
        />
        <Button
          label={t('shareCard.cropReset')}
          variant="tertiary"
          size="s"
          onPress={onReset}
          disabled={disabled || isDefault}
          style={beside ? styles.resetBeside : styles.reset}
          testID={`${routeId}.crop.reset`}
        />
      </View>
    </View>
  );
}
