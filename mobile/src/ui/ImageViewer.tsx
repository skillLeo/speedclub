import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles, space, useBreakpoint, useMotion } from '@/theme';

import { IconButton } from './IconButton';
import { useImagePlaceholder } from './imagePlaceholder';
import {
  VIEWER_DOUBLE_TAP_SCALE,
  VIEWER_MIN_SCALE,
  clampPan,
  clampScale,
  fittedSize,
  nextPage,
  panLimit,
  shouldDismiss,
  zoomAround,
} from './imageViewerMath';
import { OverlayModal, usePresence } from './overlay';
import { useSafeEdge } from './safeArea';
import { Text } from './Text';

export type ViewerImage = {
  uri: string;
  /** expo-image's cache; `memory` for a private picture such as a chat photo. Default: expo-image's own. */
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  blurhash?: string;
  /** Pixel ratio width / height. Read from the loaded file when absent. */
  aspectRatio?: number;
  /** Description for screen readers. */
  alt?: string;
};

export type ImageViewerProps = {
  visible: boolean;
  images: readonly ViewerImage[];
  /** The photo it opens on. */
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
  /**
   * Controls for the photo on screen, at the end of the top bar, for example "Melden" (VEH-04). Rendered on the photo, so use
   * `IconButton variant="onPhoto"`. Optional: without it the end of the bar stays empty.
   */
  actions?: (index: number) => ReactNode;
  /** A status line along the bottom edge, over the photo: the offline banner of VEH-04 when the photos come from the cache. */
  notice?: ReactNode;
  /** Sub-testIDs: `.counter`, `.close`, `.previous`, `.next`, `.stage`. */
  testID?: string;
};

const MODE_NONE = 0;
const MODE_PAGE = 1;
const MODE_DISMISS = 2;
const MODE_ZOOM = 3;
/** Neighbours stay mounted so a swipe never shows a blank page. */
const WINDOW = 1;
/** How much of the drag past the first or last photo still moves the track. */
const EDGE_RESISTANCE = 0.3;

const useStyles = createStyles((t) => ({
  root: { flex: 1, overflow: 'hidden' },
  // §7: always pure black. qr.fg is the only token that is #000000 in every theme.
  black: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.color.qr.fg },
  stage: { flex: 1 },
  slide: { bottom: 0, position: 'absolute', top: 0 },
  zoom: { flex: 1 },
  exiting: { pointerEvents: 'none' },
  image: { height: '100%', pointerEvents: 'none', width: '100%' },
  chrome: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  side: { minWidth: t.size.iconButton },
  notice: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  actions: { alignItems: 'flex-end' },
  counter: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[4],
  },
  arrow: { bottom: 0, justifyContent: 'center', pointerEvents: 'box-none', position: 'absolute', top: 0 },
  arrowLeft: { left: t.space[8] },
  arrowRight: { right: t.space[8] },
}));

/**
 * §8 image viewer: pure black, pinch 1 to 4 ×, double tap 2 ×, drag to dismiss at 120 or velocity 800, counter "3/12".
 * Web adds arrows and Escape on the keyboard, and previous / next buttons from tablet width up.
 */
export function ImageViewer(props: ImageViewerProps) {
  const motion = useMotion();
  const mounted = usePresence(props.visible, motion.duration.micro);
  return mounted && props.images.length > 0 ? <ViewerStage {...props} /> : null;
}

