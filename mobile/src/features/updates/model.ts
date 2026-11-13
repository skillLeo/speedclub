/**
 * Build updates 2.0 (09 §8.5): the pure parts of UPD-01 and VEH-05 — @mention editing, mention links in a text, before/after
 * pairs, the composer's validation. No React, so Jest covers them directly.
 */
import type { BuildUpdate, VehicleMedia } from '@/api/queries/vehicles';
import {
  MENTION_QUERY_MAX,
  UPDATE_PAIRS_MAX,
  UPDATE_PHOTO_LIMIT,
  UPDATE_TEXT_MAX,
} from '@/api/queries/social2';

/** A username character as the API allows them (letters, digits, `_` and `.`). */
const NAME_CHAR = /[A-Za-z0-9_.]/;

/**
 * The mention being typed at the caret: the `@` must start the text or follow whitespace or an opening bracket, and the caret
 * must sit inside the name. `null` when the caret is not in a mention.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const end = Math.max(0, Math.min(caret, text.length));
  let index = end - 1;
  while (index >= 0 && NAME_CHAR.test(text.charAt(index))) index -= 1;
  if (index < 0 || text.charAt(index) !== '@') return null;
  const before = index === 0 ? '' : text.charAt(index - 1);
  if (before !== '' && !/[\s([{"„]/.test(before)) return null;
  const query = text.slice(index + 1, end);
  if (query.length > MENTION_QUERY_MAX) return null;
  return { start: index, query };
}

/** Replaces the mention being typed with `@username ` and returns the new text and caret. */
export function insertMention(
  text: string,
  mention: { start: number; query: string },
  username: string,
): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  // A name already followed by more name characters (the caret sat in the middle) is replaced whole.
  let tail = end;
  while (tail < text.length && NAME_CHAR.test(text.charAt(tail))) tail += 1;
  const inserted = `@${username} `;
  const rest = text.slice(tail).replace(/^ /, '');
  return {
    text: `${text.slice(0, mention.start)}${inserted}${rest}`,
    caret: mention.start + inserted.length,
  };
}

export type TextSegment =
  { kind: 'text'; text: string } | { kind: 'mention'; text: string; username: string };

/**
 * Splits a post into plain text and links for the members the API resolved (`mentions`): only those are links; any other
 * "@name" stays plain text (ADR-436 b: a mention that was not allowed reads as text).
 */
export function mentionSegments(text: string, usernames: readonly string[]): TextSegment[] {
  if (usernames.length === 0 || !text.includes('@')) return text ? [{ kind: 'text', text }] : [];
  const known = new Map(usernames.map((name) => [name.toLowerCase(), name]));
  const segments: TextSegment[] = [];
  const pattern = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9_.]+)/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const raw = match[2] ?? '';
    // A trailing dot ends the sentence, not the name.
    const name = raw.replace(/\.+$/, '');
    const username = known.get(name.toLowerCase());
    if (!username) continue;
    const start = match.index + (match[1] ?? '').length;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'mention', text: `@${name}`, username });
    last = start + 1 + name.length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

export type PhotoPair = { before: VehicleMedia; after: VehicleMedia };

/** The update's before/after pairs whose two photos can both be shown, in the API's order. */
export function updatePairs(update: Pick<BuildUpdate, 'photos' | 'photo_pairs'>): PhotoPair[] {
  const shown = new Map(
    update.photos.filter((photo) => photo.variants.length > 0).map((photo) => [photo.id, photo]),
  );
  return update.photo_pairs.flatMap((pair) => {
    const before = shown.get(pair.before);
    const after = shown.get(pair.after);
    return before && after ? [{ before, after }] : [];
  });
}

/** Photos that are not part of a shown pair, with a file, in the owner's order. */
export function unpairedPhotos(update: Pick<BuildUpdate, 'photos' | 'photo_pairs'>): VehicleMedia[] {
  const paired = new Set(updatePairs(update).flatMap((pair) => [pair.before.id, pair.after.id]));
  return update.photos.filter((photo) => photo.variants.length > 0 && !paired.has(photo.id));
}

