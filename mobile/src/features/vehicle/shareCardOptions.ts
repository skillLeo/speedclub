/**
 * CF-6 (client round 1, VEH-07) and R5-2e (VEH-07 2.0, 12_CLIENT_ROUND_5 "share card contract"): what the member chooses for a share
 * card, and the request it makes. The default card (the `band` template, the cover around its focal point, every default element the
 * build has, the dark theme, no own line) is the stored PNG at `share_card_url`; any other choice has no stored file and is drawn by
 * `GET vehicles/{id}/share-card.png` with these options (ShareCardRequest), privately, for this viewer only.
 */
import { z } from 'zod';

import type { ShareCardFormat } from '@/api/queries/signature';
import type { components } from '@/api/schema';

import {
  defaultCrop,
  normalizeCrop,
  sameCrop,
  SHARE_CARD_PHOTO_BOX,
  type ShareCardCrop,
  type ShareCardTemplate,
  type Size,
} from './shareCardCrop';

export { SHARE_CARD_TEMPLATES, type ShareCardCrop, type ShareCardTemplate } from './shareCardCrop';

export type ShareCardElement = components['schemas']['ShareCardElement'];
export type ShareCardTheme = components['schemas']['ShareCardTheme'];
type Media = components['schemas']['MediaResource'];

/** The server's order (ShareCardOptions::ELEMENTS), which the chips follow. */
export const SHARE_CARD_ELEMENTS: readonly ShareCardElement[] = ['score', 'dex', 'specs', 'mods', 'username', 'qr'];
/** What the stored card shows (ShareCardOptions::DEFAULT_SHOW): `mods` is off until the member turns it on. */
export const SHARE_CARD_DEFAULT_SHOW: readonly ShareCardElement[] = ['score', 'dex', 'specs', 'username', 'qr'];
export const SHARE_CARD_THEMES: readonly ShareCardTheme[] = ['dark', 'light'];
/** The member's own line: at most this many characters after trim (ShareCardOptions::TEXT_MAX). */
export const SHARE_CARD_TEXT_MAX = 60;

/**
 * What the card fonts cover (the contract): printable Basic Latin, Latin-1, Latin Extended-A and the typographic marks `–—„“”‚‘’…·•`.
 * Anything else (emoji, control characters, line breaks) the server refuses with 422 on `text`; the field says so before it asks.
 */
const CARD_TEXT = /^[ -~ -ſ–—„“”‚‘’…·•]*$/u;

/** Zod schema of the own line; the messages are i18n keys of the `vehicle` namespace. */
export const shareCardTextSchema = z
  .string()
  .refine((value) => CARD_TEXT.test(value), { message: 'shareCard.textChars' })
  .refine((value) => [...value.trim()].length <= SHARE_CARD_TEXT_MAX, { message: 'shareCard.textLong' });

/** The i18n key of what is wrong with the own line, or null. */
export function shareCardTextProblem(text: string): string | null {
  const result = shareCardTextSchema.safeParse(text);
  return result.success ? null : (result.error.issues[0]?.message ?? 'shareCard.textChars');
}

export type ShareCardOptions = {
  format: ShareCardFormat;
  template: ShareCardTemplate;
  /** A media id of one of the build's ready photos; null is the cover. */
  photo: string | null;
  /** The member's crop; null is the server's default (zoom 1 around the focal point). */
  crop: ShareCardCrop | null;
  /** What the card shows besides the photo, the make and the model. */
  show: readonly ShareCardElement[];
  /** Where the template takes one (square band, both frame formats). */
  theme: ShareCardTheme;
  /** The member's own line, as typed (it is trimmed for the request). */
  text: string;
};

/** What the build can put on a card, and the photos it can draw from. */
export type ShareCardChoices = {
  elements: readonly ShareCardElement[];
  photos: readonly Media[];
  coverId: string | null;
};

type ModRow = { status: string };

