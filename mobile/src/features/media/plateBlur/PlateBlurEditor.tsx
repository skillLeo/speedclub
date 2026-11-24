import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isNudgeKey, regionPercent, type BlurRegion } from '@/features/garage/blur';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Switch } from '@/ui/Switch';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { useMotionPreference } from '@/ui/motion';
import { useFocusRing } from '@/ui/useFocusRing';
import { keyOf } from '@/ui/useRovingKeys';

import { AngleSlider } from './AngleSlider';
import {
  addRegionTo,
  ANGLE_ACTION_STEP,
  ANGLE_STEP,
  angleOf,
  angleToward,
  canAdd,
  keyRegion,
  MAX_ANGLE,
  moveRegion,
  regionCentre,
  removeRegionFrom,
  replaceRegionIn,
  resizeTurned,
  scaleRegion,
  setBlur,
  turnHandlePoint,
  turnRegion,
  UPLOAD_MAX_REGIONS,
  type PlateBlurChoice,
  type Point,
} from './model';

/** The photo as the editor draws it: its file (picked or online) and its real size, after EXIF orientation. */
export type PlateBlurPhoto = { uri: string; width: number; height: number; blurhash?: string | null; thumbhash?: string | null };

export type PlateBlurEditorProps = {
  photo: PlateBlurPhoto;
  value: PlateBlurChoice;
  onChange: (next: PlateBlurChoice) => void;
  /**
   * `upload` (default): the switch "Kennzeichen unkenntlich machen" before an upload. `existing`: GAR-08 mode for a photo already
   * online ("Kennzeichen prüfen"): no switch, only the rectangles that will be pixelated.
   */
  mode?: 'upload' | 'existing';
  /** Submitting, offline or restricted: nothing moves. */
  disabled?: boolean;
  /**
   * `<ROUTE-ID>.plateBlur`; sub-IDs `.switch`, `.stage`, `.region.<n>`, `.region.<n>.move`, `.region.<n>.handle`, `.region.<n>.turn`,
   * `.region.<n>.remove`, `.angle` (`.angle.thumb`, `.angle.value`), `.add`, `.hint`, `.note`.
   */
  testID: string;
};

/** As GAR-08: the whole photo stays in view, at most 480 high on wide screens and half the window on phones. */
const STAGE_MAX_HEIGHT = (layout.feedColumn * 3) / 4;
const STAGE_WINDOW_SHARE = 0.5;
/** The preview's blur, strong enough that a plate is gone at any stage width (GAR-08's value). */
const PREVIEW_BLUR = 24;
/** The on-photo hint sits under the rectangle (the × is above its right corner), above it when the rectangle ends this low. */
const HINT_ABOVE_FROM = 0.88;

/** The turn handle's centre sits this far above the middle of the rectangle's top edge (a 44 target clear of the edge). */
const TURN_REACH = size.touchMin / 2 + space[4];

type Gesture = 'move' | 'resize' | 'turn';

const ACTIONS = ['moveLeft', 'moveRight', 'moveUp', 'moveDown', 'grow', 'shrink', 'turnLeft', 'turnRight'] as const;
type ActionName = (typeof ACTIONS)[number];
const ACTION_KEYS: Record<Exclude<ActionName, 'grow' | 'shrink' | 'turnLeft' | 'turnRight'>, 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'> = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  moveUp: 'ArrowUp',
  moveDown: 'ArrowDown',
};

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between', minHeight: t.size.row.single },
  switchText: { flex: 1, gap: t.space[2] },
  stage: { alignSelf: 'center', width: '100%' },
  // The photo takes no pointer: on web an <img> is draggable, and the browser's image drag would cancel the pan (M2.8).
  photo: { borderRadius: t.radius.md, pointerEvents: 'none', ...StyleSheet.absoluteFill },
  region: { position: 'absolute' },
  surface: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.color.onPhoto.chipBg,
    borderColor: t.color.onPhoto.primary,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    overflow: 'hidden',
  },
  surfaceActive: { borderWidth: t.size.border.focusRing },
  preview: { pointerEvents: 'none', position: 'absolute' },
  // The handle: a 14 dot centred on the bottom right corner inside a 44 target.
  handle: { bottom: -t.size.touchMin / 2, height: t.size.touchMin, position: 'absolute', right: -t.size.touchMin / 2, width: t.size.touchMin, alignItems: 'center', justifyContent: 'center' },
  handleVisual: {
    backgroundColor: t.color.onPhoto.primary,
    borderColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.focusRing,
    height: t.size.slider.thumb / 2,
    width: t.size.slider.thumb / 2,
  },
  // The turn handle: above the middle of the top edge, turning with the rectangle; the remove button's look with a turn glyph.
  turn: {
    alignItems: 'center',
    height: t.size.touchMin,
    justifyContent: 'center',
    left: '50%',
    transform: [{ translateX: -t.size.touchMin / 2 }],
    position: 'absolute',
    top: -(TURN_REACH + t.size.touchMin / 2),
    width: t.size.touchMin,
  },
  // Outside the top right corner, diagonally touching it: the button never covers the rectangle it removes.
  remove: { position: 'absolute', right: -t.size.slider.thumb, top: -t.size.slider.thumb },
  removeVisual: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    height: t.size.slider.thumb,
    justifyContent: 'center',
    width: t.size.slider.thumb,
  },
  photoHint: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
    pointerEvents: 'none',
    position: 'absolute',
  },
  photoHintAbove: { marginBottom: t.space[8] },
  photoHintBelow: { marginTop: t.space[8] },
  footer: { alignItems: 'flex-start', gap: t.space[8] },
  noteRow: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  noteText: { flex: 1 },
}));

