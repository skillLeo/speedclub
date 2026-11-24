/**
 * "am Auto" (10 §2.3): the sticker on three real, licensed car photos (design/seed-photos/CREDITS.md, Unsplash License). The app bundles
 * metadata-free 4:5 crops around the spot at the originals' full resolution (`mobile/assets/gallery/*-mockup.jpg`, DQ-M54-05: a frame
 * never upscales the photo); the thumbhashes are computed from those crops. No crop shows a plate.
 *
 * Each photo names where a sticker sits (`spot`, the sticker's centre, 0–1 of the photo) and how wide the photo is in real
 * millimetres at that spot (`photoWidthMm`, from the rear window: about 1 m wide on these hatchbacks), so the sticker is drawn at
 * its real size relative to the car. The view shows a 4:5 crop around the spot (`cropWidth`, a share of the photo's width).
 */
import type { PhotoFields } from '@/ui/Photo';

export type MockupKey = 'day' | 'evening' | 'lightPaint';

export type Mockup = {
  key: MockupKey;
  photo: PhotoFields & { source: number };
  /** Pixel size of the bundled file. */
  width: number;
  height: number;
  spot: { x: number; y: number };
  photoWidthMm: number;
  cropWidth: number;
  /** What the sticker sits on: white inks need dark glass, black ink light paint (contract §2 substrates). */
  substrate: 'darkGlass' | 'lightPaint';
};

export const MOCKUPS: readonly Mockup[] = [
  {
    key: 'day',
    // Audi RS3 Sportback 8Y, tinted rear window in daylight (Swansway Motor Group, Unsplash): a 4:5 crop at full resolution.
    photo: {
      source: require('@/assets/gallery/audi-rs3-8y-04-mockup.jpg') as number,
      thumbhash: 'GKcVPgh4dweIh4iHiXmIiHeYd4+H9Vc=',
      focal: { x: 0.677, y: 0.5 },
    },
    width: 992,
    height: 1240,
    spot: { x: 0.677, y: 0.5 },
    photoWidthMm: 1631,
    cropWidth: 0.677,
    substrate: 'darkGlass',
  },
  {
    key: 'evening',
    // Mercedes-AMG A 45 S W177, rear window at dusk (Mathew Antony, Unsplash): a 4:5 crop at full resolution.
    photo: {
      source: require('@/assets/gallery/mercedes-w177-03-mockup.jpg') as number,
      thumbhash: 'y/cFDgJ/qDh0eGd2mIx1dpmYX2PbAdY=',
      focal: { x: 0.5, y: 0.5 },
    },
    width: 836,
    height: 1045,
    spot: { x: 0.5, y: 0.5 },
    photoWidthMm: 1401,
    cropWidth: 0.806,
    substrate: 'darkGlass',
  },
  {
    key: 'lightPaint',
    // Nissan 350Z, white rear panel under the tail light (Pacha Shot's, Unsplash): a 4:5 crop at full resolution.
    photo: {
      source: require('@/assets/gallery/nissan-z33-04-mockup.jpg') as number,
      thumbhash: '6gcODgK7aKaHhwd6eGt1l8ZnB55o0Gg=',
      focal: { x: 0.613, y: 0.5 },
    },
    width: 992,
    height: 1240,
    spot: { x: 0.613, y: 0.5 },
    photoWidthMm: 1364,
    cropWidth: 0.677,
    substrate: 'lightPaint',
  },
];

export function mockupFor(key: MockupKey): Mockup {
  return MOCKUPS.find((entry) => entry.key === key) ?? (MOCKUPS[0] as Mockup);
}

/** The photo that fits the colourway: dark glass for white inks, light paint for black ink. */
export function defaultMockup(colourway: 'white' | 'black' | 'white_red'): MockupKey {
  return colourway === 'black' ? 'lightPaint' : 'day';
}

/** The frame's aspect (09 §6 hero on phones). */
export const MOCKUP_ASPECT = 4 / 5;

export type MockupLayout = {
  /** The photo drawn behind the frame: its size and offset inside the frame. */
  photo: { width: number; height: number; left: number; top: number };
  /** The sticker's box inside the frame. */
  sticker: { width: number; height: number; left: number; top: number };
};

/**
 * Where photo and sticker sit in a frame `frameWidth` wide (height by MOCKUP_ASPECT): the photo scaled so `cropWidth` of it fills
 * the frame, the spot centred and the crop kept inside the photo; the sticker at its real size against `photoWidthMm`, never wider
 * than the frame minus a margin (a 480 mm banner on a small crop).
 */
export function mockupLayout(mockup: Mockup, frameWidth: number, sticker: { widthMm: number; heightMm: number }, margin: number): MockupLayout {
  const frameHeight = frameWidth / MOCKUP_ASPECT;
  const photoWidth = frameWidth / mockup.cropWidth;
  const photoHeight = (photoWidth * mockup.height) / mockup.width;
  const centreX = mockup.spot.x * photoWidth;
  const centreY = mockup.spot.y * photoHeight;
  const left = Math.min(0, Math.max(frameWidth - photoWidth, frameWidth / 2 - centreX));
  const top = Math.min(0, Math.max(frameHeight - photoHeight, frameHeight / 2 - centreY));
  const pxPerMm = photoWidth / mockup.photoWidthMm;
  let width = sticker.widthMm * pxPerMm;
  let height = sticker.heightMm * pxPerMm;
  const maxWidth = frameWidth - 2 * margin;
  const maxHeight = frameHeight - 2 * margin;
  const fit = Math.min(1, maxWidth / width, maxHeight / height);
  width *= fit;
  height *= fit;
  return {
    photo: { width: photoWidth, height: photoHeight, left, top },
    sticker: {
      width,
      height,
      left: Math.min(frameWidth - margin - width, Math.max(margin, left + centreX - width / 2)),
      top: Math.min(frameHeight - margin - height, Math.max(margin, top + centreY - height / 2)),
    },
  };
}
