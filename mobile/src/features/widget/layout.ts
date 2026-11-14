/**
 * Android widget "Mein Auto" (09 §8.14): the pure geometry and type of the widget, from tokens, so Jest covers every size the
 * launcher can give it (4 × 2 cells by default, resizable down to 250 × 110 dp) and every font scale. The panel's text is fitted
 * by width too (M4.19): on a 360 dp phone a 4 × 2 widget is about 260 dp wide, so the text column is only about 120 dp.
 *
 * The widget is a split card: the car's photo on the left (the 4:5 hero crop around the focal point, so a photo sits on its dark
 * stage in every theme, ADR-421 b), the name and the next due item on the theme's surface on the right. No text sits on the
 * photo, so the widget needs no scrim and keeps 4.5:1 on any photo.
 */
import { aspect, fonts, maxFontScale, space, typography } from '@/theme/tokens.generated';

import { estimatedWidth, wrappedLines, type WidgetFace } from './metrics';

/** The photo's share of the widget's width. */
export const PHOTO_SHARE = 0.42;
/** Inter roles grow with the system font size up to this, then the layout drops lines instead (a widget's box is fixed). */
export const MAX_WIDGET_FONT_SCALE = 2;

function ratio(value: string): number {
  const [w, h] = value.split(':').map(Number);
  return w && h ? w / h : 1;
}

/** 09 §4.6 hero crop (4:5): the photo file is cut to this, and the widget covers its pane with it. */
export const PHOTO_ASPECT = ratio(aspect.hero);

export type WidgetRole = 'displayWordmark' | 'labelCaps' | 'callout' | 'calloutStrong';

type Weight = '400' | '500' | '600' | '700';

export type WidgetTextStyle = {
  fontFamily: string;
  fontWeight: Weight;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
};

/** The weight of a token face: the widget's Typeface.create needs it, or Android draws the SemiBold file at 400 (API 28+). */
function weightOf(family: string): Weight {
  for (const group of Object.values(fonts)) {
    for (const [weight, name] of Object.entries(group.native)) {
      if (name === family) return weight as Weight;
    }
  }
  return '400';
}

/** The role's size at the system font scale: the car name caps like every display role (1.3), Inter roles at 2. */
export function textStyle(role: WidgetRole, fontScale: number): WidgetTextStyle {
  const token = typography[role];
  const cap = role === 'displayWordmark' ? maxFontScale.displayWordmark : MAX_WIDGET_FONT_SCALE;
  const scale = Math.min(Math.max(fontScale, 1), cap);
  return {
    fontFamily: token.fontFamily,
    fontWeight: weightOf(token.fontFamily),
    fontSize: Math.round(token.fontSize * scale),
    lineHeight: Math.round(token.lineHeight * scale),
    letterSpacing: token.letterSpacing * scale,
  };
}

/** What the panel says, already in its drawn case (the make and the due label in capitals). */
export type WidgetContent =
  | { kind: 'car'; name: string; eyebrow: string | null; due: { label: string; countdown: string } | null; quiet: string | null }
  | { kind: 'empty'; body: string; action: string };

/**
 * "two": the due item's label above its countdown; "one": both in one text; "quiet": the "nothing due" line; "none": no due line
 * (none to show, or no room).
 */
export type WidgetDue = 'two' | 'one' | 'quiet' | 'none';

export type WidgetLayout = {
  width: number;
  height: number;
  /** 0: no photo pane (the text needs the whole width, e.g. at 200 % on a small widget). */
  paneWidth: number;
  padding: number;
  /** The image's own size: it covers the pane at the photo's 4:5, so Android scales it without stretching, then crops. */
  image: { width: number; height: number };
  eyebrow: boolean;
  nameLines: number;
  due: WidgetDue;
  /** Lines of the countdown ("two"), of the joined item ("one") or of the quiet line ("quiet"). */
  dueLines: number;
  /** Empty state: lines of the invitation above the action (0: left out), and of the action itself. */
  bodyLines: number;
  actionLines: number;
  type: Record<WidgetRole, WidgetTextStyle>;
};

