import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import {
  createStyles,
  cssFamily,
  faceOf,
  isSizedVariant,
  maxFontScale,
  size,
  typeScale,
  typography,
  typographyDesktop,
  type TypeVariant,
} from '@/theme';
import { DisplayTitle, Text } from '@/ui';

import { Group, NoteText, SectionScreen } from '../parts';

/** `hyphenate: false` where the product sets the role whole (row and card titles, labels), so the specimen shows it the same way. */
type Sample = { variant: TypeVariant; name: string; use: string; text: string; hyphenate?: boolean };

/**
 * The 2.0 type scale (09 §4.2) at German length: every string is the longest form the product sets in that role, so the
 * specimen shows wrapping and hyphenation as the screens do. Cars speak Archivo, people speak Inter.
 */
export const SAMPLES: readonly Sample[] = [
  { variant: 'heroNumeral', name: 'hero.numeral', use: 'Spec-Helden: PS, Nm, s, kg', text: '1.725' },
  { variant: 'heroNumeralS', name: 'hero.numeral.s', use: 'Garagenkarte, Kennzahl, Datum', text: '3,9' },
  { variant: 'displayTitle', name: 'display.title', use: 'Fahrzeugnamen, Markenmomente', text: 'Volkswagen Golf GTI Clubsport' },
  { variant: 'title1', name: 'title.1', use: 'Große Titel, Personennamen', text: 'Lukas Schneider' },
  { variant: 'title2', name: 'title.2', use: 'Abschnitts- und Sheet-Titel', text: 'Benachrichtigungseinstellungen' },
  { variant: 'headline', name: 'headline', use: 'Zeilen- und Kartentitel', text: 'Gewindefahrwerk KW Variante 3 eingetragen', hyphenate: false },
  {
    variant: 'body',
    name: 'body',
    use: 'Fließtext',
    text: 'Seit 2019 in meiner Garage. Motor überholt, Fahrwerk auf KW V3 umgebaut, die BBS LM frisch aufbereitet und eingetragen.',
  },
  { variant: 'bodyStrong', name: 'body.strong', use: 'Betonung, Button-Beschriftung, Textaktionen (Rückgängig, Ändern)', text: 'Fahrzeug veröffentlichen' },
  { variant: 'callout', name: 'callout', use: 'Sekundärtext, Feldbeschriftungen, Chips', text: '2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue' },
  // ADR-426 e (amended, DQ-928): one weight step above the field labels, so a group header never reads as one more label.
  { variant: 'calloutStrong', name: 'callout.strong', use: 'Abschnittsköpfe von Listen und Formularen', text: 'Für alle deine Fahrzeuge', hyphenate: false },
  { variant: 'caption', name: 'caption', use: 'Metadaten, Zeitangaben', text: 'Zuletzt bearbeitet am 14. Juni 2026 um 19:30 Uhr' },
  { variant: 'labelCaps', name: 'label.caps', use: 'Nur Datenbeschriftungen (LEISTUNG, BAUJAHR)', text: 'Drehmoment' },
  { variant: 'labelUnit', name: 'label.unit', use: 'Einheit neben einer Zahl', text: 'Nm' },
  { variant: 'labelBadge', name: 'label.badge', use: `Text in Badges und Statusanzeigen, ${size.statusPill} hoch`, text: 'Hauptfahrzeug', hyphenate: false },
  { variant: 'input', name: 'input', use: `Eingabefelder (${typography.input.fontSize}, kein Zoom in Safari)`, text: 'Hauptuntersuchung bis März 2027' },
  { variant: 'webTab', name: 'web.tab', use: 'Web-Tableiste', text: 'Nachrichten' },
];

