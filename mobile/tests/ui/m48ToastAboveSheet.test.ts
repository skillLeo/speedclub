// DQ-1006 r3: a toast inside an overlay sits above the open sheet, or at the top of the screen when there is no room above it.
import { reportOverlayPanel, toastFitsAbovePanel, TOAST_GAP } from '@/ui/toastPlacement';

describe('toast above a sheet', () => {
  it('fits above a content-height sheet and moves to the top above a full sheet', () => {
    // 852 window, 59 safe top, a 56 toast: a 400 sheet leaves room, a 767 (90 %) sheet does not.
    expect(toastFitsAbovePanel(400, 852, 59, 56)).toBe(true);
    expect(toastFitsAbovePanel(767, 852, 59, 56)).toBe(false);
    expect(toastFitsAbovePanel(852 - 59 - 2 * TOAST_GAP - 56, 852, 59, 56)).toBe(true);
  });

  it('accepts and withdraws a sheet report without throwing', () => {
    expect(() => {
      reportOverlayPanel('a', { height: 300, column: 350 });
      reportOverlayPanel('a', null);
    }).not.toThrow();
  });
});
