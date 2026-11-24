import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle } from 'react-native';

import type { VehicleMedia } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { createStyles, radius, space } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import { Photo, type PhotoAspect } from '@/ui/Photo';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';

import { photoFields } from '../media';
import { STAGE_EMPTY_PHOTO } from '../stage';

export type ProfileHeroHandle = {
  /** Scrolls the pager to a photo: the desktop thumbnails (animated), the open viewer underneath it (`animated: false`, R5-2d). */
  show: (index: number, options?: { animated?: boolean }) => void;
};

export type ProfileHeroProps = {
  /** Photos with a file, in the owner's order. */
  photos: readonly VehicleMedia[];
  /** The hero's width in points: the pager pages by it. */
  width: number;
  /** `none` edge to edge on a phone, `md` (12) in the tablet and desktop columns. */
  corner: 'none' | 'md';
  /** "Nissan Skyline GT-R R34", the alt text of a photo without its own. */
  vehicleTitle: string;
  onOpen: (index: number) => void;
  onIndexChange?: (index: number) => void;
  /** Width / height: 4:5 edge to edge on a phone (09 §7.6), 16:9 across the content from 768 (DQ-1048). */
  ratio?: number;
  /** The photo's aspect token, matching `ratio`. */
  aspect?: PhotoAspect;
  /**
   * DQ-1047: the photo fades into the dark stage (`scrim.photo`) and the identity sits over its bottom; the counter then rides
   * this far above the bottom edge (the text-safe line + 8) instead of 12.
   */
  identityOverlap?: number;
  /** `<routeId>.hero`, `.photoCount`, `.heroEmpty`, `.hero.<n>`. */
  routeId: string;
  ref?: Ref<ProfileHeroHandle>;
};

/** Slides this far from the current one stay mounted, so a swipe never shows a blank page. */
const WINDOW = 1;
/** CF-5: a press within this long after the pager moved was the end of a swipe, not a tap on the photo. */
const SWIPE_PRESS_GUARD_MS = 350;
/** Web: a mouse moves this far before a press turns into a drag (below it, it stays a click that opens the viewer). */
const DRAG_SLOP = space[8];
/** Web: a drag of this share of a page goes on to the next photo; less snaps back to the photo it started on. */
const DRAG_PAGE_SHARE = 0.2;
/** Web: a flick faster than this (px per ms at the release) goes on to the next photo however short it was. */
const FLICK_SPEED = 0.5;

/** Milliseconds since a moment (`Date.now()` based), for the press guard; read in event handlers only. */
function msSince(at: number): number {
  return Date.now() - at;
}

/** Now, for the press guard; read in event handlers only. */
function nowMs(): number {
  return Date.now();
}

type PagerNode = {
  scrollLeft: number;
  style: { scrollSnapType: string };
  /**
   * The DOM's own `scroll`. Not `scrollTo`: react-native-web replaces the host node's `scrollTo` with its React Native signature
   * (`{ x, y, animated }`), which read `{ left }` as x 0 and glided every drag back to the first photo (CF-5 root cause).
   */
  scroll: (options: { left: number; behavior: 'auto' | 'smooth' }) => void;
  addEventListener: (type: string, listener: (event: never) => void, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: (event: never) => void, options?: boolean | EventListenerOptions) => void;
  setPointerCapture?: (id: number) => void;
};

function isPagerNode(value: unknown): value is PagerNode {
  return typeof value === 'object' && value !== null && 'scrollLeft' in value && 'addEventListener' in value;
}
const HERO_RATIO = 4 / 3;

/**
 * R5-2d (web): react-native-web pages the pager with CSS scroll snap, whose default `scroll-snap-stop: normal` lets a fling fly past
 * photos (a 300 px flick went from 1/3 to 3/3 on Android Chrome). `always` stops it at the next photo, one photo per swipe as on
 * native `pagingEnabled`. Each slide is its own snap area for that (the wrapper react-native-web puts around it aligns too).
 */
