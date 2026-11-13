import { useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { View, type AccessibilityActionEvent, type KeyDownEvent } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles, size, space } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { Icon, type IconName } from '../icons/Icon';
import { Portal, usePortalAvailable } from '../portal';
import { PressableScale } from '../PressableScale';
import { useFocusRing } from '../useFocusRing';
import { hapticFor } from './haptics';
import { reactionIndexAt, reactionItemX, type Rect } from './math';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';

export type Reaction = { key: string; label: string; icon: IconName };

/**
 * The build reactions (09 §5, App. C): Stark · Sauber · Tief · Laut, drawn with the custom glyphs (tach at the redline, a
 * clean drop, a car sitting low, an exhaust with sound). Each has a fill variant for the chosen state. Labels come from the
 * caller's namespace; messages add Phosphor Heart.
 */
export const BUILD_REACTION_GLYPHS = { stark: 'strong', sauber: 'clean', tief: 'low', laut: 'loud' } as const satisfies Record<string, IconName>;
export type BuildReactionKey = keyof typeof BUILD_REACTION_GLYPHS;

const ITEM = size.touchMin;
const GAP = space[4];
const PAD = space[4];
/** The picker floats this far above the button. */
const LIFT = space[8];
const PICKER_HEIGHT = ITEM + PAD * 2;
/** The picker's top edge relative to the button's. */
const PICKER_Y = -(PICKER_HEIGHT + LIFT);
/** A finger may stray this far above or below the glyph row and still point at a glyph. */
const SLOP_Y = space[24];

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'flex-start' },
  button: { alignItems: 'center', borderRadius: t.radius.full, height: ITEM, justifyContent: 'center', width: ITEM },
  picker: {
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    gap: GAP,
    left: 0,
    padding: PAD - t.size.border.control,
    position: 'absolute',
    top: PICKER_Y,
    zIndex: t.zIndex.toast,
  },
  // In the root portal the picker is placed in window coordinates (left/top set inline).
  portaled: { top: undefined },
  item: { alignItems: 'center', borderRadius: t.radius.full, height: ITEM, justifyContent: 'center', width: ITEM },
  hovered: { backgroundColor: t.color.state.selected },
  flyer: { alignItems: 'center', height: ITEM, justifyContent: 'center', left: 0, position: 'absolute', top: 0, width: ITEM },
}));

export type ReactionPickerProps = {
  /** Stark · Sauber · Tief · Laut (custom glyphs, M4.4); messages add Heart. Labels from the caller's namespace. */
  reactions: readonly Reaction[];
  /** The member's reaction, or null. Counts are never shown here (owner-only, elsewhere). */
  selected: string | null;
  /** What a tap gives: the reaction the member used last. */
  lastUsed: string;
  onSelect: (key: string | null) => void;
  /** The button's name ("Reagieren"); the chosen reaction is added to it. */
  label: string;
  testID: string;
};

/**
 * SM9 reaction picker (09 §4.7): a tap gives the last-used reaction (a second tap takes it back); a long press opens the four
 * glyphs, which pop from 0.6 on spring.fast with stagger.s (medium haptic, the long-press menu of 09 §4.8). Dragging across
 * them selects with a selection haptic per glyph; lifting on one flies it into the button (spring.default) with a light
 * haptic; lifting elsewhere leaves the picker open for a tap. Screen readers: every reaction is an action of the button.
 * Keyboard (web): Enter/Space as the tap, Arrow up opens the picker and focuses its first glyph, Left/Right move between the
 * glyphs, Escape closes it and returns the focus to the button. The picker draws in the root portal where one is mounted
 * (FlightLayer), so a card or list cell cannot clip it.
 * Reduced motion: the picker crossfades, the glyph lands without the flight.
 */