/** The parts of a build the choices are read from (its public page, or the owner's copy of it). */
export type ShareCardSource = {
  build_score: { total: number; stage: number } | null;
  dex_number: number | null;
  spec_strip: readonly { value: string | null }[];
  /** The public mods (PublicVehicleResource `mods`); planned rows are not part of the build. */
  mods?: { count: number; groups: readonly { items: readonly ModRow[] }[] } | null;
  owner: { username: string | null } | null;
  is_owner: boolean;
  cover: Media | null;
  photos: readonly Media[];
};

function hasBuiltMods(source: ShareCardSource): boolean {
  return (source.mods?.groups ?? []).some((group) => group.items.some((item) => item.status !== 'planned'));
}

/**
 * Only what the card would draw: the Build Score and the Dex number when the build has them, the data line when a spec is entered,
 * the mods line when a part is fitted, the @username when the owner shows themselves (ADR-148 a: the page has no owner then for
 * anybody else; the owner's own page always names them, so their setting decides), and the QR code of the build's page, which every
 * card can carry.
 */
export function shareCardChoices(source: ShareCardSource | null, ownerShowsThemselves: boolean | null): ShareCardChoices {
  if (!source) return { elements: ['qr'], photos: [], coverId: null };
  const elements = SHARE_CARD_ELEMENTS.filter((element) => {
    switch (element) {
      case 'score':
        return source.build_score !== null;
      case 'dex':
        return source.dex_number !== null;
      case 'specs':
        return source.spec_strip.some((entry) => entry.value !== null);
      case 'mods':
        return hasBuiltMods(source);
      case 'username':
        return Boolean(source.owner?.username) && (!source.is_owner || ownerShowsThemselves !== false);
      default:
        return true;
    }
  });
  const ready = (media: Media) => media.status === 'ready' && media.variants.length > 0;
  const cover = source.cover && ready(source.cover) ? source.cover : null;
  const photos = [...(cover ? [cover] : []), ...source.photos.filter((media) => ready(media) && media.id !== cover?.id)];
  return { elements, photos, coverId: cover?.id ?? null };
}

/**
 * The stored card's options. `show` names every default element: what the build lacks is drawn as nothing anyway, and the choices
 * may still grow (the owner's settings arrive after the page), which must not turn the default into a custom card.
 */
export function defaultShareCardOptions(format: ShareCardFormat): ShareCardOptions {
  return { format, template: 'band', photo: null, crop: null, show: SHARE_CARD_DEFAULT_SHOW, theme: 'dark', text: '' };
}

/** Whether `theme` changes this template on this format (ShareCardTemplate::takesTheme). */
export function templateTakesTheme(template: ShareCardTemplate, format: ShareCardFormat): boolean {
  return template === 'frame' || (template === 'band' && format === 'square');
}

/** The photo box of the template on this format: the aspect the crop shows. */
export function photoBoxOf(options: Pick<ShareCardOptions, 'template' | 'format'>): Size {
  return SHARE_CARD_PHOTO_BOX[options.template][options.format];
}

/** The photo the card draws (the chosen one, else the cover). */
export function chosenMedia(options: ShareCardOptions, choices: ShareCardChoices): Media | null {
  const id = options.photo ?? choices.coverId;
  return choices.photos.find((media) => media.id === id) ?? null;
}

/** Pixel size of a photo, null while unknown (then there is nothing to crop). */
export function photoSizeOf(media: Media | null): Size | null {
  return media && media.width && media.height ? { width: media.width, height: media.height } : null;
}

function focalOf(media: Media): { x: number | null; y: number | null } {
  return { x: media.focal_x, y: media.focal_y };
}

/** The crop the card draws, normalised, and whether it is the server's default; null without a photo of known size. */
export function effectiveCrop(options: ShareCardOptions, choices: ShareCardChoices): { crop: ShareCardCrop; isDefault: boolean } | null {
  const media = chosenMedia(options, choices);
  const size = photoSizeOf(media);
  if (!media || !size) return null;
  const box = photoBoxOf(options);
  const fallback = defaultCrop(size, box, focalOf(media));
  if (options.crop === null) return { crop: fallback, isDefault: true };
  const crop = normalizeCrop(size, box, options.crop);
  return { crop, isDefault: sameCrop(crop, fallback) };
}

