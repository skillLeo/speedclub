import { VIEWER_TOUCH_SLOP, clampIndex } from '@/ui/imageViewerPaging';

describe('viewer paging (R5-2d)', () => {
  it('keeps a requested page within the photos', () => {
    expect(clampIndex(2, 12)).toBe(2);
    expect(clampIndex(40, 12)).toBe(11);
    expect(clampIndex(-3, 12)).toBe(0);
    expect(clampIndex(4, 3)).toBe(2);
  });

  it('reads a broken or empty request as the first photo', () => {
    expect(clampIndex(Number.NaN, 12)).toBe(0);
    expect(clampIndex(Number.POSITIVE_INFINITY, 12)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(1.6, 12)).toBe(2);
  });

  it('a touch is a tap below the slop and a drag from it', () => {
    expect(VIEWER_TOUCH_SLOP).toBe(8);
  });
});
