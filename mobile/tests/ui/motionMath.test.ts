import { readFileSync } from 'node:fs';
import path from 'node:path';

import { motion } from '@/theme';
import {
  carouselNeighbour,
  commitThreshold,
  coverCounterScale,
  coveringRadius,
  crossed,
  digitOffset,
  dividerPosition,
  flightAt,
  flightRadius,
  flightTransform,
  heroHeaderFade,
  indicatorEdges,
  moveItem,
  odometerCells,
  pagerParallax,
  reactionIndexAt,
  reactionItemX,
  reorderShift,
  reorderTarget,
  rubberBand,
  shouldDismiss,
  snapIndex,
  stretchyHero,
  swipeOffset,
  swipeSettle,
  wipeOffsets,
} from '@/ui/motion';

const SIG = motion.signature;

describe('motion tokens (09 §4.7, M4.3)', () => {
  it('carries every signature value the kit reads', () => {
    expect(motion.press.scale).toBe(0.97);
    expect(SIG.stretchyHero).toEqual({ maxScale: 1.15, parallax: 0.5 });
    expect(SIG.heroExpand).toEqual({ radiusFrom: 12, radiusTo: 0 });
    expect(SIG.follow.bookmarkPop).toBe(1.12);
    expect(SIG.reactionPicker.fromScale).toBe(0.6);
    expect(SIG.qrReveal.fromScale).toBe(0.92);
    expect(SIG.carousel).toMatchObject({ neighbourScale: 0.94, neighbourOpacity: 0.7, reorderScale: 0.9 });
    expect(SIG.mapPin.selectedScale).toBe(1.2);
    expect(SIG.liveCountDebounce).toBe(250);
    expect(SIG.toast).toMatchObject({ slide: 12, autoDismiss: 5000 });
    expect(SIG.onboardingParallax).toBe(0.3);
    expect(motion.stagger).toMatchObject({ s: 30, m: 60 });
  });

  it('gives the web the same values as CSS custom properties, and the reduced-motion swap', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../web/resources/css/tokens.generated.css'), 'utf8');
    expect(css).toContain('--sc-motion-press-scale: 0.97;');
    expect(css).toContain('--sc-motion-qr-reveal-from-scale: 0.92;');
    expect(css).toContain('--sc-motion-toast-auto-dismiss: 5000ms;');
    expect(css).toContain('--sc-motion-hero-expand-radius-from: 12px;');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const token of Object.keys(motion.spring)) {
      expect(reduced).toContain(`--sc-spring-${token}-easing: var(--sc-effect-default-easing);`);
      expect(reduced).toContain(`--sc-spring-${token}-duration: var(--sc-effect-default-duration);`);
    }
    const tw = readFileSync(path.resolve(__dirname, '../../../web/resources/css/tailwind-theme.generated.css'), 'utf8');
    expect(tw).toContain('@utility motion-spring-fast {');
    expect(tw).toContain('@utility press-scale {');
    const admin = readFileSync(path.resolve(__dirname, '../../../web/resources/css/tailwind-admin-theme.generated.css'), 'utf8');
    // The admin has effects only (09 §10.2).
    expect(admin).toContain('@utility motion-effect-fast {');
    expect(admin).not.toContain('@utility motion-spring');
  });
});

describe('mask wipe (SM1, SM8, SM13, SM17)', () => {
  it('hides everything at 0 and nothing at 1, with the content held still', () => {
    expect(wipeOffsets(0, 200, 'start')).toEqual({ outer: -200, inner: 200 });
    expect(wipeOffsets(1, 200, 'start')).toEqual({ outer: -0, inner: 0 });
    expect(wipeOffsets(0.25, 200, 'start')).toEqual({ outer: -150, inner: 150 });
    expect(wipeOffsets(0.25, 200, 'end')).toEqual({ outer: 150, inner: -150 });
    // Overshoot of a spring never uncovers more than the box.
    expect(wipeOffsets(1.2, 200, 'start').outer).toBeCloseTo(0);
  });
});

