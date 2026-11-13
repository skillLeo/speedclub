/**
 * A12 (M4.1 fix round 8, "Meldunge / n" at desktop 200 %): the settings side pane is 280 wide (FS-12), and at a large font its
 * text column became narrower than a single word ("Meldungen" at 32 needs 170, the row left it 155), so the browser broke the
 * word between two letters. The pane now grows with the font scale: never narrower than 280, and at least as wide as the
 * longest word of any of its labels needs at the size it is drawn, plus the row's own chrome. The layout gives way, never the
 * label: no truncation, and no hyphenation rule is loosened.
 *
 * The width of a word is estimated in the text's own units (letters × size × WORD_ADVANCE), so the pane has its width on the
 * first frame and never jumps after a measurement. tests/settings/paneWidth.test.ts proves with the shipped Inter metrics that
 * every label word of both locales fits its column at desktop 1280 and 1440, font scale 1 and 2.
 */
import { layout, size, space, type TypeVariant } from '@/theme';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';
import { typeStyle } from '@/ui/Text';

import { groupHasTitle, ROW_SUBTITLES, visibleGroups } from './navigation';

/** The pane's scroll content sits 16 inside the pane (SettingsSplit `paneContent`), and its title 16 inside too. */
export const PANE_PADDING = space[16];
/** The rows of the settings sit 16 inside their card (ValueRow ROW_INSET), a group title and the centred row too. */
const ROW_SIDE = space[16];

/**
 * An upper bound of the average advance of a German or English word in Inter, in em: the shipped faces give 0.46–0.59 for the
 * pane's words ("Meldungen" 0.59, "Erscheinungsbild" 0.51). The title threshold in Text.tsx uses the same bound.
 */
export const WORD_ADVANCE = 0.6;

/** Where a label sits in the pane, which decides the chrome beside its text column. */
export type PanePlace =
  /** A list row: icon 20 and its 12 gap before the text, the 12 gap and the 16 chevron after it (ListRow). */
  | 'row'
  /** The pane title, a group title or the centred "Abmelden": text between two side paddings. */
  | 'line';

export type PaneLabel = { text: string; variant: TypeVariant; place: PanePlace };

/** Everything in a pane row or line that is not text: the pane padding, the row's sides, and a row's icon and chevron. */
export function paneChrome(place: PanePlace): number {
  const sides = 2 * PANE_PADDING + 2 * ROW_SIDE;
  if (place === 'line') return sides;
  return sides + size.icon.m + space[12] + space[12] + size.icon.s;
}

/**
 * The runs of a label that a line can only break inside of: split at plain white space and after a hard hyphen
 * ("Zwei-Faktor-Schutz" breaks after each "-"). A no-break space or a word joiner keeps a run together.
 */
export function paneWords(text: string): string[] {
  return text
    .split(/[ \t\n]+/)
    .flatMap((word) => word.split(/(?<=[-‐])(?!⁠)/))
    .filter((word) => word !== '');
}

/** The size a role is drawn at: its desktop size on the web desktop, times the font scale up to the role's cap. */
export function drawnSize(variant: TypeVariant, fontScale: number, desktop: boolean): number {
  return typeStyle(variant, fontScale, 'web', true, desktop).fontSize ?? 0;
}

/** The estimated one-line width of a word at `fontSize`. */
export function wordWidth(word: string, fontSize: number): number {
  return [...word].length * fontSize * WORD_ADVANCE;
}

/**
 * The pane's width: layout.settingsPane, or wider when a label's longest word would not fit its text column at this font
 * scale. `border` is the pane's right border, which the content box loses.
 */
export function settingsPaneWidth(labels: readonly PaneLabel[], fontScale: number, desktop: boolean, border: number = size.border.control): number {
  let needed = 0;
  for (const { text, variant, place } of labels) {
    const fontSize = drawnSize(variant, fontScale, desktop);
    const widest = Math.max(0, ...paneWords(text).map((word) => wordWidth(word, fontSize)));
    needed = Math.max(needed, paneChrome(place) + widest + border);
  }
  return Math.max(layout.settingsPane, Math.ceil(needed));
}

/** The pane title's role (SettingsSplit) and the group titles' role (RowGroup), so the labels below cannot drift from them. */
export const PANE_TITLE_ROLE = 'headline' as const satisfies TypeVariant;
export const PANE_GROUP_ROLE = SECTION_HEADER_ROLE;

/** A translation of the `settings` namespace. */
type Translate = (key: string, options?: Record<string, string>) => string;

const APPEARANCE_OPTIONS = ['carbon', 'black', 'light', 'system'] as const;
const LANGUAGE_NAMES = ['de', 'en'] as const;

/**
 * Every label the pane can show for this visitor, in the role it is drawn in: the pane title, the group titles, the rows'
 * titles and subtitles, the values a row can show (under its title from a large font on, so in the row's text column), the
 * version and "Abmelden". A username is left out: it is the member's own handle, which breaks after its "." and "_".
 */
export function settingsPaneLabels(t: Translate, member: boolean, version: { version: string; build: string }): PaneLabel[] {
  const labels: PaneLabel[] = [{ text: t('title'), variant: PANE_TITLE_ROLE, place: 'line' }];
  const groups = visibleGroups(member);
  for (const group of groups) {
    if (groupHasTitle(group.key)) labels.push({ text: t(`groups.${group.key}`), variant: PANE_GROUP_ROLE, place: 'line' });
    for (const entry of group.rows) {
      // The identity card shows the member's name (left out, as the handle is) and its caption.
      if (entry.key === 'account') {
        labels.push({ text: t('identity.caption'), variant: 'caption', place: 'row' });
        continue;
      }
      labels.push({ text: t(`rows.${entry.key}`), variant: 'body', place: 'row' });
      const subtitle = ROW_SUBTITLES[entry.key];
      if (subtitle) labels.push({ text: t(subtitle), variant: 'callout', place: 'row' });
    }
  }
  const values = [
    t('rows.on'),
    t('rows.off'),
    ...APPEARANCE_OPTIONS.map((option) => t(`appearance.short.${option}`)),
    ...LANGUAGE_NAMES.map((name) => t(`language.names.${name}`)),
    t('version', version),
  ];
  for (const value of values) labels.push({ text: value, variant: 'callout', place: 'row' });
  if (member) {
    labels.push({ text: t('cache.row'), variant: 'body', place: 'row' });
    labels.push({ text: t('cache.hint'), variant: 'callout', place: 'row' });
  }
  labels.push({ text: t('rows.version'), variant: 'body', place: 'row' });
  if (member) labels.push({ text: t('signOut.row'), variant: 'body', place: 'line' });
  return labels;
}