/** UPD-01 pairs by position in the picked list: tap before, then after. */
export type LocalPair = { before: number; after: number };

/** Adds `index` to the pair being built: the first tap is "before", the second closes the pair. Returns the new state. */
export function tapForPair(
  pairs: readonly LocalPair[],
  pending: number | null,
  index: number,
): { pairs: LocalPair[]; pending: number | null } {
  const inPair = pairs.find((pair) => pair.before === index || pair.after === index);
  if (inPair) return { pairs: pairs.filter((pair) => pair !== inPair), pending };
  if (pending === null)
    return { pairs: [...pairs], pending: pairs.length >= UPDATE_PAIRS_MAX ? null : index };
  if (pending === index) return { pairs: [...pairs], pending: null };
  return { pairs: [...pairs, { before: pending, after: index }], pending: null };
}

/** After a photo at `removed` leaves the list: pairs that used it go, later positions move up by one. */
export function pairsWithout(pairs: readonly LocalPair[], removed: number): LocalPair[] {
  const shift = (position: number) => (position > removed ? position - 1 : position);
  return pairs
    .filter((pair) => pair.before !== removed && pair.after !== removed)
    .map((pair) => ({ before: shift(pair.before), after: shift(pair.after) }));
}

/** "12.400" → 12400; empty → null; anything else (letters, > 2,000,000, negative) → undefined (invalid). */
export function parseMileage(raw: string): number | null | undefined {
  const compact = raw.replace(/[\s.,  ]/g, '');
  if (compact === '') return null;
  if (!/^\d+$/.test(compact)) return undefined;
  const value = Number(compact);
  return value <= 2_000_000 ? value : undefined;
}

/** "14.06.2026" or "2026-06-14" → "2026-06-14"; empty → null; anything else → undefined. */
export function parseDay(raw: string): string | null | undefined {
  const value = raw.trim();
  if (value === '') return null;
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (german) {
    [day, month, year] = [Number(german[1]), Number(german[2]), Number(german[3])];
  } else if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today in local time as "TT.MM.JJJJ", the composer's default date. */
export function todayGerman(now: Date = new Date()): string {
  return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
}

/** Local "YYYY-MM-DD" of `now`, for the future-date check. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export type ComposerIssue = 'empty' | 'textTooLong' | 'mileageInvalid' | 'dateInvalid' | 'dateFuture';

/** What stops "Posten": a post needs text or a photo; the rest is checked like the API does (422 rules of 09 §8.5). */
export function composerIssues(
  input: { text: string; photoCount: number; mileage: string; date: string },
  today: string = localDay(),
): Partial<Record<'text' | 'mileage' | 'date', ComposerIssue>> {
  const issues: Partial<Record<'text' | 'mileage' | 'date', ComposerIssue>> = {};
  const text = input.text.trim();
  if (text.length > UPDATE_TEXT_MAX) issues.text = 'textTooLong';
  else if (text === '' && input.photoCount === 0) issues.text = 'empty';
  if (parseMileage(input.mileage) === undefined) issues.mileage = 'mileageInvalid';
  const day = parseDay(input.date);
  if (day === undefined) issues.date = 'dateInvalid';
  else if (day !== null && day > today) issues.date = 'dateFuture';
  return issues;
}

export const COMPOSER_PHOTO_LIMIT = UPDATE_PHOTO_LIMIT;

/** The API's pairs as media id pairs, from the local positions and the uploaded ids (missing uploads drop their pair). */
export function pairsByMedia(pairs: readonly LocalPair[], mediaIds: readonly (string | null)[]): string[][] {
  return pairs.flatMap((pair) => {
    const before = mediaIds[pair.before];
    const after = mediaIds[pair.after];
    return before && after ? [[before, after]] : [];
  });
}
