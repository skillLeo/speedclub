/** R5-2e VEH-07 2.0: the crop of the card's photo as the server computes it, and the contract's photo box table. */
import {
  baseWindow,
  clampZoom,
  cropLayout,
  cropWindow,
  defaultCrop,
  normalizeCrop,
  nudgeCrop,
  panCrop,
  SHARE_CARD_PHOTO_BOX,
  SHARE_CARD_TEMPLATES,
  zoomCrop,
} from '@/features/vehicle/shareCardCrop';

/** A 4:3 landscape photo and a 4:5 portrait one, as members upload them. */
const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 1600, height: 2000 };

describe('the photo box table (12_CLIENT_ROUND_5, Pest asserts the same numbers)', () => {
  it('pins every template on both formats', () => {
    expect(SHARE_CARD_TEMPLATES).toEqual(['band', 'poster', 'frame']);
    expect(SHARE_CARD_PHOTO_BOX).toEqual({
      band: { square: { width: 1080, height: 600 }, story: { width: 1080, height: 1920 } },
      poster: { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } },
      frame: { square: { width: 984, height: 600 }, story: { width: 984, height: 1080 } },
    });
  });
});

describe('crop math', () => {
  const story = SHARE_CARD_PHOTO_BOX.band.story;
  const bandSquare = SHARE_CARD_PHOTO_BOX.band.square;

  it('zoom 1 is the largest window of the box aspect that fits the photo', () => {
    // 9:16 out of 4:3: the full height, 3000 × 9/16 wide.
    expect(baseWindow(LANDSCAPE, story)).toEqual({ width: 1687.5, height: 3000 });
    // 1080:600 out of 4:5: the full width.
    const wide = baseWindow(PORTRAIT, bandSquare);
    expect(wide.width).toBe(1600);
    expect(wide.height).toBeCloseTo(1600 * (600 / 1080), 6);
    // The story frame, 984:1080 out of 4:3: the full height.
    expect(baseWindow(LANDSCAPE, SHARE_CARD_PHOTO_BOX.frame.story).height).toBe(3000);
  });

  it('divides the window by the zoom, centres it at x, y and clamps it inside the photo', () => {
    const window = cropWindow(LANDSCAPE, story, { zoom: 2, x: 0.5, y: 0.5 });
    expect(window).toEqual({ left: 2000 - 421.875, top: 750, width: 843.75, height: 1500 });
    // A centre past the edge: the window stops at the photo's edge, it never shows outside the photo.
    expect(cropWindow(LANDSCAPE, story, { zoom: 2, x: 1, y: 0 })).toEqual({ left: 4000 - 843.75, top: 0, width: 843.75, height: 1500 });
    expect(cropWindow(LANDSCAPE, story, { zoom: 1, x: 0, y: 0.9 })).toEqual({ left: 0, top: 0, width: 1687.5, height: 3000 });
  });

  it('keeps zoom between 1 and 3, two decimals', () => {
    expect(clampZoom(0.4)).toBe(1);
    expect(clampZoom(7)).toBe(3);
    expect(clampZoom(1.23456)).toBe(1.23);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('normalises a crop to where its clamped window really is', () => {
    // At zoom 1 a 4:3 photo in a 9:16 box can only move sideways: y is the middle whatever was asked.
    expect(normalizeCrop(LANDSCAPE, story, { zoom: 1, x: 0.3, y: 0.1 })).toEqual({ zoom: 1, x: 0.3, y: 0.5 });
    expect(normalizeCrop(LANDSCAPE, story, { zoom: 1, x: 0, y: 0.5 })).toEqual({ zoom: 1, x: 0.211, y: 0.5 });
  });

  it('the default is zoom 1 around the focal point, else the centre', () => {
    expect(defaultCrop(LANDSCAPE, story, { x: 0.7, y: 0.4 })).toEqual({ zoom: 1, x: 0.7, y: 0.5 });
    expect(defaultCrop(LANDSCAPE, story, null)).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
    expect(defaultCrop(PORTRAIT, SHARE_CARD_PHOTO_BOX.poster.square, { x: null, y: null })).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
  });

  it('a drag moves the window against the finger, in view points', () => {
    // The view is 270 wide; at zoom 1 the window is 1687.5 px wide, so 1 point is 6.25 px.
    const moved = panCrop(LANDSCAPE, story, { zoom: 1, x: 0.5, y: 0.5 }, 40, 0, 270);
    // 2000 − 40 × 6.25 = 1750 px, 0.4375 of the photo, sent with three decimals.
    expect(moved.x).toBe(0.438);
    expect(moved.y).toBe(0.5);
    // Never past the edge.
    expect(panCrop(LANDSCAPE, story, { zoom: 1, x: 0.5, y: 0.5 }, 10_000, 0, 270).x).toBe(0.211);
  });

  it('zooms around the window centre and nudges by a share of the window', () => {
    expect(zoomCrop(LANDSCAPE, story, { zoom: 1, x: 0.3, y: 0.5 }, 2)).toEqual({ zoom: 2, x: 0.3, y: 0.5 });
    expect(zoomCrop(LANDSCAPE, story, { zoom: 2, x: 0.3, y: 0.5 }, 9).zoom).toBe(3);
    const nudged = nudgeCrop(LANDSCAPE, story, { zoom: 2, x: 0.5, y: 0.5 }, 0.05, -0.05);
    expect(nudged.x).toBeCloseTo(0.5 + (0.05 * 843.75) / 4000, 3);
    expect(nudged.y).toBeCloseTo(0.5 - (0.05 * 1500) / 3000, 3);
  });

  it('lays the photo out so that exactly the window fills the view', () => {
    const crop = { zoom: 2, x: 0.5, y: 0.5 };
    const placed = cropLayout(LANDSCAPE, story, crop, 270);
    const window = cropWindow(LANDSCAPE, story, crop);
    const scale = 270 / window.width;
    expect(placed.width).toBeCloseTo(4000 * scale, 6);
    expect(placed.translateX).toBeCloseTo(-window.left * scale, 6);
    // The window's right edge lands on the view's right edge, its bottom on the view's bottom (270 × 16/9 = 480).
    expect(placed.translateX + (window.left + window.width) * scale).toBeCloseTo(270, 6);
    expect(placed.translateY + (window.top + window.height) * scale).toBeCloseTo(480, 6);
  });
});