/** The photo's share of the width, tried in this order: the full pane, two narrower ones, then none. */
export const PHOTO_SHARES = [PHOTO_SHARE, 0.34, 0.26, 0] as const;
/** The car name takes at most two lines; the due line, the quiet line and the action as well; the invitation three. */
export const NAME_MAX_LINES = 2;
export const DUE_MAX_LINES = 2;
export const BODY_MAX_LINES = 3;

const FACE: Record<WidgetRole, WidgetFace> = {
  displayWordmark: 'wordmark',
  labelCaps: 'semibold',
  callout: 'medium',
  calloutStrong: 'semibold',
};

/** The size that covers a `width` × `height` box at the photo's aspect. */
export function coverSize(width: number, height: number, photoAspect: number = PHOTO_ASPECT): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  if (width / height > photoAspect) return { width: Math.ceil(width), height: Math.ceil(width / photoAspect) };
  return { width: Math.ceil(height * photoAspect), height: Math.ceil(height) };
}

type Fit = Omit<WidgetLayout, 'width' | 'height' | 'paneWidth' | 'padding' | 'image' | 'type'>;
type DueOption = { due: WidgetDue; dueLines: number; height: number };

/**
 * What fits the panel at this size and font scale, from the content's estimated line breaks (metrics.ts): nothing that is shown is
 * cut while a fitting arrangement exists. Given up in this order: the make above the name, the due item's own label line (it
 * joins the countdown), photo width (42 → 34 → 26 % → no photo), the name's full length (one line with an ellipsis), the due line.
 * The name always stays.
 */
