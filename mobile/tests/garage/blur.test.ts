import {
  addRegion,
  blurPayload,
  canAddRegion,
  DEFAULT_REGION,
  MAX_BLUR_REGIONS,
  MIN_REGION_SIDE,
  normaliseRegion,
  nudgeRegion,
  regionAt,
  regionFromDrag,
  removeRegion,
  type BlurRegion,
} from '@/features/garage/blur';

const STAGE = { width: 400, height: 300 };

describe('GAR-08 blur regions (sig.plate_blur)', () => {
  describe('drawing', () => {
    it('normalises a drag to 0–1 of the stage, in any direction', () => {
      expect(regionFromDrag({ x: 100, y: 150 }, { x: 300, y: 225 }, STAGE)).toEqual({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
      expect(regionFromDrag({ x: 300, y: 225 }, { x: 100, y: 150 }, STAGE)).toEqual({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
    });

    it('clips a drag that leaves the photo at its edges', () => {
      expect(regionFromDrag({ x: 300, y: 200 }, { x: 900, y: 900 }, STAGE)).toEqual({ x: 0.75, y: 0.6667, w: 0.25, h: 0.3333 });
      expect(regionFromDrag({ x: -50, y: -50 }, { x: 40, y: 30 }, STAGE)).toEqual({ x: 0, y: 0, w: 0.1, h: 0.1 });
    });

    it('ignores a slip of the finger and a stage that is not laid out', () => {
      expect(regionFromDrag({ x: 10, y: 10 }, { x: 13, y: 60 }, STAGE)).toBeNull();
      expect(regionFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { width: 0, height: 0 })).toBeNull();
    });
  });

  describe('normalisation', () => {
    it('keeps a region inside the photo and above the minimum size', () => {
      expect(normaliseRegion({ x: 0.9, y: 0.95, w: 0.3, h: 0.2 })).toEqual({ x: 0.7, y: 0.8, w: 0.3, h: 0.2 });
      expect(normaliseRegion({ x: -1, y: 2, w: 0, h: 5 })).toEqual({ x: 0, y: 0, w: MIN_REGION_SIDE, h: 1 });
      expect(normaliseRegion({ x: Number.NaN, y: 0.1, w: 0.2, h: 0.2 })).toEqual({ x: 0, y: 0.1, w: 0.2, h: 0.2 });
    });

    it('sends at most ten regions, each normalised', () => {
      const many: BlurRegion[] = Array.from({ length: 12 }, () => ({ x: 1.2, y: 0, w: 0.5, h: 0.1 }));
      const payload = blurPayload(many);
      expect(payload).toHaveLength(MAX_BLUR_REGIONS);
      expect(payload[0]).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.1 });
    });
  });

  describe('keyboard nudge', () => {
    const region = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };

    it('moves by 1 % per arrow and 5 % with Shift', () => {
      expect(nudgeRegion(region, 'ArrowRight')).toEqual({ x: 0.51, y: 0.5, w: 0.2, h: 0.1 });
      expect(nudgeRegion(region, 'ArrowUp', { fast: true })).toEqual({ x: 0.5, y: 0.45, w: 0.2, h: 0.1 });
    });

    it('resizes from the bottom right with Alt', () => {
      expect(nudgeRegion(region, 'ArrowRight', { resize: true })).toEqual({ x: 0.5, y: 0.5, w: 0.21, h: 0.1 });
      expect(nudgeRegion(region, 'ArrowUp', { resize: true, fast: true })).toEqual({ x: 0.5, y: 0.5, w: 0.2, h: 0.05 });
    });

    it('stops at the edges and at the minimum size', () => {
      expect(nudgeRegion({ x: 0.79, y: 0, w: 0.2, h: 0.1 }, 'ArrowRight', { fast: true })).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.1 });
      expect(nudgeRegion({ x: 0, y: 0, w: 0.2, h: 0.1 }, 'ArrowLeft')).toEqual({ x: 0, y: 0, w: 0.2, h: 0.1 });
      expect(nudgeRegion({ x: 0.1, y: 0.1, w: 0.02, h: 0.1 }, 'ArrowLeft', { resize: true })).toEqual({ x: 0.1, y: 0.1, w: MIN_REGION_SIDE, h: 0.1 });
      expect(nudgeRegion({ x: 0.7, y: 0.1, w: 0.29, h: 0.1 }, 'ArrowRight', { resize: true, fast: true })).toEqual({ x: 0.7, y: 0.1, w: 0.3, h: 0.1 });
    });
  });

  describe('the list', () => {
    it('adds up to ten regions and then refuses', () => {
      let regions: readonly BlurRegion[] = [];
      for (let index = 0; index < 12; index += 1) regions = addRegion(regions, DEFAULT_REGION);
      expect(regions).toHaveLength(MAX_BLUR_REGIONS);
      expect(canAddRegion(regions)).toBe(false);
      expect(canAddRegion(removeRegion(regions, 3))).toBe(true);
    });

    it('finds the region under a tap, the newest first', () => {
      const regions = [
        { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
      ];
      expect(regionAt(regions, { x: 0.35, y: 0.35 })).toBe(1);
      expect(regionAt(regions, { x: 0.15, y: 0.15 })).toBe(0);
      expect(regionAt(regions, { x: 0.9, y: 0.9 })).toBe(-1);
    });
  });
});
