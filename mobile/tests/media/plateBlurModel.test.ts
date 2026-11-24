import {
  addRegionTo,
  angleToward,
  resizeTurned,
  turnHandlePoint,
  turnRegion,
  appendPlateBlur,
  blursAnything,
  defaultChoice,
  keyRegion,
  moveRegion,
  plateBlurFields,
  removeRegionFrom,
  resizeRegion,
  scaleRegion,
  setBlur,
  splitChoice,
  SUGGESTED_REGION,
  UPLOAD_MAX_REGIONS,
  uploadRegions,
  type PlateBlurChoice,
} from '@/features/media/plateBlur/model';

import { partsOf } from './formParts';


describe('M5.9a plate blur model', () => {
  it('starts on, with the suggested rectangle of ADR-509 in the lower-centre third', () => {
    expect(defaultChoice()).toEqual({ on: true, regions: [{ x: 0.32, y: 0.7, w: 0.36, h: 0.12 }] });
    expect(SUGGESTED_REGION.y + SUGGESTED_REGION.h).toBeLessThanOrEqual(1);
    expect(blursAnything(defaultChoice())).toBe(true);
  });

  it('moves a rectangle by a share of the photo and stops it at every edge, keeping its size', () => {
    const start = { x: 0.32, y: 0.7, w: 0.36, h: 0.12 };
    expect(moveRegion(start, 0.1, -0.2)).toEqual({ x: 0.42, y: 0.5, w: 0.36, h: 0.12 });
    expect(moveRegion(start, 2, 2)).toEqual({ x: 0.64, y: 0.88, w: 0.36, h: 0.12 });
    expect(moveRegion(start, -2, -2)).toEqual({ x: 0, y: 0, w: 0.36, h: 0.12 });
  });

  it('resizes from the corner, never below 2 % and never past the photo', () => {
    const start = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };
    expect(resizeRegion(start, 0.1, 0.05)).toEqual({ x: 0.5, y: 0.5, w: 0.3, h: 0.15 });
    expect(resizeRegion(start, 5, 5)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(resizeRegion(start, -5, -5)).toEqual({ x: 0.5, y: 0.5, w: 0.02, h: 0.02 });
  });

  it('grows and shrinks in steps for screen readers, and Alt + arrows resize on the web', () => {
    const start = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    expect(scaleRegion(start, 1)).toEqual({ x: 0.1, y: 0.1, w: 0.22, h: 0.11 });
    expect(scaleRegion(start, -1)).toEqual({ x: 0.1, y: 0.1, w: 0.18, h: 0.09 });
    expect(keyRegion(start, 'ArrowRight')).toEqual({ x: 0.11, y: 0.1, w: 0.2, h: 0.1 });
    // DQ-P5G-17: GAR-08's map — Alt resizes, Shift goes five steps.
    expect(keyRegion(start, 'ArrowDown', { alt: true })).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.11 });
    const fast = keyRegion(start, 'ArrowRight', { shift: true });
    expect(fast.x).toBeCloseTo(0.15);
    expect([fast.y, fast.w, fast.h]).toEqual([0.1, 0.2, 0.1]);
  });

  it('adds up to 8 rectangles, each placed apart from the last, and adding switches the blur on', () => {
    let choice: PlateBlurChoice = { on: false, regions: [] };
    for (let index = 0; index < 12; index += 1) choice = addRegionTo(choice);
    expect(choice.regions).toHaveLength(UPLOAD_MAX_REGIONS);
    expect(choice.on).toBe(true);
    expect(choice.regions[0]).toEqual(SUGGESTED_REGION);
    expect(choice.regions[1]?.y).toBeLessThan(SUGGESTED_REGION.y);
  });

  it('removing the last rectangle switches the blur off; switching on again brings the suggestion back', () => {
    const off = removeRegionFrom(defaultChoice(), 0);
    expect(off).toEqual({ on: false, regions: [] });
    expect(blursAnything(off)).toBe(false);
    expect(setBlur(off, true)).toEqual(defaultChoice());
    const two = addRegionTo(defaultChoice());
    expect(removeRegionFrom(two, 1)).toEqual(defaultChoice());
  });

  it('keeps the rectangles while the switch is off, so on brings them back', () => {
    const moved = { on: true, regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] };
    const off = setBlur(moved, false);
    expect(off.on).toBe(false);
    expect(setBlur(off, true)).toEqual(moved);
  });

  it('serialises to the contract: "1" with a JSON string of at most 8 regions, or "0" without regions', () => {
    expect(plateBlurFields(defaultChoice())).toEqual({ plate_blur: '1', blur_regions: '[{"x":0.32,"y":0.7,"w":0.36,"h":0.12}]' });
    expect(plateBlurFields({ on: false, regions: [SUGGESTED_REGION] })).toEqual({ plate_blur: '0' });
    expect(plateBlurFields({ on: true, regions: [] })).toEqual({ plate_blur: '0' });
    const many = { on: true, regions: Array.from({ length: 10 }, () => SUGGESTED_REGION) };
    expect(uploadRegions(many)).toHaveLength(8);
  });

  it('never sends a region past the right or bottom edge after rounding to 4 decimals', () => {
    const [region] = uploadRegions({ on: true, regions: [{ x: 0.66667, y: 0.33333, w: 0.33337, h: 0.66669 }] });
    expect(region).toBeDefined();
    if (!region) return;
    expect(region.x + region.w).toBeLessThanOrEqual(1);
    expect(region.y + region.h).toBeLessThanOrEqual(1);
    for (const value of Object.values(region)) expect(Math.round(value * 10_000) / 10_000).toBe(value);
  });

  it('appends the multipart fields, and nothing for an item without a choice', () => {
    const on = appendPlateBlur(new FormData(), defaultChoice());
    expect(partsOf(on)).toEqual({ plate_blur: '1', blur_regions: '[{"x":0.32,"y":0.7,"w":0.36,"h":0.12}]' });
    const off = appendPlateBlur(new FormData(), { on: false, regions: [] });
    expect(partsOf(off)).toEqual({ plate_blur: '0' });
    expect(partsOf(appendPlateBlur(new FormData(), undefined))).toEqual({});
  });

  it('splits a reviewed pick into the file and its choice', () => {
    const { photo, plateBlur } = splitChoice({ uri: 'file:///a.jpg', width: 4, height: 3, plateBlur: defaultChoice() });
    expect(photo).toEqual({ uri: 'file:///a.jpg', width: 4, height: 3 });
    expect(plateBlur).toEqual(defaultChoice());
  });

  it('turns a rectangle in whole degrees within ±45 and keeps an unturned one as before', () => {
    const plate = { x: 0.32, y: 0.7, w: 0.36, h: 0.12 };
    expect(turnRegion(plate, 12.4)).toEqual({ ...plate, angle: 12 });
    expect(turnRegion(plate, -80)).toEqual({ ...plate, angle: -45 });
    expect(turnRegion({ ...plate, angle: 20 }, 0)).toEqual(plate);
    expect(moveRegion({ ...plate, angle: -10 }, 0.01, 0)).toEqual({ ...plate, x: 0.33, angle: -10 });
  });

  it('reads the turn handle from the centre: straight up is 0, clockwise positive, stopped at 45', () => {
    const centre = { x: 100, y: 100 };
    expect(angleToward(centre, { x: 100, y: 40 })).toBe(0);
    expect(angleToward(centre, { x: 130, y: 70 })).toBe(45);
    expect(angleToward(centre, { x: 90, y: 40 })).toBe(-9);
    expect(angleToward(centre, { x: 200, y: 200 })).toBe(45);
    const stage = { width: 400, height: 300 };
    const handle = turnHandlePoint({ x: 0.25, y: 0.4, w: 0.5, h: 0.2 }, stage, 30);
    expect(handle.x).toBeCloseTo(200);
    expect(handle.y).toBeCloseTo(150 - 30 - 30);
  });

  it('resizes a turned rectangle along its own sides and keeps the opposite corner in place', () => {
    const stage = { width: 400, height: 300 };
    const turned = { x: 0.25, y: 0.4, w: 0.5, h: 0.2, angle: 30 };
    // Along the turned width: 20 points at 30° is (17.32, 10) on the stage.
    const wider = resizeTurned(turned, 20 * Math.cos(Math.PI / 6), 20 * Math.sin(Math.PI / 6), stage);
    expect(wider.w * 400).toBeCloseTo(220, 0);
    expect(wider.h * 300).toBeCloseTo(60, 0);
    expect(wider.angle).toBe(30);
    const corner = (region: typeof turned) => {
      const cx = (region.x + region.w / 2) * 400;
      const cy = (region.y + region.h / 2) * 300;
      const [hw, hh] = [(region.w * 400) / 2, (region.h * 300) / 2];
      const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
      return { x: cx - hw * cos + hh * sin, y: cy - hw * sin - hh * cos };
    };
    expect(corner({ ...wider, angle: 30 }).x).toBeCloseTo(corner(turned).x, 0);
    expect(corner({ ...wider, angle: 30 }).y).toBeCloseTo(corner(turned).y, 0);
    // Unturned: the share-based resize as before.
    expect(resizeTurned({ x: 0.32, y: 0.7, w: 0.36, h: 0.12 }, 40, 15, stage)).toEqual({ x: 0.32, y: 0.7, w: 0.46, h: 0.17 });
  });

  it('sends the angle with the regions and leaves it out for a straight one', () => {
    expect(
      plateBlurFields({ on: true, regions: [{ x: 0.32, y: 0.7, w: 0.36, h: 0.12, angle: -12 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.1, angle: 0 }] }),
    ).toEqual({ plate_blur: '1', blur_regions: '[{"x":0.32,"y":0.7,"w":0.36,"h":0.12,"angle":-12},{"x":0.1,"y":0.1,"w":0.2,"h":0.1}]' });
  });
});