/**
 * M5.9a shared plate blur editor (10 §16.1, ADR-509), the GAR-08 tool grown into the upload flows: the photo at its real ratio,
 * the switch (default on, upload mode), rectangles that move with a drag and resize from the corner handle, "+ Rechteck" up
 * to 8 and × per rectangle. Removing the last one switches the blur off, with "Rückgängig" in the toast. Screen readers get
 * move and size actions per rectangle; on the web the focused rectangle moves with the arrow keys (Shift five steps, Alt resizes:
 * GAR-08's map, DQ-P5G-17).
 * Client round: each rectangle also turns (−45° to +45°) for a plate shot at an angle, with the handle above its top edge, the
 * "Winkel" slider under the photo (the rectangle in hand, else the first) and "Nach links/rechts drehen" actions; the angle goes to
 * the API with the region (`angle`) and the server pixelates the turned rectangle. Every drag area is `touch-action: none` on the web.
 * Controlled: the parent keeps the choice per photo.
 */
export function PlateBlurEditor({ photo, value, onChange, mode = 'upload', disabled = false, testID }: PlateBlurEditorProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const { height: windowHeight } = useWindowDimensions();
  // A phone browser is touched like the app: the key hint is for a keyboard, from tablet width up.
  const { kind } = useBreakpoint();
  const keyHint = isWeb && kind !== 'phone';
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState(-1);
  const [touched, setTouched] = useState(false);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
  const maxHeight = Math.min(STAGE_MAX_HEIGHT, windowHeight * STAGE_WINDOW_SHARE);
  const placeholder = useImagePlaceholder(photo.blurhash, 'fill', photo.thumbhash);
  const upload = mode === 'upload';
  const shown = value.on || !upload;
  const first = value.regions[0];

  const change = (next: PlateBlurChoice) => {
    latest.current = { ...latest.current, value: next };
    latest.current.onChange(next);
  };

  const updateRegion = (index: number, region: BlurRegion) => {
    setTouched(true);
    change(replaceRegionIn(latest.current.value, index, region));
  };

  const remove = (index: number) => {
    const before = latest.current.value;
    const next = removeRegionFrom(before, index);
    setActive(-1);
    setTouched(true);
    change(next);
    if (upload && before.on && !next.on) {
      // The last rectangle went, and with it the blur: one tap brings both back.
      toast(t('plateBlur.offToast'), { undo: () => latest.current.onChange(before), testID: `${testID}.offToast` });
    } else {
      AccessibilityInfo.announceForAccessibility(t('plateBlur.removed', { number: index + 1 }));
    }
  };

  const add = () => {
    const current = latest.current.value;
    if (!canAdd(current)) {
      toast(t('plateBlur.full', { max: UPLOAD_MAX_REGIONS }), { testID: `${testID}.full` });
      return;
    }
    haptics.light();
    const next = addRegionTo(current);
    setActive(next.regions.length - 1);
    setTouched(true);
    change(next);
  };

  const onLayout = (event: LayoutChangeEvent) => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });

  const spokenAngle = (angle: number) =>
    angle === 0 ? t('plateBlur.angleStraight') : t(angle > 0 ? 'plateBlur.angleRight' : 'plateBlur.angleLeft', { count: Math.abs(angle) });
  const shownAngle = (angle: number) => t('plateBlur.angleValue', { value: `${angle < 0 ? '−' : angle > 0 ? '+' : ''}${Math.abs(angle)}` });
  const regionLabel = (region: BlurRegion, index: number) => {
    const angle = angleOf(region);
    const where = { number: index + 1, ...regionPercent(region) };
    return angle === 0 ? t('plateBlur.regionLabel', where) : t('plateBlur.regionLabelTurned', { ...where, angle: spokenAngle(angle) });
  };
  // The slider turns the rectangle in hand, else the first one.
  const angleIndex = active >= 0 && active < value.regions.length ? active : 0;
  const angleRegion = value.regions[angleIndex];
  const turnTo = (angle: number) => {
    const current = latest.current.value.regions[angleIndex];
    if (!current) return;
    setActive(angleIndex);
    updateRegion(angleIndex, turnRegion(current, angle));
  };
  const showPhotoHint = shown && !touched && value.regions.length === 1 && first !== undefined && !disabled;

  return (
    <View style={styles.root} testID={testID}>
      {upload ? (
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text variant="bodyStrong" aria-hidden>
              {t('plateBlur.switch')}
            </Text>
            <Text variant="caption" color="text.secondary">
              {value.on ? t('plateBlur.switchOn') : t('plateBlur.switchOff')}
            </Text>
          </View>
          <Switch
            value={value.on}
            onValueChange={(on) => {
              setTouched(true);
              change(setBlur(latest.current.value, on));
            }}
            label={t('plateBlur.switch')}
            disabled={disabled}
            testID={`${testID}.switch`}
          />
        </View>
      ) : null}
      <View
        onLayout={onLayout}
        style={[styles.stage, { aspectRatio: ratio, maxWidth: maxHeight * ratio }]}
        role="group"
        aria-label={t('plateBlur.stageLabel', { count: shown ? value.regions.length : 0 })}
        testID={`${testID}.stage`}
      >
        <Image
          source={{ uri: photo.uri }}
          {...placeholder}
          contentFit="fill"
          accessible={false}
          style={styles.photo}
          testID={`${testID}.photo`}
        />
        {shown && stage.width > 0
          ? value.regions.map((region, index) => (
              <RegionBox
                key={index}
                region={region}
                index={index}
                stage={stage}
                uri={photo.uri}
                active={index === active}
                disabled={disabled}
                describe={(next) => regionLabel(next, index)}
                onActivate={setActive}
                onChange={updateRegion}
                onRemove={remove}
                testID={`${testID}.region.${index}`}
              />
            ))
          : null}
        {showPhotoHint && first ? (
          <View
            style={[
              styles.photoHint,
              { left: `${first.x * 100}%` },
              first.y + first.h > HINT_ABOVE_FROM
                ? [styles.photoHintAbove, { bottom: `${(1 - first.y) * 100}%` }]
                : [styles.photoHintBelow, { top: `${(first.y + first.h) * 100}%` }],
            ]}
            aria-hidden
            testID={`${testID}.photoHint`}
          >
            <Text variant="caption" color="onPhoto.primary">
              {t('plateBlur.hint')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        {shown ? (
          <Text variant="caption" color="text.secondary" testID={`${testID}.hint`}>
            {value.regions.length === 0
              ? t('plateBlur.empty')
              : `${t('plateBlur.count', { count: value.regions.length, max: UPLOAD_MAX_REGIONS })} · ${keyHint ? t('plateBlur.keys') : t('plateBlur.gestures')}`}
          </Text>
        ) : null}
        {shown && angleRegion ? (
          <AngleSlider
            value={angleOf(angleRegion)}
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={ANGLE_STEP}
            onChange={turnTo}
            label={t('plateBlur.angleLabel', { number: angleIndex + 1 })}
            formatValue={shownAngle}
            formatSpoken={spokenAngle}
            disabled={disabled}
            testID={`${testID}.angle`}
          />
        ) : null}
        {shown ? (
          <Button
            label={t('plateBlur.add')}
            variant="tertiary"
            size="s"
            icon="plus"
            flush="start"
            disabled={disabled || !canAdd(value)}
            onPress={add}
            testID={`${testID}.add`}
          />
        ) : null}
      </View>
      <View style={styles.noteRow} testID={`${testID}.note`}>
        <Icon name="info" size={16} color="text.secondary" />
        <Text variant="caption" color="text.secondary" style={styles.noteText}>
          {upload ? t('plateBlur.note') : t('plateBlur.noteExisting')}
        </Text>
      </View>
    </View>
  );
}

type RegionBoxProps = {
  region: BlurRegion;
  index: number;
  stage: { width: number; height: number };
  uri: string;
  active: boolean;
  disabled: boolean;
  /** The accessible name of the rectangle at a place, size and angle. */
  describe: (region: BlurRegion) => string;
  onActivate: (index: number) => void;
  onChange: (index: number, region: BlurRegion) => void;
  onRemove: (index: number) => void;
  testID: string;
};

/**
 * One rectangle: the move area (the accessible element, the web's focus stop), the corner handle, the turn handle and the remove
 * button as siblings, so each has its own gesture and the topmost wins the touch. The whole box turns by the region's angle about its
 * centre; the blurred copy of the photo inside it turns back, so the preview stays in place. The server pixelates (ADR-509).
 * Drags are read from window coordinates (`absoluteX/Y`), which a turned view does not rotate on any platform.
 */
function RegionBox({ region, index, stage, uri, active, disabled, describe, onActivate, onChange, onRemove, testID }: RegionBoxProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const motion = useMotionPreference();
  const ring = useFocusRing('onPhoto');
  const start = useRef<{ region: BlurRegion; gesture: Gesture; pointer: Point; handle: Point; centre: Point } | null>(null);
  const label = describe(region);
  const latest = useRef(region);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    latest.current = region;
  });

  // A new rectangle fades in on effect.fast (feedback for "+ Rechteck"); the same under reduced motion, a crossfade.
  const shownValue = useSharedValue(0);
  useEffect(() => {
    shownValue.set(motion.effectTo(1, 'fast'));
  }, [motion, shownValue]);
  const fade = useAnimatedStyle(() => ({ opacity: shownValue.get() }));

  const grab = (gesture: Gesture, x: number, y: number) => {
    const from = latest.current;
    start.current = {
      region: from,
      gesture,
      pointer: { x, y },
      handle: turnHandlePoint(from, stage, TURN_REACH),
      centre: regionCentre(from, stage),
    };
    setHeld(true);
    onActivate(index);
  };
  const drag = (x: number, y: number) => {
    const from = start.current;
    if (!from || stage.width <= 0 || stage.height <= 0) return;
    const dx = x - from.pointer.x;
    const dy = y - from.pointer.y;
    if (from.gesture === 'move') onChange(index, moveRegion(from.region, dx / stage.width, dy / stage.height));
    else if (from.gesture === 'resize') onChange(index, resizeTurned(from.region, dx, dy, stage));
    else onChange(index, turnRegion(from.region, angleToward(from.centre, { x: from.handle.x + dx, y: from.handle.y + dy })));
  };
  const release = () => {
    const moved = start.current !== null && latest.current !== start.current.region;
    start.current = null;
    setHeld(false);
    if (moved) AccessibilityInfo.announceForAccessibility(label);
  };
  const pickUp = () => haptics.selection();

  const movePan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    // On the web RNGH re-applies the config on every render and drops the detector's `touchAction` (CR2-1, CarouselSnap); the box
    // re-renders on every step of a drag, so a finger on iPhone Safari scrolled the page instead of moving it.
    // @ts-expect-error -- touchAction is an allowed native prop of the pan handler (RNGH propsWhiteList) but not in PanGestureConfig
    touchAction: 'none',
    testID: `${testID}.pan`,
    onBegin: (event) => {
      'worklet';
      scheduleOnRN(grab, 'move', event.absoluteX, event.absoluteY);
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(pickUp);
    },
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(drag, event.absoluteX, event.absoluteY);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(release);
    },
  });
  const resizePan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    // On the web RNGH re-applies the config on every render and drops the detector's `touchAction` (CR2-1, CarouselSnap); the box
    // re-renders on every step of a drag, so a finger on iPhone Safari scrolled the page instead of moving it.
    // @ts-expect-error -- touchAction is an allowed native prop of the pan handler (RNGH propsWhiteList) but not in PanGestureConfig
    touchAction: 'none',
    testID: `${testID}.handlePan`,
    onBegin: (event) => {
      'worklet';
      scheduleOnRN(grab, 'resize', event.absoluteX, event.absoluteY);
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(pickUp);
    },
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(drag, event.absoluteX, event.absoluteY);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(release);
    },
  });

  const turnPan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    // @ts-expect-error -- touchAction is an allowed native prop of the pan handler (RNGH propsWhiteList) but not in PanGestureConfig
    touchAction: 'none',
    testID: `${testID}.turnPan`,
    onBegin: (event) => {
      'worklet';
      scheduleOnRN(grab, 'turn', event.absoluteX, event.absoluteY);
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(pickUp);
    },
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(drag, event.absoluteX, event.absoluteY);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(release);
    },
  });

  const step = (name: string) => {
    if (disabled || !ACTIONS.includes(name as ActionName)) return;
    const action = name as ActionName;
    const current = latest.current;
    const next =
      action === 'grow'
        ? scaleRegion(current, 1)
        : action === 'shrink'
          ? scaleRegion(current, -1)
          : action === 'turnLeft'
            ? turnRegion(current, angleOf(current) - ANGLE_ACTION_STEP)
            : action === 'turnRight'
              ? turnRegion(current, angleOf(current) + ANGLE_ACTION_STEP)
              : keyRegionFor(current, ACTION_KEYS[action]);
    onChange(index, next);
    AccessibilityInfo.announceForAccessibility(describe(next));
  };

  const onKeyDown = (event: {
    key?: string;
    nativeEvent?: { key?: string; shiftKey?: boolean; altKey?: boolean };
    shiftKey?: boolean;
    altKey?: boolean;
    preventDefault?: () => void;
  }) => {
    if (disabled) return;
    const key = keyOf(event);
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault?.();
      onRemove(index);
      return;
    }
    if (!isNudgeKey(key)) return;
    event.preventDefault?.();
    onChange(
      index,
      keyRegion(latest.current, key, {
        shift: Boolean(event.shiftKey ?? event.nativeEvent?.shiftKey),
        alt: Boolean(event.altKey ?? event.nativeEvent?.altKey),
      }),
    );
  };

  const box = {
    left: region.x * stage.width,
    top: region.y * stage.height,
    width: region.w * stage.width,
    height: region.h * stage.height,
  };
  const angle = angleOf(region);
  // The preview turns back about the box's centre (its offset from the photo's centre), so the blurred photo stays where it is.
  const pivotX = box.left + box.width / 2 - stage.width / 2;
  const pivotY = box.top + box.height / 2 - stage.height / 2;
  const turned = angle === 0 ? null : { transform: [{ rotate: `${angle}deg` }] };
  const turnedBack =
    angle === 0
      ? null
      : { transform: [{ translateX: pivotX }, { translateY: pivotY }, { rotate: `${-angle}deg` }, { translateX: -pivotX }, { translateY: -pivotY }] };

  return (
    <Animated.View style={[styles.region, box, turned, fade]} testID={testID}>
      <GestureDetector gesture={movePan} touchAction="none" userSelect="none">
        <View
          accessible
          role="button"
          aria-label={label}
          accessibilityHint={isWeb ? undefined : t('plateBlur.regionActions')}
          accessibilityActions={ACTIONS.map((name) => ({ name, label: t(`plateBlur.actions.${name}`) }))}
          onAccessibilityAction={(event: AccessibilityActionEvent) => step(event.nativeEvent.actionName)}
          aria-disabled={disabled || undefined}
          {...(isWeb ? ({ focusable: !disabled, onKeyDown, onFocus: ring.onFocus, onBlur: ring.onBlur } as object) : {})}
          style={[styles.surface, active || held ? styles.surfaceActive : null, ring.ringStyle]}
          testID={`${testID}.move`}
        >
          <Image
            source={{ uri }}
            blurRadius={PREVIEW_BLUR}
            contentFit="fill"
            accessible={false}
            style={[styles.preview, { left: -box.left, top: -box.top, width: stage.width, height: stage.height }, turnedBack]}
          />
        </View>
      </GestureDetector>
      {disabled ? null : (
        <>
          <GestureDetector gesture={resizePan} touchAction="none" userSelect="none">
            <View style={styles.handle} aria-hidden testID={`${testID}.handle`}>
              <View style={styles.handleVisual} />
            </View>
          </GestureDetector>
          <GestureDetector gesture={turnPan} touchAction="none" userSelect="none">
            <View style={styles.turn} aria-hidden testID={`${testID}.turn`}>
              <View style={styles.removeVisual}>
                <Icon name="arrow-clockwise" size={16} color="onPhoto.primary" />
              </View>
            </View>
          </GestureDetector>
          <PressableScale
            role="button"
            aria-label={t('plateBlur.remove', { number: index + 1 })}
            visualHeight={size.slider.thumb}
            visualWidth={size.slider.thumb}
            ring="onPhoto"
            onPress={() => onRemove(index)}
            style={styles.remove}
            contentStyle={styles.removeVisual}
            testID={`${testID}.remove`}
          >
            <Icon name="x" size={16} color="onPhoto.primary" />
          </PressableScale>
        </>
      )}
    </Animated.View>
  );
}

function keyRegionFor(region: BlurRegion, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): BlurRegion {
  return keyRegion(region, key);
}