describe('swipe actions (SM11) and toast swipe (SM20)', () => {
  const W = 360;
  const ACTIONS = 144;
  const rules = { commitRatio: SIG.swipeActions.commitRatio, flingVelocity: SIG.swipeActions.flingVelocity, fullSwipe: true };

  it('rubber-bands past an edge, ever slower, never past the dimension', () => {
    expect(rubberBand(0, W, 0.55)).toBe(0);
    const a = rubberBand(50, W, 0.55);
    const b = rubberBand(100, W, 0.55);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(a);
    expect(rubberBand(1e6, W, 0.55)).toBeLessThan(W);
  });

  it('follows the finger between closed and open and resists beyond', () => {
    expect(swipeOffset(0, -100, ACTIONS, W, 0.55)).toBe(-100);
    expect(swipeOffset(0, 40, ACTIONS, W, 0.55)).toBeLessThan(40);
    expect(swipeOffset(0, -200, ACTIONS, W, 0.55)).toBeGreaterThan(-200);
    expect(swipeOffset(0, -200, ACTIONS, W, 0.55)).toBeLessThan(-ACTIONS);
    expect(swipeOffset(-ACTIONS, 44, ACTIONS, W, 0.55)).toBe(-100);
  });

  it('settles closed, open or committed', () => {
    expect(swipeSettle(-60, 0, ACTIONS, W, rules)).toBe('closed');
    expect(swipeSettle(-80, 0, ACTIONS, W, rules)).toBe('open');
    expect(swipeSettle(-30, -900, ACTIONS, W, rules)).toBe('open');
    expect(swipeSettle(-120, 900, ACTIONS, W, rules)).toBe('closed');
    expect(swipeSettle(-W * 0.6, 0, ACTIONS, W, rules)).toBe('commit');
    expect(swipeSettle(-W * 0.6, 0, ACTIONS, W, { ...rules, fullSwipe: false })).toBe('open');
    expect(commitThreshold(W, 0.6)).toBeCloseTo(-216);
  });

  it('crosses a threshold once per direction (one haptic, never per frame)', () => {
    expect(crossed(-100, -150, -144)).toBe(true);
    expect(crossed(-150, -160, -144)).toBe(false);
    expect(crossed(-150, -100, -144)).toBe(true);
  });

  it('dismisses a toast past 35 % or on a fling the same way', () => {
    expect(shouldDismiss(120, 0, 300, SIG.toast.swipeDismissRatio, 600)).toBe(true);
    expect(shouldDismiss(60, 0, 300, SIG.toast.swipeDismissRatio, 600)).toBe(false);
    expect(shouldDismiss(30, 900, 300, SIG.toast.swipeDismissRatio, 600)).toBe(true);
    expect(shouldDismiss(30, -900, 300, SIG.toast.swipeDismissRatio, 600)).toBe(false);
    expect(shouldDismiss(500, 0, 0, SIG.toast.swipeDismissRatio, 600)).toBe(false);
  });
});

