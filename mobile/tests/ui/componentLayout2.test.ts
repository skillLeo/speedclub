/** M4.4 part 2: the pure geometry of MediaCard, Timeline and ContextMenu (09 §5). */
import { aspect, scrimSafe, space } from '@/theme';
import { contextMenuPlacement, nextMenuIndex } from '@/ui/contextMenuLayout';
import { leadBodyGap, leadOverlapShare, MEDIA_ASPECT, MEDIA_WALL_GAP, mediaHeight, mediaWallTileWidth, pageAt } from '@/ui/mediaCardLayout';
import { timelineGroups, TIMELINE_PHOTOS_MAX } from '@/ui/timelineLayout';

describe('MediaCard geometry', () => {
  it('uses the 09 §4.6 crops: lead and feed 4:5, rail 3:4, wall 1:1 (or 4:5)', () => {
    expect(MEDIA_ASPECT).toMatchObject({ lead: aspect.hero, feed: '4:5', feedSquare: '1:1', rail: '3:4', wall: '1:1', wallTall: '4:5' });
    expect(mediaHeight(390, '4:5')).toBe(487.5);
  });

  it('splits the wall into two columns 2 apart', () => {
    expect(MEDIA_WALL_GAP).toBe(space[2]);
    expect(mediaWallTileWidth(390)).toBe(194);
    expect(mediaWallTileWidth(0)).toBe(0);
  });

  it('lets the lead identity reach into the photo only down from the large-text-safe line (ADR-421 b)', () => {
    // From the bottom edge up to 77.6 % of a 4:5 photo: 0.224 × 1.25 = 28 % of the width.
    expect(leadOverlapShare('carbon')).toBeCloseTo((1 - scrimSafe.carbon.large) * 1.25, 9);
    const height = mediaHeight(390, '4:5');
    const overlap = leadOverlapShare('carbon') * 390;
    // The title starts on the large-text line; the body text after one title line and the gap is below the text-safe line.
    const bodyTop = height - overlap + 34 + leadBodyGap(390, 'carbon', 34);
    expect(height - overlap).toBeCloseTo(scrimSafe.carbon.large * height, 6);
    expect(bodyTop).toBeGreaterThanOrEqual(scrimSafe.carbon.text * height);
    // On a wide lead the gap grows instead of letting the body climb above the line.
    expect(leadBodyGap(900, 'carbon', 34)).toBeGreaterThan(space[8]);
    expect(leadBodyGap(390, 'carbon', 34)).toBe(space[8]);
  });

  it('reads the pager page from its offset, clamped', () => {
    expect(pageAt(0, 390, 3)).toBe(0);
    expect(pageAt(400, 390, 3)).toBe(1);
    expect(pageAt(5000, 390, 3)).toBe(2);
    expect(pageAt(100, 0, 3)).toBe(0);
  });
});

describe('Timeline grouping', () => {
  it('puts consecutive entries of one month under one heading, in order', () => {
    const groups = timelineGroups([{ date: 'Juni 2026' }, { date: 'Juni 2026' }, { date: 'März 2023' }, { date: 'Juni 2026' }]);
    expect(groups.map((group) => [group.date, group.entries.length])).toEqual([
      ['Juni 2026', 2],
      ['März 2023', 1],
      ['Juni 2026', 1],
    ]);
    expect(TIMELINE_PHOTOS_MAX).toBe(3);
  });
});

describe('ContextMenu placement and keys', () => {
  const window = { width: 390, height: 844 };
  const menu = { width: 240, height: 200 };

  it('opens under the anchor with its right edges aligned', () => {
    expect(contextMenuPlacement({ x: 300, y: 100, width: 44, height: 44 }, menu, window, 8, 0, 0, 4)).toEqual({ left: 104, top: 148, above: false });
  });

  it('opens above the anchor when it does not fit below, and stays inside the window and the safe areas', () => {
    const above = contextMenuPlacement({ x: 300, y: 760, width: 44, height: 44 }, menu, window, 8, 47, 34, 4);
    expect(above.above).toBe(true);
    expect(above.top).toBe(556);
    // A long press near the left edge: never off screen.
    expect(contextMenuPlacement({ x: 20, y: 300, width: 0, height: 0 }, menu, window, 8).left).toBe(8);
    // Too tall for both sides: pinned inside the safe area.
    const tall = contextMenuPlacement({ x: 200, y: 400, width: 0, height: 0 }, { width: 240, height: 800 }, window, 8, 47, 34);
    expect(tall.top).toBeGreaterThanOrEqual(47 + 8);
  });

  it('walks the enabled items with the arrows, Home and End, wrapping around', () => {
    const enabled = [true, false, true, true];
    expect(nextMenuIndex('ArrowDown', 0, enabled)).toBe(2);
    expect(nextMenuIndex('ArrowDown', 3, enabled)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, enabled)).toBe(3);
    expect(nextMenuIndex('Home', 3, enabled)).toBe(0);
    expect(nextMenuIndex('End', 0, enabled)).toBe(3);
    expect(nextMenuIndex('a', 0, enabled)).toBeNull();
    expect(nextMenuIndex('ArrowDown', 0, [false, false])).toBeNull();
  });
});
