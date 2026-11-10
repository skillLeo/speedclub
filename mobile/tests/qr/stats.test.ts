import { milestoneFor, miniBarHeights, QR_MILESTONES } from '@/features/qr/stats';

const SCALE = { max: 32, empty: 2, min: 4 };

describe('QR-02 mini bars (FS-9, sig.qr_stats)', () => {
  it('scales the busiest day to the full height and the others in proportion', () => {
    expect(miniBarHeights([0, 5, 10, 20], SCALE)).toEqual([2, 8, 16, 32]);
  });

  it('keeps a day with one scan visible beside a busy day', () => {
    expect(miniBarHeights([1, 1000], SCALE)).toEqual([4, 32]);
  });

  it('draws stubs only for a series without scans, and for unreadable counts', () => {
    expect(miniBarHeights(Array.from({ length: 14 }, () => 0), SCALE)).toEqual(Array.from({ length: 14 }, () => 2));
    expect(miniBarHeights([Number.NaN, -3, 4], SCALE)).toEqual([2, 2, 32]);
  });

  it('gives equal counts equal bars', () => {
    const heights = miniBarHeights([3, 7, 3, 7], SCALE);
    expect(heights[0]).toBe(heights[2]);
    expect(heights[1]).toBe(heights[3]);
  });
});

describe('QR-02 milestone line (02_PRODUCT_SPEC §7)', () => {
  it('names the next milestone below the first', () => {
    expect(milestoneFor(0)).toEqual({ reached: null, next: 10 });
    expect(milestoneFor(9)).toEqual({ reached: null, next: 10 });
  });

  it('names the highest one reached and the next', () => {
    expect(milestoneFor(10)).toEqual({ reached: 10, next: 50 });
    expect(milestoneFor(128)).toEqual({ reached: 100, next: 500 });
  });

  it('has no next once the last is reached', () => {
    expect(milestoneFor(1000)).toEqual({ reached: 1000, next: null });
    expect(milestoneFor(54_321)).toEqual({ reached: 1000, next: null });
  });

  it('uses the milestones of the notification', () => {
    expect(QR_MILESTONES).toEqual([10, 50, 100, 500, 1000]);
  });
});

describe('QR-02 milestones from the server', () => {
  it('takes the highest of milestones_reached and the next above it', () => {
    expect(milestoneFor(128, [10, 50, 100])).toEqual({ reached: 100, next: 500 });
    expect(milestoneFor(3, [])).toEqual({ reached: null, next: 10 });
    expect(milestoneFor(1200, [10, 50, 100, 500, 1000])).toEqual({ reached: 1000, next: null });
  });

  it('ignores a value that is no milestone', () => {
    expect(milestoneFor(60, [10, 42, 50])).toEqual({ reached: 50, next: 100 });
  });
});
