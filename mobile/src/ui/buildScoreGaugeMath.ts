/**
 * The geometry of the Build Score gauge (M5.9c ★, ADR-508): a tachometer arc of 240° that opens at the bottom, 0 at its lower left,
 * 1000 at its lower right, 500 straight up. Angles are degrees clockwise from 12 o'clock, which is how the needle's `rotate`
 * transform turns. Pure, so Jest checks the numbers.
 */

/** The arc's sweep and where it starts: −120° (0) to +120° (1000). */
export const GAUGE_SWEEP = 240;
export const GAUGE_START = -GAUGE_SWEEP / 2;
export const GAUGE_MAX = 1000;

/** Where each stage starts (contract §3): 1 (0–199), 2 (200–399), 3 (400–599), 4 (600–799), 5 (800+). */
export const STAGE_STARTS = [0, 200, 400, 600, 800] as const;

export function scoreFraction(total: number, max: number = GAUGE_MAX): number {
  if (!Number.isFinite(total) || max <= 0) return 0;
  return Math.min(1, Math.max(0, total / max));
}

/** The needle's rotation for a fraction of the scale, degrees clockwise from 12 o'clock. A worklet (the needle spring calls it). */
export function angleForFraction(fraction: number): number {
  'worklet';
  return GAUGE_START + GAUGE_SWEEP * fraction;
}

/** The needle's rotation for a score: 0 → −120, 500 → 0, 1000 → 120. */
export function scoreAngle(total: number, max: number = GAUGE_MAX): number {
  return angleForFraction(scoreFraction(total, max));
}

/** The stage of a score, 1–5. */
export function stageOf(total: number): number {
  let stage = 1;
  STAGE_STARTS.forEach((start, index) => {
    if (total >= start) stage = index + 1;
  });
  return stage;
}

/** "+25": the rise since the last computation, or null when there is none (no previous score, the same, or lower). */
export function scoreDelta(previous: number | null | undefined, total: number): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
  const delta = Math.round(total - previous);
  return delta > 0 ? delta : null;
}

/** A point on a circle at `degrees` clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.sin(radians), y: cy - r * Math.cos(radians) };
}

/** An SVG arc path from `from` to `to` degrees (clockwise), for a stroked track. */
export function arcPath(cx: number, cy: number, r: number, from: number = GAUGE_START, to: number = GAUGE_START + GAUGE_SWEEP): string {
  const start = polar(cx, cy, r, from);
  const end = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `M ${round(start.x)} ${round(start.y)} A ${round(r)} ${round(r)} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`;
}

/** The arc's length, for `strokeDasharray` / `strokeDashoffset`. */
export function arcLength(r: number, sweep: number = GAUGE_SWEEP): number {
  return (r * Math.PI * sweep) / 180;
}

/** The dash offset that shows `fraction` of the arc. A worklet. */
export function dashOffset(length: number, fraction: number): number {
  'worklet';
  return length * (1 - Math.min(1, Math.max(0, fraction)));
}

export type GaugeTick = { value: number; major: boolean; from: { x: number; y: number }; to: { x: number; y: number } };

/** Ticks every 100 inside the arc; the stage starts (200, 400, 600, 800) and the ends are longer. */
export function gaugeTicks(cx: number, cy: number, inner: number, outer: number, minorInset: number): GaugeTick[] {
  const ticks: GaugeTick[] = [];
  for (let value = 0; value <= GAUGE_MAX; value += 100) {
    const major = value % 200 === 0;
    const angle = scoreAngle(value);
    ticks.push({ value, major, from: polar(cx, cy, major ? inner : inner + minorInset, angle), to: polar(cx, cy, outer, angle) });
  }
  return ticks;
}

/**
 * The drawing's radii as shares of the arc's radius (ADR-508; R6-3 made them proportional, so a small gauge keeps the same
 * drawing): the ticks between 0.88 r and 0.92 r (the minor ones a dot at 0.92 r), the needle from its inner circle at 0.6 r out to
 * 0.84 r, its last part from 0.72 r the accent tip. At the 208 box of client round 4 these are the old 88/92/60/72/84.
 */
export const GAUGE_RATIOS = { tickOuter: 0.92, tickInner: 0.88, needleOuter: 0.84, tipStart: 0.72, needleInner: 0.6 } as const;

export type GaugeGeometry = {
  centre: number;
  radius: number;
  tickInner: number;
  tickOuter: number;
  tickMinorInset: number;
  needleInner: number;
  tipStart: number;
  needleOuter: number;
};

/** The geometry of a gauge drawn in a square `box` with an arc `stroke` wide, `inset` inside the box's edge. */
export function gaugeGeometry(box: number, stroke: number, inset: number): GaugeGeometry {
  const centre = box / 2;
  const radius = Math.max(0, centre - stroke / 2 - inset);
  return {
    centre,
    radius,
    tickInner: radius * GAUGE_RATIOS.tickInner,
    tickOuter: radius * GAUGE_RATIOS.tickOuter,
    tickMinorInset: radius * (GAUGE_RATIOS.tickOuter - GAUGE_RATIOS.tickInner),
    needleInner: radius * GAUGE_RATIOS.needleInner,
    tipStart: radius * GAUGE_RATIOS.tipStart,
    needleOuter: radius * GAUGE_RATIOS.needleOuter,
  };
}

/**
 * The gauge's layout height for a square drawing of `box`: down to the arc's ends (½ r under the pivot, plus the stroke) or to the
 * bottom of the text under the numeral (`contentBottom`, from the box's top), whichever is lower. The square's empty bottom is not
 * laid out; text that reaches below the square (a large font) is.
 */
export function gaugeHeight(box: number, radius: number, stroke: number, contentBottom: number): number {
  const centre = box / 2;
  const arcBottom = centre + radius / 2 + stroke;
  return Math.ceil(Math.max(Math.min(box, arcBottom), contentBottom));
}