describe('odometer (SM6, SM18)', () => {
  it('rolls each digit in its column and keeps separators and units', () => {
    expect(odometerCells('000', '510')).toEqual([
      { kind: 'digit', key: 'p2', from: 0, to: 5 },
      { kind: 'digit', key: 'p1', from: 0, to: 1 },
      { kind: 'digit', key: 'p0', from: 0, to: 0 },
    ]);
    expect(odometerCells('0,0', '3,9')).toEqual([
      { kind: 'digit', key: 'p2', from: 0, to: 3 },
      { kind: 'static', key: 'p1', char: ',' },
      { kind: 'digit', key: 'p0', from: 0, to: 9 },
    ]);
  });

  it('aligns from the right when the number grows, new digits roll from 0', () => {
    const cells = odometerCells('128', '1.024');
    expect(cells.map((c) => c.key)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
    expect(cells[0]).toEqual({ kind: 'digit', key: 'p4', from: 0, to: 1 });
    expect(cells[1]).toEqual({ kind: 'static', key: 'p3', char: '.' });
    expect(cells[2]).toEqual({ kind: 'digit', key: 'p2', from: 1, to: 0 });
    expect(cells[4]).toEqual({ kind: 'digit', key: 'p0', from: 8, to: 4 });
  });

  it('moves the column one line per digit', () => {
    expect(digitOffset(0, 40)).toBe(-0);
    expect(digitOffset(7, 40)).toBe(-280);
  });
});

describe('carousel and reorder (SM16)', () => {
  it('scales and dims the neighbours from the scroll position', () => {
    expect(carouselNeighbour(0, 0, 250, 0.94, 0.7, false)).toEqual({ scale: 1, opacity: 1 });
    expect(carouselNeighbour(0, 1, 250, 0.94, 0.7, false)).toEqual({ scale: 0.94, opacity: 0.7 });
    const half = carouselNeighbour(125, 1, 250, 0.94, 0.7, false);
    expect(half.scale).toBeCloseTo(0.97);
    expect(half.opacity).toBeCloseTo(0.85);
    expect(carouselNeighbour(0, 3, 250, 0.94, 0.7, false)).toEqual({ scale: 0.94, opacity: 0.7 });
  });

  it('keeps full size under reduced motion, the opacity still marks the focus', () => {
    expect(carouselNeighbour(0, 1, 250, 0.94, 0.7, true)).toEqual({ scale: 1, opacity: 0.7 });
  });

  it('snaps, finds the drop slot and makes room', () => {
    expect(snapIndex(380, 250, 3)).toBe(2);
    expect(snapIndex(-50, 250, 3)).toBe(0);
    expect(reorderTarget(0, 260, 250, 3)).toBe(1);
    expect(reorderTarget(0, 900, 250, 3)).toBe(2);
    expect(reorderTarget(2, -120, 250, 3)).toBe(2);
    expect(reorderShift(1, 0, 2, 250)).toBe(-250);
    expect(reorderShift(2, 0, 2, 250)).toBe(-250);
    expect(reorderShift(0, 2, 0, 250)).toBe(250);
    expect(reorderShift(2, 0, 1, 250)).toBe(0);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
});

describe('reaction picker (SM9)', () => {
  it('finds the glyph under the finger and cancels outside', () => {
    expect(reactionIndexAt(10, 20, 4, 44, 4, 24)).toBe(0);
    expect(reactionIndexAt(50, 20, 4, 44, 4, 24)).toBe(1);
    expect(reactionIndexAt(185, 20, 4, 44, 4, 24)).toBe(3);
    expect(reactionIndexAt(-5, 20, 4, 44, 4, 24)).toBe(-1);
    expect(reactionIndexAt(195, 20, 4, 44, 4, 24)).toBe(-1);
    expect(reactionIndexAt(50, 100, 4, 44, 4, 24)).toBe(-1);
    expect(reactionItemX(2, 44, 4)).toBe(96);
  });
});

describe('flights (SM4, SM12)', () => {
  const card = { x: 20, y: 300, width: 96, height: 128 };
  const hero = { x: 0, y: 0, width: 390, height: 293 };

  it('starts exactly over the source and ends as the destination', () => {
    const start = flightTransform(card, hero);
    expect(start.scaleX).toBeCloseTo(96 / 390);
    expect(start.scaleY).toBeCloseTo(128 / 293);
    expect(start.translateX).toBeCloseTo(68 - 195);
    expect(start.translateY).toBeCloseTo(364 - 146.5);
    expect(flightAt(start, 1)).toEqual({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 });
  });

  it('keeps the photo covering the clip without distortion', () => {
    const counter = coverCounterScale(0.25, 0.5);
    // Inner × outer is the same in both axes: a uniform scale.
    expect(0.25 * counter.scaleX).toBeCloseTo(0.5 * counter.scaleY);
    expect(coverCounterScale(1, 1)).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('draws the corner 12 on screen at the start and 0 at the end', () => {
    expect(flightRadius(12, 0, 0, 0.5, 0.5)).toBeCloseTo(24);
    expect(flightRadius(12, 0, 1, 1, 1)).toBe(0);
  });
});

describe('stretchy hero (SM5) and pager (SM2)', () => {
  it('stretches from the top when pulled and trails at 0.5× when scrolled', () => {
    expect(stretchyHero(-60, 400, 1.15, 0.5, false)).toEqual({ scale: 1.15, translateY: 0 });
    expect(stretchyHero(-20, 400, 1.15, 0.5, false).scale).toBeCloseTo(1.05);
    expect(stretchyHero(100, 400, 1.15, 0.5, false)).toEqual({ scale: 1, translateY: 50 });
  });

  it('stands still under reduced motion', () => {
    expect(stretchyHero(-60, 400, 1.15, 0.5, true)).toEqual({ scale: 1, translateY: 0 });
    expect(pagerParallax(150, 0, 300, 0.3, true)).toBe(0);
  });

  it('fades the header in as the hero passes under it', () => {
    expect(heroHeaderFade(0, 500, 100)).toBe(0);
    expect(heroHeaderFade(400, 500, 100)).toBe(1);
    expect(heroHeaderFade(350, 500, 100)).toBeCloseTo(0.5);
  });

  it('moves the photo at 0.3× of its page offset', () => {
    expect(pagerParallax(150, 0, 300, 0.3, false)).toBeCloseTo(45);
    expect(pagerParallax(300, 1, 300, 0.3, false)).toBe(0);
  });

  it('stretches the indicator pill between pages and settles on whole pages', () => {
    const at0 = indicatorEdges(0, 8, 8, 24);
    expect(at0.right - at0.left).toBe(24);
    const at1 = indicatorEdges(1, 8, 8, 24);
    expect(at1.left - at0.left).toBe(16);
    const mid = indicatorEdges(0.5, 8, 8, 24);
    expect(mid.left).toBe(at0.left);
    expect(mid.right).toBe(at1.right);
  });
});

describe('before/after (SM17) and circular reveal (SM14)', () => {
  it('moves the divider with the finger, clamped to the photo', () => {
    expect(dividerPosition(0.5, 90, 360)).toBeCloseTo(0.75);
    expect(dividerPosition(0.5, -900, 360)).toBe(0);
    expect(dividerPosition(0.5, 900, 360)).toBe(1);
  });

  it('covers the box from any origin', () => {
    expect(coveringRadius({ x: 0, y: 0 }, 300, 400)).toBe(500);
    expect(coveringRadius({ x: 150, y: 200 }, 300, 400)).toBe(250);
  });
});
