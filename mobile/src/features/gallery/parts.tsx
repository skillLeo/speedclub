import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View, type FocusEvent, type StyleProp, type ViewStyle } from 'react-native';

import { keepShortNamesTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint } from '@/theme';
import { Header, Screen, Text, type TextProps } from '@/ui';
import { useFocusRing } from '@/ui/useFocusRing';
import { EagerImagesProvider, ForcedVisualStateProvider, type ForcedVisualState } from '@/ui/qaVisualState';

import { SECTIONS, type SectionId } from './data';

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { paddingBottom: t.space[64], paddingTop: t.space[16] },
  column: { alignSelf: 'center', gap: t.layout.sectionGap, maxWidth: t.layout.feedColumn, width: '100%' },
  group: { gap: t.space[12] },
  groupBody: { gap: t.space[20] },
  note: { marginTop: -t.space[8] },
  specimen: { gap: t.space[8] },
  fill: { alignSelf: 'stretch' },
  wrap: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  panel: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  panelPadded: { padding: t.layout.cardPadding },
}));

type SectionScreenProps = {
  section: SectionId;
  footer?: ReactNode;
  /**
   * For a section with no control in it: the keyboard could not reach its scroll area otherwise (axe scrollable-region-focusable).
   * On web the scroller is then a tab stop, a region named after the section, with the inset focus ring (as SettingsPage).
   */
  focusableScroll?: boolean;
  children: ReactNode;
};

export function SectionScreen({ section, footer, focusableScroll = false, children }: SectionScreenProps) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const title = SECTIONS.find((s) => s.id === section)?.title;
  const ring = useFocusRing('inset');
  const focusable = focusableScroll && isWeb;
  return (
    <EagerImagesProvider>
      <Screen edges={['left', 'right']} testID={`DEV-01.${section}.root`}>
        <Header
          variant="compact"
          title={title}
          onBack={() => router.navigate('/dev/gallery')}
          backLabel="Zurück zur Galerie"
          testID={`DEV-01.${section}.header`}
        />
        <ScrollView
          {...(focusable
            ? {
                tabIndex: 0 as const,
                role: 'region' as const,
                'aria-label': title,
                // Focus bubbles: a control inside draws its own ring, this one is for the scroller alone.
                onFocus: (event: FocusEvent) => {
                  if (event.target === event.currentTarget) ring.onFocus(event);
                },
                onBlur: ring.onBlur,
              }
            : {})}
          style={[styles.scroll, focusable ? ring.ringStyle : null]}
          contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer}
      </Screen>
    </EagerImagesProvider>
  );
}

const NBSP = '\u00A0';
const WORD_JOINER = '\u2060';
const ZERO_WIDTH_SPACE = '\u200B';
const MONTHS = 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';
const UNITS = 'ms|s|PS|Nm|kg|pt|px|Uhr|Zeilen';

/**
 * DQ-931: where a gallery note may break (SKILL §9, ADR-426 c). A label stays with its value ("Dämpfung 34", "Radius 12"), a
 * figure with its unit ("200 ms", "70 %"), a day with its month ("14. Juni"), a range with both ends ("0–100"), a code or
 * a model name with its second half ("7H2K QXMB", "BBS LM", "GT-R"), the arguments of a call ("concentric(20, 8)"), and the
 * "·" stays at the end of the part before it, so no line starts with it.
 */
export function noteText(text: string): string {
  return keepShortNamesTogether(text)
    .replace(/ · /g, `${NBSP}· `)
    .replace(/(\d)–(?=\d)/g, `$1${WORD_JOINER}–${WORD_JOINER}`)
    .replace(new RegExp(`(\\d{1,2}\\.) (?=(?:${MONTHS})\\b)`, 'g'), `$1${NBSP}`)
    .replace(new RegExp(`(\\d) (?=(?:(?:${UNITS})(?![\\p{L}])|%))`, 'gu'), `$1${NBSP}`)
    // A figure stays with the word before it ("Schrift 24"), a code never ("QR-Code / 7H2K QXMB": bound, the line could only
    // break inside the code).
    .replace(/(\p{L}\.?) (?=[−+]?\d)(?![−+]?\d+\p{Lu})/gu, `$1${NBSP}`)
    .replace(/\b([A-Z0-9]{2,}) (?=[A-Z0-9]{2,}\b)/g, `$1${NBSP}`)
    .replace(/([A-Za-z]\()([^()]*)\)/g, (_match, open: string, args: string) => `${open}${args.replace(/, /g, `,${NBSP}`)})`);
}