const webSlideSnap = isWeb ? ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as unknown as ViewStyle) : null;

const useStyles = createStyles((t) => ({
  hero: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  pager: { flex: 1 },
  slide: { overflow: 'hidden' },
  // The counter of FS-3 and WEB-01: onPhoto chip, radius 4, 8 × 4 padding, 12 from the bottom right corner.
  counter: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    bottom: t.space[12],
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[4],
    pointerEvents: 'none',
    position: 'absolute',
    right: t.space[12],
  },
  counterText: { fontVariant: ['tabular-nums'] },
}));

/**
 * FS-3 hero: edge-to-edge pager (4:5 on a phone, 4:3 in the columns) with the counter "1/12" bottom right. Each photo opens the viewer. Without photos the
 * same box holds WEB-01's empty stage photo under the scrim (DQ-1211), so nothing below moves when the first photo arrives.
 */
export function ProfileHero({ photos, width, corner, vehicleTitle, onOpen, onIndexChange, ratio = HERO_RATIO, aspect = '4:3', identityOverlap, routeId, ref }: ProfileHeroProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const motion = useMotionPreference();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const height = width / ratio;
  const box = useMemo(
    () => ({ width, height, borderRadius: corner === 'none' ? 0 : radius[corner] }),
    [corner, height, width],
  );
  const slideBox = useMemo(() => ({ width, height }), [height, width]);

  const settle = (next: number) => {
    const clamped = Math.min(count - 1, Math.max(0, next));
    if (clamped === index) return;
    setIndex(clamped);
    onIndexChange?.(clamped);
  };

  useImperativeHandle(
    ref,
    () => ({
      show: (next: number, options?: { animated?: boolean }) => {
        scroller.current?.scrollTo({ x: next * width, animated: (options?.animated ?? true) && motion.enabled && !motion.reduced });
        settle(next);
      },
    }),
  );

  // CF-5: when a drag of the pager last ended (a finger on native, the mouse on web), so the press that ends a swipe never opens the
  // viewer. Paging by wheel, trackpad or keys sets nothing: a click a moment later is a real one.
  const movedAt = useRef(0);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) settle(Math.round(event.nativeEvent.contentOffset.x / width));
  };
  const onDragEnd = () => {
    movedAt.current = nowMs();
  };
  const open = (position: number) => {
    if (msSince(movedAt.current) < SWIPE_PRESS_GUARD_MS) return;
    onOpen(position);
  };

  // CF-5 (web): the browser pages the scroller for touch, trackpad and wheel (CSS scroll snap); a mouse cannot drag it on its own. A
  // mouse drag pages it like a swipe (snap off while dragging, then the nearest or the next page), the click that ends a drag is
  // swallowed, and ← → page it while it has focus.
  const page = useRef(index);
  useEffect(() => {
    page.current = index;
  }, [index]);
  useEffect(() => {
    if (!isWeb || count < 2 || width <= 0) return;
    const node: unknown = scroller.current?.getScrollableNode?.();
    if (!isPagerNode(node)) return;
    const behavior = motion.enabled && !motion.reduced ? 'smooth' : 'auto';
    const goTo = (next: number) => node.scroll({ left: Math.min(count - 1, Math.max(0, next)) * width, behavior });
    let drag: { x: number; left: number; moved: boolean; lastX: number; lastAt: number; speed: number } | null = null;
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    const snapBack = () => {
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = null;
      node.removeEventListener('scrollend', snapBack);
      node.style.scrollSnapType = '';
    };
    const restoreSnap = () => {
      node.addEventListener('scrollend', snapBack);
      // Browsers without `scrollend`: after the glide's settle time.
      snapTimer = setTimeout(snapBack, motionDuration('spring.slow'));
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { x: event.clientX, left: node.scrollLeft, moved: false, lastX: event.clientX, lastAt: event.timeStamp, speed: 0 };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < DRAG_SLOP) return;
        drag.moved = true;
        node.style.scrollSnapType = 'none';
        node.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      node.scrollLeft = drag.left - dx;
      const elapsed = event.timeStamp - drag.lastAt;
      if (elapsed > 0) drag.speed = (event.clientX - drag.lastX) / elapsed;
      drag.lastX = event.clientX;
      drag.lastAt = event.timeStamp;
    };
    const up = (event: PointerEvent) => {
      const ended = drag;
      drag = null;
      if (!ended?.moved) return;
      movedAt.current = nowMs();
      // The photo the drag started on; a drag past a fifth of the page, or a flick, goes one photo on in its direction.
      const dx = event.clientX - ended.x;
      const from = Math.round(ended.left / width);
      const flick = Math.abs(ended.speed) > FLICK_SPEED && Math.sign(ended.speed) === Math.sign(dx);
      goTo(Math.abs(dx) > width * DRAG_PAGE_SHARE || flick ? from + (dx < 0 ? 1 : -1) : from);
      // Snap comes back once the pager has arrived on its page: restored at once, the browser re-snapped from where the drag let go and
      // cut the glide short.
      restoreSnap();
    };
    const click = (event: MouseEvent) => {
      if (msSince(movedAt.current) < SWIPE_PRESS_GUARD_MS && !drag) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    // The browser's own image drag (a ghost photo) would take the pointer away mid-swipe and leave the pager half moved.
    const noImageDrag = (event: DragEvent) => event.preventDefault();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      goTo(page.current + (event.key === 'ArrowRight' ? 1 : -1));
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('click', click, true);
    node.addEventListener('keydown', key);
    node.addEventListener('dragstart', noImageDrag);
    return () => {
      snapBack();
      node.removeEventListener('dragstart', noImageDrag);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('click', click, true);
      node.removeEventListener('keydown', key);
    };
  }, [count, motion, width]);

  if (count === 0) {
    // DQ-1211 (WEB-01 parity, DQ-1168): the empty stage photo under the same scrim, so the identity sits on it as on a build with
    // photos; the line "Noch keine Fotos." is the summary's. Decorative: it shows no car, the name says whose page it is.
    return (
      <View dataSet={{ qaExempt: 'photo' }} style={[styles.hero, box]} testID={`${routeId}.hero`}>
        <Photo {...STAGE_EMPTY_PHOTO} aspect={aspect} style={slideBox} testID={`${routeId}.stagePhoto`} />
        <PhotoStageScrim />
      </View>
    );
  }

  return (
    <View dataSet={{ qaExempt: 'photo' }} style={[styles.hero, box]} testID={`${routeId}.hero`}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollEndDrag={onDragEnd}
        style={styles.pager}
        aria-label={t('hero.galleryLabel', { title: vehicleTitle })}
      >
        {photos.map((photo, position) => (
          <View key={photo.id} style={[styles.slide, slideBox, webSlideSnap]}>
            {Math.abs(position - index) > WINDOW ? null : (
              <PressableScale
                role="button"
                aria-label={t('hero.open', { alt: photo.alt || vehicleTitle, current: position + 1, total: count })}
                feedback={false}
                ring="inset"
                onPress={() => open(position)}
                testID={`${routeId}.hero.${position}`}
                style={slideBox}
              >
                {/* The cover is the profile's first paint (LCP): it loads first, the other slides as they come into view. */}
                <Photo {...photoFields(photo, width)} aspect={aspect} priority={position === 0 ? 'high' : undefined} style={slideBox} />
              </PressableScale>
            )}
          </View>
        ))}
      </ScrollView>
      {identityOverlap !== undefined ? <PhotoStageScrim /> : null}
      {count > 1 ? (
        <View style={[styles.counter, identityOverlap !== undefined ? { bottom: identityOverlap + space[8] } : null]} testID={`${routeId}.photoCount`}>
          <Text variant="caption" color="onPhoto.primary" selectable={false} hyphenate={false} style={styles.counterText}>
            {`${index + 1}/${count}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
