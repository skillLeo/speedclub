import { useState, type ReactNode } from 'react';
import { Text as RNText, type LayoutChangeEvent, type TextLayoutEvent, type TextStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { typography, useTheme } from '@/theme';

import {
  DISPLAY_TITLE_PAGE_MAX_LINES,
  DISPLAY_TITLE_SHRUNK,
  displayTitleFontSize,
  displayTitleLineHeight,
  displayTitleSize,
  displayTitleText,
  drawnScale,
  estimateDisplayTitle,
  needsShrunkLines,
  shrunkFitsOneLine,
  type DisplayTitleKind,
  type DisplayTitlePlacement,
  type DisplayTitleSize,
} from './displayTitleLayout';
import { estimateLines } from './Skeleton';
import { Text, useDesktopType, type TextProps } from './Text';

const WORD_JOINER = '\u2060';
/** A word that vehicleNameText keeps whole ("GT-R"): it carries a word joiner after its hyphen. */
const KEPT_WORD = new RegExp(`(\\S*${WORD_JOINER}\\S*)`, 'u');
// react-native-web passes these through to CSS (createReactDOMStyle keeps unknown properties); native never sees them.
const NO_WRAP = { whiteSpace: 'nowrap' } as unknown as TextStyle;
/**
 * ADR-426 c: balanced breaks on the member web. `text-wrap-style: balance` (the longhand: the `text-wrap` shorthand would reset `text-wrap-mode`, DQ-922) evens the lines out without changing their number (the
 * estimate stays valid). Android gets `textBreakStrategy="balanced"`; iOS has no balanced strategy for Text.
 */
export const BALANCED_WEB_WRAP = { textWrapStyle: 'balance' } as unknown as TextStyle;
/** Laid out (so it measures itself) but not drawn, while the estimate cannot tell its size (MF-R2-1). */
const PENDING: TextStyle = { opacity: 0 };

export type DisplayTitleProps = Omit<TextProps, 'variant' | 'children' | 'hyphenate' | 'desktopSize' | 'numberOfLines'> & {
  children: string;
  /**
   * `vehicle` (default): a car name. It wraps only at its spaces: never hyphenated, a hyphenated name ("GT-R") and a model
   * designation ("C 63") stay whole, and a trailing code of up to 4 characters stays with the word before it where a breakable
   * space remains before the pair and the pair fits the line (ADR-426 c; only with `layoutWidth`).
   * `copy`: a sentence at a brand moment, which may hyphenate like running copy.
   */
  kind?: DisplayTitleKind;
  /**
   * ADR-426 a/b, set at every call site. `page`: the page's title, at the desktop size on the web desktop, full size while it
   * takes at most 2 lines. `card`: a title in a fixed card or on a photo band (FeaturedHero on its photo, the VEH-01/GAR-02 side
   * card on the web desktop): 30/34 at every width while it fits 1 line, 24/28 when that brings it to 1 line, else the page rule
   * at 30/34. Required: every display title states where it stands, the gallery's specimen included.
   */
  placement: DisplayTitlePlacement;
  /**
   * MF-R2-1: the width the title is laid out at, known before its first layout (FeaturedHero's text width, VEH-01's
   * `profileSummaryWidth`, AUTH-02's copy column). Its size then comes from the estimate on the first frame, the same decision
   * the Blade page takes, so it never paints at 30 and then jumps to 24. Pass it at every product call site (SF-R3-3): without
   * it the title is laid out invisibly until it has counted its own lines, and binds no trailing code.
   */
  layoutWidth?: number;
};

/**
 * - `measure`: drawn invisibly at the full size until its lines there are counted;
 * - `probe`: a card with 2 lines at the full size, drawn at 24 (invisibly) until its lines there are counted;
 * - `settled`: the size is decided; a later width change decides again.
 */
type Stage = 'measure' | 'probe' | 'settled';
/** ADR-425 as amended, one source of decision: a size from the estimate is final, and counted lines never override it. */
type Source = 'estimate' | 'lines';

type ShrinkState = {
  key: string;
  size: DisplayTitleSize;
  stage: Stage;
  source: Source;
  /** Invisible while it measures a size it may not keep (ADR-425). */
  hidden: boolean;
  /** The width the size was decided at; null while that width is not known yet (native counts lines before onLayout may fire). */
  width: number | null;
  /** Its lines at the full size, once counted (a card's probe reads them). */
  fullLines: number | null;
};

/** The shrunk display.title: `display.title` minSize/minLineHeight (24/28, ADR-426 g) with the role's −1 % tracking. */
function shrunkStyle(scale: number): TextStyle {
  const role = typography.displayTitle;
  return {
    fontSize: DISPLAY_TITLE_SHRUNK.fontSize * scale,
    lineHeight: DISPLAY_TITLE_SHRUNK.lineHeight * scale,
    letterSpacing: (role.letterSpacing / role.fontSize) * DISPLAY_TITLE_SHRUNK.fontSize * scale,
  };
}

/**
 * A car name as nodes. Native keeps words whole with the word joiners and the U+00A0 of displayTitleText. Web sets a hyphenated
 * name ("GT-R") in a no-wrap span without its word joiner, but a model designation and a bound trailing code keep their U+00A0
 * in the text ("C 63", "GT-R R34"), so the DOM text is not the plain name there (NH-4). The Blade page binds the same codes; the
 * parity test folds every white space, U+00A0 included (`\s` in web/tests/e2e/parity/compare.mjs), so both read the same.
 */
function vehicleName(text: string): ReactNode {
  if (!isWeb) return text;
  return text
    .split(KEPT_WORD)
    .filter((part) => part !== '')
    .map((part, index) =>
      part.includes(WORD_JOINER) ? (
        <RNText key={index} style={NO_WRAP}>
          {part.replaceAll(WORD_JOINER, '')}
        </RNText>
      ) : (
        part
      ),
    );
}

/**
 * The one way to set `display.title` (09 §4.2: Archivo SemiExpanded, 30/34 · 44/48; ADR-426 a: it shrinks to 24/28 only where
 * that saves a line, by its placement). At 24 it takes as many lines as it needs: a title never truncates. A wider window
 * decides again.
 *
 * MF-R2-1 / ADR-425 as amended, the size before the first paint: with `layoutWidth` the first render already has the size the
 * estimate from the shipped font gives (advances plus positive pair kerning, displayTitleLayout.ts), the decision the Blade
 * page takes at the same width. That decision is final: the title's own layout never overrides it. Only where the estimate is
 * ambiguous (Android 14+'s non-linear font scale, copy that may hyphenate) or no width is given is the title laid out
 * invisibly at the full size until it has counted its own lines, which takes one frame (a card with 2 lines there may take
 * one more frame at 24, still invisible). It does not measure in a layout effect instead: React Native's synchronous
 * `getBoundingClientRect` gives a height, and on Android 14+ a height says nothing exact about lines (SF-R2-1).
 *
 * MF-R3-1: the measured text is keyed by everything the decision depends on, so a new width or text remounts it, and a fresh
 * paragraph always reports its first layout (Fabric drops an onTextLayout with unchanged lines; react-native-web's onLayout is
 * a ResizeObserver that only reports a changed box). A title can never wait for an event that does not come.
 *
 * Native counts lines with onTextLayout (exact at any font scale); web divides its height by the drawn line height, as the
 * QA font scale there is linear.
 *
 * ADR-426 c: breaks are balanced (Android `textBreakStrategy="balanced"`, web `text-wrap: balance`).
 */
export function DisplayTitle({
  children,
  kind = 'vehicle',
  placement,
  layoutWidth,
  style,
  onLayout,
  onTextLayout,
  ...rest
}: DisplayTitleProps) {
  const { fontScale } = useTheme();
  const desktop = useDesktopType() && placement === 'page';
  const scale = drawnScale(fontScale);
  const given = layoutWidth !== undefined && Number.isFinite(layoutWidth) && layoutWidth > 0 ? layoutWidth : null;
  const key = `${children}|${kind}|${fontScale}|${desktop}|${placement}|${given ?? ''}`;
  const fullSize = displayTitleFontSize(desktop);
  // Without a given width the box's own width only sizes it: no trailing code is bound then (ADR-426 c).
  const estimateAt = (width: number) =>
    estimateDisplayTitle({ name: children, kind, width, fontSize: fullSize, placement, scale, bind: given !== null });
  const estimate = given === null ? null : estimateAt(given);
  const seed: ShrinkState =
    estimate !== null && estimate.certain
      ? { key, size: estimate.shrunk ? 'shrunk' : 'full', stage: 'settled', source: 'estimate', hidden: false, width: given, fullLines: estimate.shrunk ? null : estimate.lines }
      : // Ambiguous, or no width: the full size, invisibly, until it has counted its own lines (SF-R3-3).
        { key, size: 'full', stage: 'measure', source: 'lines', hidden: true, width: given, fullLines: null };
  const [state, setState] = useState<ShrinkState>(seed);
  const active = state.key === key ? state : seed;
  const drawn = active.size;
  // Native scales the size itself (the OS font scale); web applies the QA font scale.
  const styleScale = isWeb ? fontScale : 1;
  const text = displayTitleText(children, kind, (drawn === 'shrunk' ? DISPLAY_TITLE_SHRUNK.fontSize : fullSize) * scale.high, given);

  /** The size a card with `fullLines` at the full size gets, or null when only a probe at 24 can tell. */
  const cardAfterFull = (fullLines: number, width: number | null): DisplayTitleSize | null => {
    if (!needsShrunkLines(placement, fullLines)) return displayTitleSize(placement, fullLines, null);
    const oneLine = width === null || kind === 'copy' ? null : shrunkFitsOneLine(children, width, scale, given !== null);
    return oneLine === null ? null : displayTitleSize(placement, fullLines, oneLine ? 1 : 2);
  };

  /**
   * A layout of the size this render drew (`drawn`): its width when known, and its line count when known. A layout of another
   * size than the state's (a change already on its way) says nothing and is ignored.
   */
  const laidOut = (width: number | null, lines: number | null) => {
    setState((current) => {
      let now = current.key === key ? current : seed;
      if (now.size !== drawn) return now;
      // With `layoutWidth` the parent owns the width: a new one is a new key, and the title's own box may be narrower than the
      // line (a title set `alignSelf: 'flex-start'` is as wide as its longest line), so it decides nothing. Without it, the box
      // is the best width there is; it only decides again when it grows, so a shrink-wrapped box cannot flip the size back.
      if (width !== null && given === null) {
        if (now.width === null) {
          now = { ...now, width };
        } else if (width > now.width + 1 && now.stage === 'settled') {
          // More room (a rotation, a wider window): decide again, from the estimate when it is final.
          const fit = estimateAt(width);
          if (fit.certain) {
            return { key, size: fit.shrunk ? 'shrunk' : 'full', stage: 'settled', source: 'estimate', hidden: false, width, fullLines: fit.shrunk ? null : fit.lines };
          }
          now = { key, size: 'full', stage: 'measure', source: 'lines', hidden: false, width, fullLines: null };
          // Drawn shrunk: the full size draws next and reports its own lines.
          if (drawn !== 'full') return now;
        }
      }
      if (lines === null) return now;
      // One source of decision: the estimate's size stands, whatever the kerned text takes on this screen.
      if (now.source === 'estimate') return now;
      if (now.stage === 'probe') {
        // Drawn at 24 for a card with 2 lines at the full size: 1 line here keeps 24, more go back to 30 (ADR-426 a).
        const size = displayTitleSize(placement, now.fullLines ?? DISPLAY_TITLE_PAGE_MAX_LINES, lines);
        return { ...now, size, stage: 'settled', hidden: false };
      }
      // A shrunk title stays shrunk at this width; only a wider one decides again (above).
      if (drawn !== 'full') return now;
      // The lines it was decided with: nothing to do (this also ends a probe that went back to the full size).
      if (now.stage === 'settled' && now.fullLines === lines) return now;
      const size = cardAfterFull(lines, now.width);
      if (size === null) return { ...now, size: 'shrunk', stage: 'probe', hidden: true, fullLines: lines };
      return { ...now, size, stage: 'settled', hidden: false, fullLines: lines };
    });
  };

  /** The line box the drawn size has on the web, at the QA font scale. */
  const drawnLine = (drawn === 'shrunk' ? DISPLAY_TITLE_SHRUNK.lineHeight : displayTitleLineHeight(desktop)) * fontScale;

  const measure = (event: LayoutChangeEvent) => {
    onLayout?.(event);
    const { width, height } = event.nativeEvent.layout;
    // The web's QA font scale is linear, so its height gives its lines; native counts them in onTextLayout (SF-R2-1).
    laidOut(width, isWeb ? Math.max(1, Math.round(height / drawnLine)) : null);
  };

  const countLines = (event: TextLayoutEvent) => {
    onTextLayout?.(event);
    laidOut(null, event.nativeEvent.lines.length);
  };

  return (
    <Text
      // MF-R3-1: a new width or text is a new paragraph, which always reports its first layout.
      key={key}
      {...rest}
      variant="displayTitle"
      hyphenate={kind === 'copy'}
      desktopSize={placement === 'page'}
      // ADR-426 c: Android's balanced breaks (iOS ignores the prop; web uses BALANCED_WEB_WRAP and never gets it).
      textBreakStrategy={isWeb ? undefined : 'balanced'}
      onLayout={measure}
      {...(isWeb ? {} : { onTextLayout: countLines })}
      style={[isWeb ? BALANCED_WEB_WRAP : null, style, drawn === 'shrunk' ? shrunkStyle(styleScale) : null, active.hidden ? PENDING : null]}
    >
      {kind === 'vehicle' ? vehicleName(text) : children}
    </Text>
  );
}

/**
 * The skeleton lines of a display.title that is not loaded yet, set like `sample` (a typical title of the place), under the same
 * rule (ADR-426 a) and the same estimate. A shrunk title is drawn in `title.2` lines: their 28 line box is the shrunk 24/28 one
 * (SkeletonText knows roles, not sizes; tests pin the equality).
 */
export function displayTitleSkeleton(
  sample: string,
  fontScale: number,
  width: number,
  placement: DisplayTitlePlacement,
): { variant: 'displayTitle' | 'title2'; lines: number } {
  if (!(width > 0)) return { variant: 'displayTitle', lines: estimateLines(sample.length, 'displayTitle', fontScale, width) };
  const fit = estimateDisplayTitle({ name: sample, kind: 'vehicle', width, fontSize: displayTitleFontSize(false), placement, scale: drawnScale(fontScale) });
  return fit.shrunk ? { variant: 'title2', lines: fit.lines } : { variant: 'displayTitle', lines: fit.lines };
}
