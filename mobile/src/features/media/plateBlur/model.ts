/**
 * M5.9a "Kennzeichen unkenntlich machen" (10 §16.1, ADR-509, contract docs/reports/phase-5/m5.9a-contract.md §1): what the member
 * decides per photo before it is uploaded, and how it travels in the multipart form. Pure, so the upload queue, the outbox and
 * the screens share it. The geometry is GAR-08's (features/garage/blur.ts): normalised to the photo as the member sees it
 * (after EXIF orientation), 0 to 1 from its top left.
 */
import { clampAngle, MIN_REGION_SIDE, normaliseRegion, nudgeRegion, NUDGE_STEP, type BlurRegion, type NudgeKey, type Point } from '@/features/garage/blur';

export type { BlurRegion, NudgeKey, Point } from '@/features/garage/blur';
export { ANGLE_STEP, clampAngle, MAX_ANGLE } from '@/features/garage/blur';

/** A screen reader's "Nach links drehen" / "Nach rechts drehen" turns this many degrees. */
export const ANGLE_ACTION_STEP = 5;

/** The editor's stage in points: the photo as drawn. */
export type StageSize = { width: number; height: number };

/** Contract §1: 1–8 regions per upload (`PATCH media/{id}` of GAR-08 still takes 10). */
export const UPLOAD_MAX_REGIONS = 8;

/**
 * ADR-509: no on-device detection in Phase 5. One suggestion in the lower-centre third, where a rear or front plate sits in a
 * typical side-on or three-quarter shot; the member moves it.
 */
export const SUGGESTED_REGION: BlurRegion = { x: 0.32, y: 0.7, w: 0.36, h: 0.12 };

/** How far each added rectangle starts above the previous one, so a new one never hides under the last. */
const CASCADE_STEP = 0.14;
const CASCADE_SLOTS = 5;

/** The member's choice for one photo. `regions` stay while the switch is off, so switching it on again brings them back. */
export type PlateBlurChoice = { on: boolean; regions: readonly BlurRegion[] };

/** A photo picked for upload, with the choice made in the editor. */
export type WithPlateBlur<T> = T & { plateBlur?: PlateBlurChoice };

/** Default ON with the suggested rectangle (10 §16.1). */
export function defaultChoice(): PlateBlurChoice {
  return { on: true, regions: [SUGGESTED_REGION] };
}

/** Whether the server is asked to pixelate: on, with at least one region. */
export function blursAnything(choice: PlateBlurChoice): boolean {
  return choice.on && choice.regions.length > 0;
}

/** The switch. Switching on without a region brings the suggestion back. */
export function setBlur(choice: PlateBlurChoice, on: boolean): PlateBlurChoice {
  if (!on) return { ...choice, on: false };
  return { on: true, regions: choice.regions.length > 0 ? choice.regions : [SUGGESTED_REGION] };
}

/** The next rectangle "+ Rechteck" places: the suggestion, stepped up the photo for each one already there. */
export function nextRegion(count: number): BlurRegion {
  const slot = count % CASCADE_SLOTS;
  return normaliseRegion({ ...SUGGESTED_REGION, y: SUGGESTED_REGION.y - CASCADE_STEP * slot });
}

export function canAdd(choice: PlateBlurChoice): boolean {
  return choice.regions.length < UPLOAD_MAX_REGIONS;
}

/** "+ Rechteck": at most 8; adding also switches the blur on. */
export function addRegionTo(choice: PlateBlurChoice): PlateBlurChoice {
  if (!canAdd(choice)) return choice;
  return { on: true, regions: [...choice.regions, nextRegion(choice.regions.length)] };
}

/** Remove ×. Removing the last rectangle switches the blur off: there is nothing left to pixelate. */
export function removeRegionFrom(choice: PlateBlurChoice, index: number): PlateBlurChoice {
  if (index < 0 || index >= choice.regions.length) return choice;
  const regions = choice.regions.filter((_, at) => at !== index);
  return { on: regions.length > 0 ? choice.on : false, regions };
}

export function replaceRegionIn(choice: PlateBlurChoice, index: number, region: BlurRegion): PlateBlurChoice {
  if (index < 0 || index >= choice.regions.length) return choice;
  return { ...choice, regions: choice.regions.map((entry, at) => (at === index ? normaliseRegion(region) : entry)) };
}

/** A drag of the rectangle by a share of the photo: same size, stopped at the photo's edges. */
export function moveRegion(start: BlurRegion, dx: number, dy: number): BlurRegion {
  return normaliseRegion({ ...start, x: start.x + dx, y: start.y + dy });
}

/** A drag of the corner handle: the top left stays, the size stays between the minimum and the photo's edge. */
export function resizeRegion(start: BlurRegion, dw: number, dh: number): BlurRegion {
  const w = Math.min(1 - start.x, Math.max(MIN_REGION_SIDE, start.w + dw));
  const h = Math.min(1 - start.y, Math.max(MIN_REGION_SIDE, start.h + dh));
  return normaliseRegion({ ...start, w, h });
}

/** The rectangle's angle in degrees, 0 when it is not turned. */
export function angleOf(region: BlurRegion): number {
  return clampAngle(region.angle);
}

/** The slider, the turn handle and the screen reader actions: same place and size, the angle in whole degrees within ±45. */
export function turnRegion(region: BlurRegion, angle: number): BlurRegion {
  return normaliseRegion({ ...region, angle: clampAngle(angle) });
}

