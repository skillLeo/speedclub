/**
 * The faces tokens.json names (09 §4.2, ADR-402), by PostScript name, which is also the file name: the list app.config.ts
 * embeds on native, the families the member web loads, and the lookup Text uses for a web style.
 */
import { fonts, typography } from './tokens.generated';

export type FontGroup = keyof typeof fonts;

export type FontFace = { face: string; group: FontGroup; weight: number };

/** ui (Inter), uiDisplay (Inter Display), numeral (Archivo Condensed), marque (Archivo SemiExpanded). */
export const fontGroups = Object.keys(fonts) as FontGroup[];

/** Every face tokens.json names, in token order: the faces app.config.ts embeds. */
export const fontFaces: readonly FontFace[] = fontGroups.flatMap((group) =>
  Object.entries(fonts[group].native as Record<string, string>).map(([weight, face]) => ({ face, group, weight: Number(weight) })),
);

const byFace = new Map(fontFaces.map((entry) => [entry.face, entry]));

/** The group and weight of a face, from its PostScript name. */
export function faceOf(face: string): FontFace | undefined {
  return byFace.get(face);
}

/** The family a group's CSS stack starts with, unquoted: `Inter`, `Inter Display`, `Archivo Condensed`, `Archivo SemiExpanded`. */
export function cssFamily(group: FontGroup): string {
  return fonts[group].css.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
}

/** The faces the type scale uses. Web loads only these; the others are embedded on native for later roles. */
export const typeScaleFaces: readonly string[] = [
  ...new Set(Object.values(typography as Record<string, { fontFamily: string }>).map((style) => style.fontFamily)),
];