function ViewerStage({ visible, images, initialIndex = 0, onIndexChange, onClose, actions, notice, testID }: ImageViewerProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const motion = useMotion();
  const dimensions = useWindowDimensions();
  const { gutter, kind } = useBreakpoint();
  const safeTop = useSafeEdge('top');
  const safeBottom = useSafeEdge('bottom');
  const { springTo, timingTo, reduced } = motion;

  const count = images.length;
  const [stage, setStage] = useState({ width: dimensions.width, height: dimensions.height });
  const [index, setIndex] = useState(() => Math.min(count - 1, Math.max(0, initialIndex)));
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const current = images[index];
  const aspect = current?.aspectRatio ?? (current ? aspects[current.uri] : undefined) ?? 0;
  const fitted = fittedSize(stage.width, stage.height, aspect);

  const presence = useSharedValue(0);
  const pageFade = useSharedValue(1);
  const pageX = useSharedValue(-index * stage.width);
  const dismissY = useSharedValue(0);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const mode = useSharedValue(MODE_NONE);
  const fittedWidth = useSharedValue(fitted.width);
  const fittedHeight = useSharedValue(fitted.height);

  const { width: stageWidth, height: stageHeight } = stage;
  const { width: fittedW, height: fittedH } = fitted;

  useEffect(() => {
    presence.set(visible ? timingTo(1, 'small') : timingTo(0, 'micro'));
  }, [visible, presence, timingTo]);

  useEffect(() => {
    fittedWidth.set(fittedW);
    fittedHeight.set(fittedH);
  }, [fittedW, fittedH, fittedWidth, fittedHeight]);

  // A resized window keeps the current photo in place. A page change animates by itself and must not jump here.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    pageX.set(-indexRef.current * stageWidth);
  }, [stageWidth, pageX]);

  const settlePage = useCallback(
    (next: number) => {
      setIndex(next);
      onIndexChange?.(next);
    },
    [onIndexChange],
  );

  const resetZoom = useCallback(() => {
    scale.set(1);
    translateX.set(0);
    translateY.set(0);
  }, [scale, translateX, translateY]);

  /** Arrow keys and buttons. Reduced motion swaps the photo with a crossfade instead of a slide. */
  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= count || next === index) return;
      resetZoom();
      if (reduced) {
        pageX.set(-next * stageWidth);
        pageFade.set(0);
        pageFade.set(timingTo(1, 'small'));
      } else {
        pageX.set(timingTo(-next * stageWidth, 'medium'));
      }
      settlePage(next);
    },
    [count, index, pageFade, pageX, reduced, resetZoom, settlePage, stageWidth, timingTo],
  );

  useEffect(() => {
    if (!isWeb || !visible) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goTo(index + 1);
      if (event.key === 'ArrowLeft') goTo(index - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goTo, index, visible]);

  // Stays mounted for the exit animation: nothing in it may close it a second time. Declared before the gestures, whose
  // worklets capture it when they are created.
  const close = () => {
    if (visible) onClose();
  };

  // spring.sheet clamps its overshoot; the snappy spring would swing a whole page past its rest (§10: at most 2 %).
  const glide = (value: number) => {
    'worklet';
    return springTo(value, 'sheet');
  };

  const settleZoom = () => {
    'worklet';
    const next = clampScale(scale.get());
    const limitX = panLimit(fittedWidth.get(), stageWidth, next);
    const limitY = panLimit(fittedHeight.get(), stageHeight, next);
    scale.set(glide(next));
    translateX.set(glide(clampPan(translateX.get(), limitX)));
    translateY.set(glide(clampPan(translateY.get(), limitY)));
  };

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      startScale.set(scale.get());
      startX.set(translateX.get());
      startY.set(translateY.get());
    },
    onUpdate: (event) => {
      'worklet';
      const from = startScale.get();
      const next = clampScale(from * event.scale);
      scale.set(next);
      translateX.set(zoomAround(event.focalX - stageWidth / 2, startX.get(), from, next));
      translateY.set(zoomAround(event.focalY - stageHeight / 2, startY.get(), from, next));
    },
    onDeactivate: () => {
      'worklet';
      settleZoom();
    },
  });

  const pan = usePanGesture({
    minDistance: 8,
    maxPointers: 1,
    testID: testID ? `${testID}.pan` : undefined,
    onActivate: (event) => {
      'worklet';
      startX.set(translateX.get());
      startY.set(translateY.get());
      if (scale.get() > VIEWER_MIN_SCALE) mode.set(MODE_ZOOM);
      else mode.set(Math.abs(event.translationY) > Math.abs(event.translationX) ? MODE_DISMISS : MODE_PAGE);
    },
    onUpdate: (event) => {
      'worklet';
      const active = mode.get();
      if (active === MODE_ZOOM) {
        translateX.set(startX.get() + event.translationX);
        translateY.set(startY.get() + event.translationY);
      } else if (active === MODE_DISMISS) {
        dismissY.set(event.translationY);
      } else if (active === MODE_PAGE) {
        const atEdge =
          (index === 0 && event.translationX > 0) || (index === count - 1 && event.translationX < 0);
        pageX.set(-index * stageWidth + event.translationX * (atEdge ? EDGE_RESISTANCE : 1));
      }
    },
    onDeactivate: (event) => {
      'worklet';
      const active = mode.get();
      mode.set(MODE_NONE);
      if (active === MODE_ZOOM) {
        settleZoom();
      } else if (active === MODE_DISMISS) {
        if (shouldDismiss(event.translationY, event.velocityY)) scheduleOnRN(close);
        else dismissY.set(glide(0));
      } else if (active === MODE_PAGE) {
        const next = nextPage(index, count, event.translationX, event.velocityX, stageWidth);
        pageX.set(glide(-next * stageWidth));
        if (next !== index) scheduleOnRN(settlePage, next);
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (event) => {
      'worklet';
      if (scale.get() > VIEWER_MIN_SCALE) {
        scale.set(glide(VIEWER_MIN_SCALE));
        translateX.set(glide(0));
        translateY.set(glide(0));
        return;
      }
      const to = VIEWER_DOUBLE_TAP_SCALE;
      const limitX = panLimit(fittedWidth.get(), stageWidth, to);
      const limitY = panLimit(fittedHeight.get(), stageHeight, to);
      scale.set(glide(to));
      translateX.set(glide(clampPan(zoomAround(event.x - stageWidth / 2, 0, 1, to), limitX)));
      translateY.set(glide(clampPan(zoomAround(event.y - stageHeight / 2, 0, 1, to), limitY)));
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const blackStyle = useAnimatedStyle(() => ({
    opacity:
      presence.get() * interpolate(Math.abs(dismissY.get()), [0, stageHeight / 2], [1, 0.4], Extrapolation.CLAMP),
  }));
  const trackStyle = useAnimatedStyle(() => ({
    opacity: presence.get() * pageFade.get(),
    transform: [{ translateX: pageX.get() }, { translateY: dismissY.get() }],
  }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity:
      presence.get() * interpolate(Math.abs(dismissY.get()), [0, stageHeight / 4], [1, 0], Extrapolation.CLAMP),
  }));

  const onStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage({ width, height });
  };

  const showArrows = isWeb && kind !== 'phone' && count > 1;
  const counterLabel = t('a11y.photoCounter', { current: index + 1, total: count });

  return (
    <OverlayModal label={t('a11y.imageViewer')} onRequestClose={close}>
      <StatusBar style="light" />
      <View
        {...(isWeb ? {} : { role: 'dialog' as const, 'aria-modal': true, 'aria-label': t('a11y.imageViewer') })}
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        dataSet={{ qaExempt: 'photo' }}
        onLayout={onStageLayout}
        style={[styles.root, visible ? null : styles.exiting]}
        testID={testID}
      >
        <Animated.View style={[styles.black, blackStyle]} />
        <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
          <View style={styles.stage} testID={testID ? `${testID}.stage` : undefined}>
            <Animated.View style={[styles.stage, trackStyle]}>
              {images.map((image, position) =>
                Math.abs(position - index) > WINDOW ? null : (
                  <Slide
                    key={image.uri}
                    image={image}
                    active={position === index}
                    left={position * stageWidth}
                    width={stageWidth}
                    scale={scale}
                    translateX={translateX}
                    translateY={translateY}
                    onAspect={(value) => setAspects((known) => ({ ...known, [image.uri]: value }))}
                  />
                ),
              )}
            </Animated.View>
          </View>
        </GestureDetector>
        <Animated.View
          dataSet={{ qaExempt: 'safe-area photo' }}
          style={[styles.chrome, safeTop, { paddingHorizontal: gutter - space[12] }, chromeStyle]}
        >
          <View style={styles.side}>
            <IconButton
              icon="x"
              label={t('actions.close')}
              variant="onPhoto"
              onPress={close}
              testID={testID ? `${testID}.close` : undefined}
            />
          </View>
          {/* Screen readers step through the photos on the counter. As a slider it says the position as its value, not its name. */}
          <View
            accessible
            {...(isWeb
              ? { 'aria-label': counterLabel }
              : {
                  role: 'slider' as const,
                  'aria-label': t('a11y.imageViewer'),
                  'aria-valuemin': 1,
                  'aria-valuemax': count,
                  'aria-valuenow': index + 1,
                  'aria-valuetext': counterLabel,
                  accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
                  onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
                    if (event.nativeEvent.actionName === 'increment') goTo(index + 1);
                    if (event.nativeEvent.actionName === 'decrement') goTo(index - 1);
                  },
                })}
            style={styles.counter}
            testID={testID ? `${testID}.counter` : undefined}
          >
            <Text variant="caption" color="onPhoto.primary" selectable={false}>
              {`${index + 1}/${count}`}
            </Text>
          </View>
          <View style={[styles.side, styles.actions]}>{actions && count > 0 ? actions(index) : null}</View>
        </Animated.View>
        {notice ? <View style={[styles.notice, safeBottom]}>{notice}</View> : null}
        {showArrows && index > 0 ? (
          <View style={[styles.arrow, styles.arrowLeft]}>
            <IconButton
              icon="caret-left"
              label={t('actions.previous')}
              variant="onPhoto"
              onPress={() => goTo(index - 1)}
              testID={testID ? `${testID}.previous` : undefined}
            />
          </View>
        ) : null}
        {showArrows && index < count - 1 ? (
          <View style={[styles.arrow, styles.arrowRight]}>
            <IconButton
              icon="caret-right"
              label={t('actions.next')}
              variant="onPhoto"
              onPress={() => goTo(index + 1)}
              testID={testID ? `${testID}.next` : undefined}
            />
          </View>
        ) : null}
      </View>
    </OverlayModal>
  );
}

type SlideProps = {
  image: ViewerImage;
  active: boolean;
  left: number;
  width: number;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  onAspect: (aspect: number) => void;
};

function Slide({ image, active, left, width, scale, translateX, translateY, onAspect }: SlideProps) {
  const styles = useStyles();
  const motion = useMotion();
  const placeholder = useImagePlaceholder(image.blurhash, 'contain');
  const zoomStyle = useAnimatedStyle(() =>
    active
      ? { transform: [{ translateX: translateX.get() }, { translateY: translateY.get() }, { scale: scale.get() }] }
      : { transform: [] },
  );

  return (
    <View style={[styles.slide, { left, width }]} dataSet={{ qaExempt: 'photo' }}>
      <Animated.View style={[styles.zoom, zoomStyle]}>
        <Image
          source={{ uri: image.uri }}
          {...placeholder}
          {...(image.cachePolicy ? { cachePolicy: image.cachePolicy } : {})}
          contentFit="contain"
          transition={motion.reduced ? null : motion.duration.small}
          accessibilityLabel={image.alt}
          accessible={Boolean(image.alt) && active}
          onLoad={(event) => {
            const { width: pixelWidth, height: pixelHeight } = event.source;
            if (pixelWidth > 0 && pixelHeight > 0) onAspect(pixelWidth / pixelHeight);
          }}
          style={styles.image}
        />
      </Animated.View>
    </View>
  );
}
