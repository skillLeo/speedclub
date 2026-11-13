import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';

import { createStyles } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { Icon } from '../icons/Icon';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { hapticFor } from './haptics';
import { lerp } from './math';
import { useMotionPreference } from './preference';
import { Wipe } from './Wipe';

const useStyles = createStyles((t) => ({
  target: { alignSelf: 'flex-start', minHeight: t.size.button.m, minWidth: t.size.touchMin },
  targetFull: { alignSelf: 'stretch' },
  // No fixed height: at 200 % font the label grows the button (the in-flow sizer below gives the height).
  visual: { alignItems: 'center', justifyContent: 'center', minHeight: t.size.button.m },
  fill: { ...StyleSheet.absoluteFill, borderRadius: t.radius.sm },
  follow: { backgroundColor: t.color.bg.inverse },
  following: { backgroundColor: t.color.bg.raised, borderColor: t.color.border.default, borderWidth: t.size.border.control },
  label: { alignItems: 'center', bottom: 0, flexDirection: 'row', gap: t.space[4], justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  // DQ-1060: the vertical padding of Button M, so at 200 % the label keeps 8 to the edges as the tonal buttons beside it do.
  sizer: { flexDirection: 'row', gap: t.space[4], opacity: 0, paddingHorizontal: t.size.buttonPaddingX.m, paddingVertical: t.space[8], pointerEvents: 'none' },
  measure: { height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' },
  measureRow: { alignSelf: 'flex-start', flexDirection: 'row', gap: t.space[4], paddingHorizontal: t.size.buttonPaddingX.m },
  save: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  layer: { position: 'absolute' },
}));

export type FollowButtonProps = {
  following: boolean;
  /** Toggles; the caller updates optimistically and reverts with a toast on failure. */
  onToggle: () => void;
  /** "Folgen" / "Folge ich" from the caller's namespace. */
  followLabel: string;
  followingLabel: string;
  disabled?: boolean;
  /** The member or item the button belongs to: a recycled list cell that shows another one resets without the morph. */
  itemKey?: string;
  /**
   * As wide as its parent (VEH-01's action row, M4.9): the fill keeps the full width and the labels crossfade; the width
   * morph only exists for a button that hugs its label.
   */
  fullWidth?: boolean;
  testID?: string;
};

/**
 * Animate only a real toggle: the first run (mount), a recycled cell (`itemKey` changed) and a preference flip set the end
 * state at once, so lists never pop or morph on mount.
 */
function useToggleRun(on: boolean, itemKey: string | undefined): (run: { animate: () => void; jump: () => void }) => void {
  const last = useRef<{ on: boolean; itemKey: string | undefined } | null>(null);
  return ({ animate, jump }) => {
    const before = last.current;
    last.current = { on, itemKey };
    if (before === null || before.itemKey !== itemKey || before.on === on) jump();
    else animate();
  };
}

/**
 * SM8 follow morph (09 §4.7): "Folgen" → "Folge ich". The pill changes width on spring.fast, the labels crossfade
 * (effect.default) and the check draws itself left → right (a mask wipe, effect.default); a light haptic per toggle (09 §4.8).
 * The width is a scale of the fill inside a box as wide as the longer label, so nothing around it moves (transform only).
 * Reduced motion: the width and labels crossfade, the check is simply there.
 */
export function FollowButton({ following, onToggle, followLabel, followingLabel, disabled, itemKey, fullWidth = false, testID }: FollowButtonProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [widths, setWidths] = useState({ follow: 0, following: 0 });
  const state = useSharedValue(following ? 1 : 0);
  const fade = useSharedValue(following ? 1 : 0);
  const check = useSharedValue(following ? 1 : 0);
  const max = Math.max(widths.follow, widths.following);
  const run = useToggleRun(following, itemKey);

  useEffect(() => {
    const to = following ? 1 : 0;
    run({
      jump: () => {
        state.set(to);
        fade.set(to);
        check.set(to);
      },
      animate: () => {
        state.set(motion.springTo(to, 'fast'));
        fade.set(motion.effectTo(to, 'default'));
        if (!following) check.set(0);
        else check.set(motion.reduced ? 1 : motion.effectTo(1, 'default'));
      },
    });
    // `run` compares with the previous run itself; it is a new function every render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, fade, following, itemKey, motion, state]);

  const fillStyle = useAnimatedStyle(() => {
    if (max === 0 || fullWidth) return {};
    const width = lerp(widths.follow, widths.following, state.get());
    return { transform: [{ scaleX: width / max }] };
  });
  const followFill = useAnimatedStyle(() => ({ opacity: 1 - fade.get() }));
  const followingFill = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const followLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.get() }));
  const followingLabelStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  const measure = (key: 'follow' | 'following') => (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setWidths((w) => (w[key] === width ? w : { ...w, [key]: width }));
  };

  return (
    <PressableScale
      role="button"
      aria-pressed={following}
      // A toggle keeps its name; the state is aria-pressed (a name that changes with it would announce the state twice).
      aria-label={followLabel}
      disabled={disabled}
      toneShift={false}
      onPress={() => {
        hapticFor('follow');
        onToggle();
      }}
      style={fullWidth ? [styles.target, styles.targetFull] : styles.target}
      contentStyle={styles.visual}
      testID={testID}
    >
      {/* The two labels at their natural width, in flow but 0 high: they give the button the longer one's width. */}
      <View aria-hidden style={styles.measure}>
        <View style={styles.measureRow} onLayout={measure('follow')}>
          <Text variant="bodyStrong" hyphenate={false} selectable={false}>
            {followLabel}
          </Text>
        </View>
        <View style={styles.measureRow} onLayout={measure('following')}>
          <Icon name="check" size={16} />
          <Text variant="bodyStrong" hyphenate={false} selectable={false}>
            {followingLabel}
          </Text>
        </View>
      </View>
      {/* In flow and invisible: the height of the taller label, so a large font grows the button instead of clipping. */}
      <View aria-hidden style={styles.sizer}>
        <Icon name="check" size={16} />
        <Text variant="bodyStrong" hyphenate={false} selectable={false}>
          {followingLabel}
        </Text>
      </View>
      <Animated.View style={[styles.fill, fillStyle]}>
        <Animated.View style={[styles.fill, styles.follow, followFill]} />
        <Animated.View style={[styles.fill, styles.following, followingFill]} />
      </Animated.View>
      <Animated.View style={[styles.label, followLabelStyle]}>
        <Text variant="bodyStrong" color="text.inverse" hyphenate={false} selectable={false}>
          {followLabel}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.label, followingLabelStyle]} testID={testID ? `${testID}.followingLabel` : undefined}>
        <Wipe progress={check}>
          <Icon name="check" size={16} color="text.primary" />
        </Wipe>
        <Text variant="bodyStrong" hyphenate={false} selectable={false}>
          {followingLabel}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

export type SaveToggleProps = {
  saved: boolean;
  onToggle: () => void;
  /** "Speichern": the stable accessible name; the state is `aria-pressed`. */
  saveLabel: string;
  /** "Gespeichert": kept for callers; the name no longer changes with the state (review M4.3 #19). */
  savedLabel?: string;
  tone?: 'default' | 'onPhoto';
  /** As FollowButton's: a recycled cell for another item resets without the pop. */
  itemKey?: string;
  testID?: string;
};

/**
 * SM8 save: the bookmark fills with a pop 1.0 → 1.12 → 1.0 (spring.fast) and a light haptic. Reduced motion: the outline and
 * the fill crossfade without the pop.
 */
export function SaveToggle({ saved, onToggle, saveLabel, tone = 'default', itemKey, testID }: SaveToggleProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const fill = useSharedValue(saved ? 1 : 0);
  const pop = useSharedValue(1);
  const run = useToggleRun(saved, itemKey);

  useEffect(() => {
    run({
      jump: () => {
        fill.set(saved ? 1 : 0);
        pop.set(1);
      },
      animate: () => {
        fill.set(motion.effectTo(saved ? 1 : 0, 'fast'));
        if (saved && !motion.reduced && motion.enabled) {
          pop.set(withSequence(motion.springTo(motionTokens.signature.follow.bookmarkPop, 'fast'), motion.springTo(1, 'fast')));
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, itemKey, motion, pop, saved]);

  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: interpolate(fill.get(), [0, 1], [1, 0]) }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));
  const colour = tone === 'onPhoto' ? 'onPhoto.primary' : 'text.primary';

  return (
    <PressableScale
      role="button"
      aria-pressed={saved}
      // Stable name, state in aria-pressed (see FollowButton).
      aria-label={saveLabel}
      onPress={() => {
        hapticFor('save');
        onToggle();
      }}
      contentStyle={styles.save}
      testID={testID}
    >
      <Animated.View style={glyphStyle}>
        <View>
          <Animated.View style={outlineStyle}>
            <Icon name="bookmark-simple" size={24} color={colour} />
          </Animated.View>
          <Animated.View style={[styles.layer, fillStyle]}>
            <Icon name="bookmark-simple" size={24} weight="fill" color={colour} />
          </Animated.View>
        </View>
      </Animated.View>
    </PressableScale>
  );
}