export function widgetLayout(width: number, height: number, fontScale: number, content: WidgetContent): WidgetLayout {
  const type: Record<WidgetRole, WidgetTextStyle> = {
    displayWordmark: textStyle('displayWordmark', fontScale),
    labelCaps: textStyle('labelCaps', fontScale),
    callout: textStyle('callout', fontScale),
    calloutStrong: textStyle('calloutStrong', fontScale),
  };
  const padding = space[16];
  const gap = space[4];
  const between = space[8];
  const room = height - 2 * padding;
  const lines = (text: string, role: WidgetRole, column: number) =>
    wrappedLines(text, column, (part) => estimatedWidth(part, FACE[role], type[role].fontSize, type[role].letterSpacing));

  const arrange = (share: number, fit: Fit): WidgetLayout => {
    const paneWidth = Math.round(width * share);
    return { width, height, paneWidth, padding, image: coverSize(paneWidth, height), ...fit, type };
  };
  const columnAt = (share: number) => width - Math.round(width * share) - 2 * padding;

  if (content.kind === 'empty') {
    const actionHeight = (n: number) => n * type.calloutStrong.lineHeight;
    for (const share of PHOTO_SHARES) {
      const column = columnAt(share);
      const action = lines(content.action, 'calloutStrong', column);
      if (action > DUE_MAX_LINES || actionHeight(action) > room) continue;
      const body = lines(content.body, 'callout', column);
      const bodyFits = body <= BODY_MAX_LINES && body * type.callout.lineHeight + between + actionHeight(action) <= room;
      return arrange(share, { eyebrow: false, nameLines: 0, due: 'none', dueLines: 0, bodyLines: bodyFits ? body : 0, actionLines: action });
    }
    return arrange(0, { eyebrow: false, nameLines: 0, due: 'none', dueLines: 0, bodyLines: 0, actionLines: Math.max(1, Math.min(DUE_MAX_LINES, Math.floor(room / type.calloutStrong.lineHeight))) });
  }

  const nameLine = type.displayWordmark.lineHeight;
  const eyebrowHeight = type.labelCaps.lineHeight + gap;
  // A name that takes more than two lines even across the whole width is cut at two anyway: it never costs the photo.
  const longName = lines(content.name, 'displayWordmark', columnAt(0)) > NAME_MAX_LINES;

  const dueOptions = (column: number): DueOption[] => {
    const options: DueOption[] = [];
    if (content.due) {
      const countdown = lines(content.due.countdown, 'callout', column);
      if (lines(content.due.label, 'labelCaps', column) === 1 && countdown <= DUE_MAX_LINES) {
        options.push({ due: 'two', dueLines: countdown, height: type.labelCaps.lineHeight + gap + countdown * type.callout.lineHeight });
      }
      const joined = lines(`${content.due.label} ${content.due.countdown}`, 'callout', column);
      if (joined <= DUE_MAX_LINES) options.push({ due: 'one', dueLines: joined, height: joined * type.callout.lineHeight });
    } else if (content.quiet) {
      const quiet = lines(content.quiet, 'callout', column);
      if (quiet <= DUE_MAX_LINES) options.push({ due: 'quiet', dueLines: quiet, height: quiet * type.callout.lineHeight });
    }
    return options;
  };
  const hasDue = content.due !== null || content.quiet !== null;
  const blockOf = (option: DueOption | null) => (option ? between + option.height : 0);
  const fit = (eyebrow: boolean, nameLines: number, option: DueOption | null): Fit => ({
    eyebrow,
    nameLines,
    due: option?.due ?? 'none',
    dueLines: option?.dueLines ?? 0,
    bodyLines: 0,
    actionLines: 0,
  });

  // 1. Everything in full: the make, the name at its own length, the due item (two lines before one).
  for (const share of PHOTO_SHARES) {
    const column = columnAt(share);
    const name = lines(content.name, 'displayWordmark', column);
    if (name > NAME_MAX_LINES && !longName) continue;
    const nameLines = Math.min(name, NAME_MAX_LINES);
    const eyebrowFits = content.eyebrow !== null && lines(content.eyebrow, 'labelCaps', column) === 1;
    const options = hasDue ? dueOptions(column) : [null];
    for (const option of options) {
      for (const eyebrow of eyebrowFits ? [true, false] : [false]) {
        if ((eyebrow ? eyebrowHeight : 0) + nameLines * nameLine + blockOf(option) <= room) return arrange(share, fit(eyebrow, nameLines, option));
      }
    }
  }
  // 2. The name cut to one line, so the due line stays.
  if (hasDue) {
    for (const share of PHOTO_SHARES) {
      const option = dueOptions(columnAt(share)).find((candidate) => nameLine + blockOf(candidate) <= room);
      if (option) return arrange(share, fit(false, 1, option));
    }
  }
  // 3. No due line: the name alone, in full where it fits, else one cut line across the whole width.
  for (const share of PHOTO_SHARES) {
    const name = lines(content.name, 'displayWordmark', columnAt(share));
    const nameLines = Math.min(name, NAME_MAX_LINES);
    if ((name <= NAME_MAX_LINES || longName) && nameLines * nameLine <= room) return arrange(share, fit(false, nameLines, null));
  }
  return arrange(0, fit(false, 1, null));
}

/**
 * The crop of a `width` × `height` photo to `photoAspect` around its focal point (0–1, the centre without one): the widest box
 * of that aspect, moved as close to the focal point as the photo allows.
 */
export function focalCrop(
  width: number,
  height: number,
  focal: { x: number; y: number } | null,
  photoAspect: number = PHOTO_ASPECT,
): { originX: number; originY: number; width: number; height: number } {
  const fx = focal ? Math.min(1, Math.max(0, focal.x)) : 0.5;
  const fy = focal ? Math.min(1, Math.max(0, focal.y)) : 0.5;
  if (width / height > photoAspect) {
    const cropWidth = Math.round(height * photoAspect);
    const originX = Math.round(Math.min(width - cropWidth, Math.max(0, fx * width - cropWidth / 2)));
    return { originX, originY: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / photoAspect);
  const originY = Math.round(Math.min(height - cropHeight, Math.max(0, fy * height - cropHeight / 2)));
  return { originX: 0, originY, width, height: cropHeight };
}