export function ReactionPicker({ reactions, selected, lastUsed, onSelect, label, testID }: ReactionPickerProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const ring = useFocusRing();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(-1);
  const [flying, setFlying] = useState<number | null>(null);
  const reveal = useSharedValue(0);
  const flight = useSharedValue(1);
  const hover = useSharedValue(-1);
  const button = useRef<ComponentRef<typeof View>>(null);
  const items = useRef<(ComponentRef<typeof View> | null)[]>([]);
  /** Opened from the keyboard: closing hands the focus back to the button (web). */
  const byKeyboard = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== timer);
      run();
    }, ms);
    timers.current.push(timer);
  };
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    [],
  );
  const portal = usePortalAvailable();
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const count = reactions.length;
  const current = reactions.find((r) => r.key === selected);
  const tapReaction = reactions.find((r) => r.key === lastUsed) ?? reactions[0];

  useEffect(() => {
    if (open) {
      reveal.set(0);
      reveal.set(motion.reduced ? motion.effectTo(1, 'default') : motion.springTo(1, 'fast'));
      return undefined;
    }
    reveal.set(motion.effectTo(0, 'fast'));
    // The picker stays mounted while it fades out (an exit on effect.fast).
    const timer = setTimeout(() => setMounted(false), motionDuration('effect.fast'));
    return () => clearTimeout(timer);
  }, [motion, open, reveal]);

  const openPicker = (fromKeyboard = false) => {
    hapticFor('longPressMenu');
    byKeyboard.current = fromKeyboard;
    // Drawn in the root portal where there is one, so a card's overflow or a list cell cannot clip it.
    if (portal) {
      button.current?.measureInWindow((x, y, width, height) => setAnchor(width > 0 && height > 0 ? { x, y, width, height } : null));
    }
    setMounted(true);
    setOpen(true);
    if (fromKeyboard) later(() => items.current[0]?.focus?.(), 0);
  };
  const close = (returnFocus = byKeyboard.current) => {
    setOpen(false);
    setHovered(-1);
    hover.set(-1);
    byKeyboard.current = false;
    if (returnFocus && isWeb) later(() => button.current?.focus?.(), 0);
  };
  const focusItem = (index: number) => items.current[(index + count) % count]?.focus?.();
  const choose = (index: number) => {
    const reaction = reactions[index];
    if (!reaction) return;
    hapticFor('reactionChosen');
    close();
    if (!motion.reduced && motion.enabled) {
      setFlying(index);
      flight.set(0);
      flight.set(motion.springTo(1, 'default'));
      later(() => setFlying(null), motionDuration('spring.default'));
    }
    onSelect(reaction.key);
  };
  const tap = () => {
    if (open) {
      close();
      return;
    }
    if (selected) onSelect(null);
    else if (tapReaction) {
      hapticFor('reactionChosen');
      onSelect(tapReaction.key);
    }
  };
  const hoverTo = (index: number) => {
    setHovered(index);
    if (index >= 0) hapticFor('reactionDragOver');
  };

  const hold = usePanGesture({
    activateAfterLongPress: motionTokens.signature.reactionPicker.longPress,
    minDistance: 0,
    testID: `${testID}.hold`,
    onActivate: () => {
      'worklet';
      scheduleOnRN(openPicker, false);
    },
    onUpdate: (event) => {
      'worklet';
      const index = reactionIndexAt(event.x - PAD, event.y - PICKER_Y - PAD, count, ITEM, GAP, SLOP_Y);
      if (index !== hover.get()) {
        hover.set(index);
        scheduleOnRN(hoverTo, index);
      }
    },
    onDeactivate: () => {
      'worklet';
      const index = hover.get();
      if (index >= 0) scheduleOnRN(choose, index);
    },
  });
  const press = useTapGesture({
    testID: `${testID}.tap`,
    onActivate: () => {
      'worklet';
      scheduleOnRN(tap);
    },
  });
  const gesture = useExclusiveGestures(hold, press);

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === 'activate') tap();
    else {
      const index = reactions.findIndex((r) => r.key === name);
      if (index >= 0) choose(index);
    }
  };
  const onKeyDown = (event: KeyDownEvent) => {
    const key = event.nativeEvent.key;
    if (key === 'Enter' || key === ' ') {
      event.preventDefault?.();
      tap();
    } else if (key === 'ArrowUp') {
      event.preventDefault?.();
      openPicker(true);
    } else if (key === 'Escape' && open) close(true);
  };

  const flyerStyle = useAnimatedStyle(() => {
    const from = flying === null ? 0 : reactionItemX(flying, ITEM, GAP) + PAD;
    const p = flight.get();
    return { transform: [{ translateX: from * (1 - p) }, { translateY: (PICKER_Y + PAD) * (1 - p) }] };
  });
  const flyer = flying === null ? null : reactions[flying];
  const buttonIcon = current?.icon ?? tapReaction?.icon ?? 'star';

  return (
    <View style={styles.root} testID={testID}>
      <GestureDetector gesture={gesture} userSelect="none">
        <Animated.View
          ref={button}
          accessible
          role="button"
          aria-label={current ? `${label}: ${current.label}` : label}
          aria-pressed={current !== undefined}
          aria-expanded={open}
          accessibilityActions={[{ name: 'activate' }, ...reactions.map((r) => ({ name: r.key, label: r.label }))]}
          onAccessibilityAction={onAccessibilityAction}
          {...(isWeb ? { tabIndex: 0 as const, onKeyDown, onFocus: ring.onFocus, onBlur: ring.onBlur } : {})}
          style={[styles.button, ring.ringStyle]}
          testID={`${testID}.button`}
        >
          {flyer ? null : <Icon name={buttonIcon} size={24} weight={current ? 'fill' : 'regular'} color={current ? 'text.primary' : 'text.secondary'} />}
        </Animated.View>
      </GestureDetector>
      {flyer ? (
        <Animated.View aria-hidden style={[styles.flyer, flyerStyle]}>
          <Icon name={flyer.icon} size={24} weight="fill" />
        </Animated.View>
      ) : null}
      {mounted && !(portal && anchor) ? picker() : null}
      {mounted && portal && anchor ? <Portal>{(origin) => picker({ left: anchor.x - origin.x, top: anchor.y - origin.y + PICKER_Y })}</Portal> : null}
    </View>
  );

  function picker(at?: { left: number; top: number }) {
    return (
      <Animated.View
        role="menu"
        aria-label={label}
        aria-orientation="horizontal"
        style={[styles.picker, at ? [styles.portaled, at] : null]}
        testID={`${testID}.picker`}
      >
        {reactions.map((reaction, index) => (
          <PickerItem
            key={reaction.key}
            reaction={reaction}
            index={index}
            reveal={reveal}
            reduced={motion.reduced}
            hovered={hovered === index}
            onPress={() => choose(index)}
            onKey={(key) => {
              if (key === 'Escape') close(true);
              else if (key === 'ArrowRight') focusItem(index + 1);
              else if (key === 'ArrowLeft') focusItem(index - 1);
              else if (key === 'Home') focusItem(0);
              else if (key === 'End') focusItem(count - 1);
            }}
            ref={(node) => {
              items.current[index] = node;
            }}
            testID={`${testID}.item.${reaction.key}`}
          />
        ))}
      </Animated.View>
    );
  }
}

