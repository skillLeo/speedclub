/** Value and offset arithmetic of RangeSlider. All worklets: they run in the gesture callbacks. */

/** Nearest step from `min`, inside the range. Decimal steps stay exact. */
export function snapValue(raw: number, min: number, max: number, step: number): number {
  'worklet';
  const stepped = min + Math.round((raw - min) / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
}

export function offsetToValue(offset: number, travel: number, min: number, max: number): number {
  'worklet';
  return travel > 0 ? min + (offset / travel) * (max - min) : min;
}

export function valueToOffset(value: number, travel: number, min: number, max: number): number {
  'worklet';
  return max > min ? ((value - min) / (max - min)) * travel : 0;
}

/** Keeps the low thumb at least one step below the high thumb. */
export function clampLow(raw: number, high: number, min: number, max: number, step: number): number {
  'worklet';
  return Math.min(snapValue(raw, min, max, step), Number((high - step).toFixed(6)));
}

/** Keeps the high thumb at least one step above the low thumb. */
export function clampHigh(raw: number, low: number, min: number, max: number, step: number): number {
  'worklet';
  return Math.max(snapValue(raw, min, max, step), Number((low + step).toFixed(6)));
}

/**
 * Left edges of the two value bubbles: centred on their thumbs, kept apart when the thumbs are close, and
 * inside the slider.
 */
export function bubbleOffsets(
  lowCentre: number,
  highCentre: number,
  lowWidth: number,
  highWidth: number,
  sliderWidth: number,
  gap: number,
): { low: number; high: number } {
  'worklet';
  let low = lowCentre - lowWidth / 2;
  let high = highCentre - highWidth / 2;
  if (low + lowWidth + gap > high) {
    const middle = (lowCentre + highCentre) / 2;
    low = middle - gap / 2 - lowWidth;
    high = middle + gap / 2;
  }
  high = Math.min(high, sliderWidth - highWidth);
  low = Math.min(low, high - gap - lowWidth);
  low = Math.max(low, 0);
  high = Math.max(high, low + lowWidth + gap);
  return { low, high };
}