function chosenPhoto(options: ShareCardOptions, choices: ShareCardChoices): string | null {
  return options.photo === null || options.photo === choices.coverId ? null : options.photo;
}

/** The elements of the build that are switched on, in the server's order. */
function shownElements(options: ShareCardOptions, choices: ShareCardChoices): ShareCardElement[] {
  return choices.elements.filter((element) => options.show.includes(element));
}

function defaultShown(choices: ShareCardChoices): ShareCardElement[] {
  return choices.elements.filter((element) => SHARE_CARD_DEFAULT_SHOW.includes(element));
}

function sameElements(a: readonly ShareCardElement[], b: readonly ShareCardElement[]): boolean {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

/** The own line as it is sent: trimmed, and only when the server can draw it. */
export function cardText(options: ShareCardOptions): string | null {
  const text = options.text.trim();
  return text !== '' && shareCardTextProblem(options.text) === null ? text : null;
}

function themeDiffers(options: ShareCardOptions): boolean {
  return templateTakesTheme(options.template, options.format) && options.theme !== 'dark';
}

/**
 * Whether these options draw the stored card: `band`, the cover around its focal point, the default elements the build has (no
 * mods), the dark theme where the template takes one, and no own line the card can carry (a line the field refuses is not sent, so
 * it draws nothing new either).
 */
export function isDefaultShareCard(options: ShareCardOptions, choices: ShareCardChoices): boolean {
  return (
    options.template === 'band' &&
    chosenPhoto(options, choices) === null &&
    (effectiveCrop(options, choices)?.isDefault ?? true) &&
    sameElements(shownElements(options, choices), defaultShown(choices)) &&
    !themeDiffers(options) &&
    cardText(options) === null
  );
}

/**
 * The query of `GET vehicles/{id}/share-card.png`: the format always, then only what differs from the default. `show` goes
 * comma-separated, so "nothing" is an empty `show=` (ShareCardRequest); `theme` only where the template takes one; `zoom` two
 * decimals, `x` and `y` three, and only for a crop the member moved.
 */
export function shareCardSearch(options: ShareCardOptions, choices: ShareCardChoices): string {
  const params = new URLSearchParams({ format: options.format });
  if (options.template !== 'band') params.set('template', options.template);
  if (themeDiffers(options)) params.set('theme', options.theme);
  const photo = chosenPhoto(options, choices);
  if (photo !== null) params.set('photo', photo);
  const crop = effectiveCrop(options, choices);
  if (crop && !crop.isDefault) {
    if (crop.crop.zoom !== 1) params.set('zoom', crop.crop.zoom.toFixed(2));
    params.set('x', String(crop.crop.x));
    params.set('y', String(crop.crop.y));
  }
  const shown = shownElements(options, choices);
  if (!sameElements(shown, defaultShown(choices))) params.set('show', shown.join(','));
  const text = cardText(options);
  if (text !== null) params.set('text', text);
  return params.toString();
}

/** Switches one element on or off, keeping the server's order. */
export function toggleShareCardElement(options: ShareCardOptions, element: ShareCardElement): ShareCardOptions {
  const on = options.show.includes(element);
  const show = SHARE_CARD_ELEMENTS.filter((item) => (item === element ? !on : options.show.includes(item)));
  return { ...options, show };
}

/** Another photo starts from its own default crop. */
export function withPhoto(options: ShareCardOptions, photo: string | null): ShareCardOptions {
  return { ...options, photo, crop: null };
}

/** Back to the stored card, keeping the format the member is looking at. */
export function resetShareCard(options: ShareCardOptions): ShareCardOptions {
  return defaultShareCardOptions(options.format);
}