type PickerItemProps = {
  reaction: Reaction;
  index: number;
  reveal: SharedValue<number>;
  reduced: boolean;
  hovered: boolean;
  onPress: () => void;
  /** Escape closes; Left/Right (Home/End) move between the glyphs (a horizontal menu). */
  onKey: (key: string) => void;
  ref?: Ref<ComponentRef<typeof View>>;
  testID: string;
};

function PickerItem({ reaction, index, reveal, reduced, hovered, onPress, onKey, ref, testID }: PickerItemProps) {
  const styles = useStyles();
  const pop = useSharedValue(reduced ? 1 : motionTokens.signature.reactionPicker.fromScale);
  const motion = useMotionPreference();
  useEffect(() => {
    if (reduced) return;
    // stagger.s per glyph: a small group at a brand moment (09 §4.7), never a list.
    pop.set(withDelay(index * motionTokens.stagger.s, motion.springTo(1, 'fast')));
  }, [index, motion, pop, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: reveal.get(), transform: [{ scale: pop.get() }] }));
  return (
    <Animated.View style={style}>
      <PressableScale
        ref={ref}
        role="menuitem"
        aria-label={reaction.label}
        onPress={onPress}
        onKeyDown={(event: KeyDownEvent) => {
          const key = event.nativeEvent.key;
          if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') event.preventDefault?.();
          onKey(key);
        }}
        contentStyle={[styles.item, hovered ? styles.hovered : null]}
        testID={testID}
      >
        <Icon name={reaction.icon} size={24} weight={hovered ? 'fill' : 'regular'} />
      </PressableScale>
    </Animated.View>
  );
}
