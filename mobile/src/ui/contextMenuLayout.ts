/** 09 §5 ContextMenu: where the menu opens and how the keyboard walks it. Pure, so Jest covers both. */

export type MenuRect = { x: number; y: number; width: number; height: number };

export type MenuPlacement = { left: number; top: number; above: boolean };

/**
 * The menu's top-left corner in window coordinates: under the anchor, its right edge on the anchor's right edge (a menu
 * opens towards the content, like the platform menus); above the anchor when it does not fit below; always inside the
 * window by `margin` and clear of the safe areas `insetTop` / `insetBottom`. A point anchor (a long press) has width and
 * height 0.
 */
export function contextMenuPlacement(
  anchor: MenuRect,
  menu: { width: number; height: number },
  window: { width: number; height: number },
  margin: number,
  insetTop = 0,
  insetBottom = 0,
  gap = 0,
): MenuPlacement {
  const minTop = insetTop + margin;
  const maxBottom = window.height - insetBottom - margin;
  const below = anchor.y + anchor.height + gap;
  const fitsBelow = below + menu.height <= maxBottom;
  const aboveTop = anchor.y - gap - menu.height;
  const above = !fitsBelow && aboveTop >= minTop;
  const rawTop = fitsBelow ? below : above ? aboveTop : maxBottom - menu.height;
  const top = Math.max(minTop, Math.min(rawTop, maxBottom - menu.height));
  const rightAligned = anchor.x + anchor.width - menu.width;
  const left = Math.max(margin, Math.min(rightAligned, window.width - margin - menu.width));
  return { left, top, above };
}

/** The item the arrow keys, Home and End move to, skipping disabled items and wrapping around (WAI-ARIA menu pattern). */
export function nextMenuIndex(key: string, current: number, enabled: readonly boolean[]): number | null {
  const count = enabled.length;
  if (count === 0 || !enabled.some(Boolean)) return null;
  const walk = (from: number, delta: number) => {
    let next = from;
    for (let step = 0; step < count; step += 1) {
      next = (next + delta + count) % count;
      if (enabled[next]) return next;
    }
    return from;
  };
  if (key === 'ArrowDown') return walk(current, 1);
  if (key === 'ArrowUp') return walk(current < 0 ? 0 : current, -1);
  if (key === 'Home') return walk(-1, 1);
  if (key === 'End') return walk(count, -1);
  return null;
}
