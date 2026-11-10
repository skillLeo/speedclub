/** Sheet positions as translateY of a panel that is always 90 % high: 0 is the full snap. */
export type SheetTarget = 'full' | 'content' | 'close';

/** A flick faster than this skips to the next snap point. The same speed as the viewer's drag to dismiss (§8). */
export const SHEET_FLICK_VELOCITY = 800;

/** translateY of the content snap: the part of the panel that the content does not need stays below the screen. */
export function contentOffset(panelHeight: number, contentHeight: number): number {
  'worklet';
  return Math.max(0, panelHeight - contentHeight);
}

/** Where a released sheet settles. */
export function settleTarget(
  y: number,
  velocityY: number,
  contentY: number,
  panelHeight: number,
  canExpand: boolean,
  canClose: boolean,
): SheetTarget {
  'worklet';
  const expandable = canExpand && contentY > 0;
  const lower: SheetTarget = canClose ? 'close' : 'content';

  if (velocityY > SHEET_FLICK_VELOCITY) return y < contentY ? 'content' : lower;
  if (velocityY < -SHEET_FLICK_VELOCITY) return expandable ? 'full' : 'content';

  if (y > contentY) return y - contentY > (panelHeight - contentY) / 2 ? lower : 'content';
  return expandable && y < contentY / 2 ? 'full' : 'content';
}

/** Panel translate: the snap offset plus the (negative) keyboard lift, never above the 90 % line. */
export function panelTranslate(y: number, keyboardLift: number): number {
  'worklet';
  return Math.max(0, y + keyboardLift);
}

/**
 * Footer translate inside the panel: it stays on the visible bottom edge, above the keyboard, at every snap. Dragging
 * below the resting point takes it along with the panel.
 */
export function footerTranslate(y: number, keyboardLift: number, restingY: number): number {
  'worklet';
  const panel = panelTranslate(y, keyboardLift);
  return keyboardLift - Math.min(panel, panelTranslate(restingY, keyboardLift));
}

/**
 * DQ-043, web: the focus trap takes the first thing that accepts focus, which is the grabber, with its ring. The sheet starts
 * on its title instead, so a screen reader reads it and the next Tab reaches the first action. A field in the body that has
 * taken focus for itself keeps it.
 */
export function moveFocusIntoSheet(stage: Pick<Node, 'contains'> | null, start: Pick<HTMLElement, 'focus'> | null, active: Node | null): void {
  if (stage?.contains(active)) return;
  start?.focus({ preventScroll: true });
}