/** What a role is set in, for the label above its sample: face, size/line, the desktop size on web, the scale cap. */
export function specOf(variant: TypeVariant): string {
  const role = typography[variant];
  const face = faceOf(role.fontFamily);
  const parts: string[] = [face ? `${cssFamily(face.group)} ${face.weight}` : role.fontFamily];
  if (isSizedVariant(variant)) {
    const sized = typography[variant];
    parts.push(`${sized.fontSize}/${sized.lineHeight}`);
  } else {
    parts.push('erbt die Größe');
  }
  const desktop = (typographyDesktop as Partial<Record<TypeVariant, { fontSize: number; lineHeight: number }>>)[variant];
  if (desktop) parts.push(`Desktop ${desktop.fontSize}/${desktop.lineHeight}`);
  if ('fontVariant' in role) parts.push('tnum');
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  if (cap) parts.push(`max. ${String(cap).replace('.', ',')}×`);
  if (variant === 'displayTitle') parts.push(`max. ${typeScale.displayTitle.maxLines} Zeilen, danach Schrift ${typeScale.displayTitle.minSize}`);
  // NoteText keeps each label with its value and the "·" at the end of its line (DQ-931).
  return parts.join(' · ');
}

/*
 * DQ-815 / DQ-908: running text must not end on a lone fragment ("…dokumenta- / tion."). On web `typeStyle` gives every
 * running role `text-wrap-style: pretty` (Text.tsx, RUNNING_TEXT_ROLES) and the titles `text-wrap-style: balance` (DQ-932);
 * the samples are also written to end on short words, which is what native relies on.
 */

const useStyles = createStyles((t) => ({
  list: { gap: t.space[24] },
  sample: { gap: t.space[4] },
}));

/**
 * SF-R3-3: the display.title specimen with the width it is laid out at, as every product call site passes it: its column's own
 * layout gives the width, and until then the title is laid out invisibly (DisplayTitle without a width).
 */
function DisplayTitleSpecimen({ text }: { text: string }) {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  };
  return (
    <View onLayout={onLayout} testID="DEV-01.typography.displayTitle.column">
      <DisplayTitle placement="page" layoutWidth={width} testID="DEV-01.typography.displayTitle.title">
        {text}
      </DisplayTitle>
    </View>
  );
}

export function TypographySection() {
  const styles = useStyles();
  return (
    <SectionScreen section="typography" focusableScroll>
      <Group
        title="Typ-Skala 2.0"
        note="Archivo für Autos und Zahlen (Condensed für Zahlen, SemiExpanded für Namen), Inter und Inter Display für Menschen und UI."
      >
        <View style={styles.list}>
          {SAMPLES.map(({ variant, name, use, text, hyphenate = true }) => (
            <View key={variant} style={styles.sample} testID={`DEV-01.typography.${variant}`}>
              {/*
               * A12: the spec line is a data label (face, size/line, cap), so it never hyphenates. Its figures are bound to their
               * label ("Desktop 44/48"), and the engines count a bound figure as part of the word: "Desktop" then hyphenated
               * "Desk- / top" at 200 % under the DQ-181 limits, which the label's 7 letters can never meet on their own.
               */}
              <NoteText variant="caption" color="text.tertiary" hyphenate={false} testID={`DEV-01.typography.${variant}.spec`}>
                {`${name} · ${specOf(variant)}`}
              </NoteText>
              <Text variant="caption" color="text.secondary">
                {use}
              </Text>
              {/* display.title only through DisplayTitle: a car name never hyphenates and shrinks to 24 above two lines. */}
              {variant === 'displayTitle' ? (
                <DisplayTitleSpecimen text={text} />
              ) : (
                <NoteText variant={variant} hyphenate={hyphenate}>
                  {text}
                </NoteText>
              )}
            </View>
          ))}
        </View>
      </Group>
      <Group title="Zahlen im Satz" note="numeric.inline: tabellarische Ziffern in der Größe des umgebenden Textes.">
        <NoteText variant="headline" numeric>
          QR-Code 7H2K QXMB
        </NoteText>
        <NoteText variant="body" numeric>
          510 PS · 650 Nm · 0–100 in 3,9 s · 1.725 kg
        </NoteText>
      </Group>
      <Group title="Lange deutsche Wörter" note="Silbentrennung statt Abschneiden.">
        <Text variant="headline">Hauptuntersuchungsbescheinigung für Sportfahrwerksumbauten</Text>
        <Text variant="body">
          Für die Eintragung brauchst du die Unbedenklichkeitsbescheinigung und das Teilegutachten des Herstellers.
        </Text>
      </Group>
    </SectionScreen>
  );
}