/** The rectangle's centre in stage points. */
export function regionCentre(region: BlurRegion, stage: StageSize): Point {
  return { x: (region.x + region.w / 2) * stage.width, y: (region.y + region.h / 2) * stage.height };
}

/** A point `local` in the rectangle's own frame (from its centre, unturned) turned by `angle` and placed on the stage. */
function turnPoint(centre: Point, local: Point, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: centre.x + local.x * cos - local.y * sin, y: centre.y + local.x * sin + local.y * cos };
}

/** Where the turn handle sits in stage points: `reach` above the middle of the top edge, turned with the rectangle. */
export function turnHandlePoint(region: BlurRegion, stage: StageSize, reach: number): Point {
  return turnPoint(regionCentre(region, stage), { x: 0, y: -(region.h * stage.height) / 2 - reach }, angleOf(region));
}

/** The angle a finger on the turn handle asks for: 0 straight above the centre, clockwise positive, within ±45. */
export function angleToward(centre: Point, pointer: Point): number {
  const degrees = (Math.atan2(pointer.x - centre.x, centre.y - pointer.y) * 180) / Math.PI;
  return clampAngle(degrees);
}

/**
 * A drag of the corner handle in stage points. Unturned: resizeRegion. Turned: the drag is read in the rectangle's own frame and
 * the opposite corner stays where it is on the photo, so the handle follows the finger along the turned edges.
 */
export function resizeTurned(start: BlurRegion, dx: number, dy: number, stage: StageSize): BlurRegion {
  const angle = angleOf(start);
  if (stage.width <= 0 || stage.height <= 0) return start;
  if (angle === 0) return resizeRegion(start, dx / stage.width, dy / stage.height);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const width = start.w * stage.width;
  const height = start.h * stage.height;
  const anchor = turnPoint(regionCentre(start, stage), { x: -width / 2, y: -height / 2 }, angle);
  const nextWidth = Math.min(stage.width, Math.max(MIN_REGION_SIDE * stage.width, width + dx * cos + dy * sin));
  const nextHeight = Math.min(stage.height, Math.max(MIN_REGION_SIDE * stage.height, height - dx * sin + dy * cos));
  const centre = turnPoint(anchor, { x: nextWidth / 2, y: nextHeight / 2 }, angle);
  return normaliseRegion({
    x: (centre.x - nextWidth / 2) / stage.width,
    y: (centre.y - nextHeight / 2) / stage.height,
    w: nextWidth / stage.width,
    h: nextHeight / stage.height,
    angle,
  });
}

/** "Größer" / "Kleiner" for a screen reader: one step on both sides, from the top left corner. */
export function scaleRegion(region: BlurRegion, direction: 1 | -1): BlurRegion {
  return resizeRegion(region, direction * NUDGE_STEP * 2, direction * NUDGE_STEP);
}

/** The modifier keys held with an arrow key. */
export type KeyModifiers = { shift?: boolean; alt?: boolean };

/**
 * Arrow keys on the web, one map for both blur tools (DQ-P5G-17, GAR-08's BlurTool): an arrow moves one step, Shift five steps,
 * Alt resizes (Right/Down larger, Left/Up smaller); Shift + Alt resizes in five steps.
 */
export function keyRegion(region: BlurRegion, key: NudgeKey, modifiers: KeyModifiers = {}): BlurRegion {
  return nudgeRegion(region, key, { fast: modifiers.shift === true, resize: modifiers.alt === true });
}

const PRECISION = 10_000;

/**
 * One region as the API takes it: rounded to 4 decimals and never past the right or bottom edge after rounding; `angle` only when
 * the rectangle is turned.
 */
function forApi(region: BlurRegion): BlurRegion {
  const { x, y, w, h, angle } = normaliseRegion(region);
  const fit = (start: number, side: number) => (start + side > 1 ? Math.floor((1 - side) * PRECISION) / PRECISION : start);
  const box = { x: fit(x, w), y: fit(y, h), w, h };
  return angle === undefined ? box : { ...box, angle };
}

/** The regions that go to the API: at most 8, each inside the photo. */
export function uploadRegions(choice: PlateBlurChoice): BlurRegion[] {
  return choice.regions.slice(0, UPLOAD_MAX_REGIONS).map(forApi);
}

/** The multipart fields of contract §1: `plate_blur` "1"/"0" and, when on, `blur_regions` as a JSON string. */
export function plateBlurFields(choice: PlateBlurChoice): { plate_blur: '1' | '0'; blur_regions?: string } {
  if (!blursAnything(choice)) return { plate_blur: '0' };
  return { plate_blur: '1', blur_regions: JSON.stringify(uploadRegions(choice)) };
}

/** Adds the fields to an upload form. Without a choice (a queue item stored by an older build) nothing is added. */
export function appendPlateBlur(form: FormData, choice: PlateBlurChoice | null | undefined): FormData {
  if (!choice) return form;
  const fields = plateBlurFields(choice);
  form.append('plate_blur', fields.plate_blur);
  if (fields.blur_regions !== undefined) form.append('blur_regions', fields.blur_regions);
  return form;
}

/** Splits a picked photo from its choice, for stores that keep the file and the choice apart. */
export function splitChoice<T extends object>(photo: WithPlateBlur<T>): { photo: T; plateBlur: PlateBlurChoice | undefined } {
  const { plateBlur, ...rest } = photo;
  return { photo: rest as T, plateBlur };
}