/** A colour value (in the functional or hex notation of a theme value) or a token or helper name ("scrim.photoStart", "concentric(20, 8)"). */
const IDENTIFIER = /rgba?\([^)]*\)|#[0-9A-Fa-f]{6,8}\b|\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+\b|\b[a-z][a-zA-Z]*\([^()]*\)/g;

/** An identifier as it is set: whole, and a colour value may break only after its commas. */
function identifierText(value: string): string {
  if (/^rgba?\(/.test(value)) return value.replace(/,\s*/g, `,${ZERO_WIDTH_SPACE}`);
  return value.replace(/, /g, `,${NBSP}`);
}

/** The parts of a note: plain text (`noteText`) and identifiers, which never hyphenate (DQ-931). */
export function noteParts(text: string): { text: string; identifier: boolean }[] {
  const parts: { text: string; identifier: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(IDENTIFIER)) {
    const at = match.index;
    if (at > last) parts.push({ text: noteText(text.slice(last, at)), identifier: false });
    parts.push({ text: identifierText(match[0]), identifier: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: noteText(text.slice(last)), identifier: false });
  return parts;
}

/** A gallery line set by `noteParts`: an identifier is a nested Text in the same role that never hyphenates. */
export function NoteText({ children, ...text }: Omit<TextProps, 'children'> & { children: string }) {
  const parts = noteParts(children);
  return (
    <Text {...text}>
      {parts.map((part, index) =>
        part.identifier ? (
          // A nested Text resets to its variant, so it takes the same look as the outer one.
          <Text key={index} variant={text.variant} color={text.color} numeric={text.numeric} hyphenate={false}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

/** One component with a title and an optional line about what it shows. */
export function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text variant="headline" role="heading" aria-level={2}>
        {title}
      </Text>
      {note ? (
        <NoteText variant="callout" color="text.secondary" style={styles.note}>
          {note}
        </NoteText>
      ) : null}
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

/** One state of a component with its small label. `forced` draws what only a pointer or a keyboard could reach. */
export function Specimen({
  label,
  forced,
  fill = false,
  style,
  children,
}: {
  label: string;
  forced?: ForcedVisualState;
  /** Takes the full width of the group. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.specimen, fill ? styles.fill : null, style]}>
      <NoteText variant="caption" color="text.tertiary">
        {label}
      </NoteText>
      {forced ? <ForcedVisualStateProvider value={forced}>{children}</ForcedVisualStateProvider> : children}
    </View>
  );
}

export function Wrap({ children }: { children: ReactNode }) {
  return <View style={useStyles().wrap}>{children}</View>;
}

/** A list group on bg.surface, as rows and cards sit on a real screen. */
export function Panel({ padded = false, children }: { padded?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return <View style={[styles.panel, padded ? styles.panelPadded : null]}>{children}</View>;
}

/** Backs out of the section's gutter: edge-to-edge components bring their own, as they do on a real screen. */
export function FullBleed({ children }: { children: ReactNode }) {
  const { gutter } = useBreakpoint();
  return <View style={{ marginHorizontal: -gutter }}>{children}</View>;
}

/** The interaction states that need a forced visual. */
export const FORCED: readonly { label: string; state: ForcedVisualState }[] = [
  { label: 'Hover', state: { hovered: true } },
  { label: 'Gedrückt', state: { pressed: true } },
  { label: 'Fokus', state: { focused: true } },
];
