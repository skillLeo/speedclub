import { View } from 'react-native';

import { concentric, createStyles, layout, motion, radius, space, type RadiusToken, type SpaceToken } from '@/theme';
import { Photo, PhotoScrim, Text } from '@/ui';
import { ChromeSurface, FloatingControl } from '@/ui/chrome';

import { PHOTOS, noop } from '../data';
import { Group, NoteText, SectionScreen } from '../parts';

/** 09 §4.3: what each radius is for. 10 and 16 are gone in 2.0. */
const RADII: readonly { token: RadiusToken; use: string }[] = [
  { token: 'none', use: 'Vollflächige Fotos' },
  { token: 'xs', use: 'Tags, Badges' },
  { token: 'sm', use: 'Buttons, Eingaben, kleine Medien' },
  { token: 'md', use: 'Karten, gruppierte Listen, Kacheln, Suchfeld' },
  { token: 'xl', use: 'Sheets, Dialoge, eingerückte Hero-Medien' },
  { token: 'full', use: 'Avatare, Chips, Schalter, runde Bedienelemente' },
];

/** 09 §4.7: where each token is used. */
const MOTION_USE: Readonly<Record<keyof typeof motion.css, string>> = {
  'spring.fast': 'Druck, Schalter, Chips, Picker',
  'spring.default': 'Sheets, Hero-Übergang, Tab-Inhalt, Zeilen aufklappen',
  'spring.slow': 'Vollbild-Momente: Splash, QR, Onboarding',
  'spring.calm': 'Navigation, Listen, alles ohne Nachschwingen',
  'effect.fast': 'Deckkraft und Farbe, Ausblenden',
  'effect.default': 'Skeleton zu Inhalt, Überblendungen',
  'effect.slow': 'Große Überblendungen, Theme-Wechsel',
};

/**
 * 09 §4.3 spacing scale, read from the tokens so the ruler cannot drift. The steps above the web section gap's upper end
 * (80, 96) are for web sections only.
 */
const SPACE_STEPS = (Object.keys(space) as SpaceToken[])
  .map((token) => ({ token, value: space[token] as number }))
  .filter(({ value }) => value > 0)
  .sort((a, b) => a.value - b.value);
const isWebSectionStep = (value: number) => value > layout.sectionGapWeb.max;

function springOf(token: keyof typeof motion.css): { stiffness: number; damping: number; mass: number } {
  const [kind, name] = token.split('.') as ['spring' | 'effect', string];
  return (motion[kind] as Record<string, { stiffness: number; damping: number; mass: number }>)[name]!;
}

const useStyles = createStyles((t) => ({
  radii: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  radius: { flexBasis: '40%', flexGrow: 1, gap: t.space[8] },
  radiusBox: {
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
    borderWidth: t.size.border.control,
    height: t.size.avatar.lg,
    width: t.size.avatar.lg,
  },
  nest: { backgroundColor: t.color.bg.raised, borderRadius: t.radius.xl, padding: t.space[8] },
  nestInner: { backgroundColor: t.color.bg.overlay, borderRadius: concentric(t.radius.xl, t.space[8]), height: t.size.avatar.lg },
  tokens: { gap: t.space[16] },
  ruler: { gap: t.space[8] },
  step: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  stepBar: { backgroundColor: t.color.text.tertiary, borderRadius: t.radius.none, height: t.space[8] },
  token: { gap: t.space[2] },
  chromeStage: { borderRadius: t.radius.md, overflow: 'hidden' },
  chromeBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[8],
    left: t.space[12],
    position: 'absolute',
    right: t.space[12],
    top: t.space[12],
  },
  // Like a compact header title on a photo: the pill shrinks beside the control and the name truncates on one line (full text stays readable).
  chromePill: { borderRadius: t.radius.full, flexShrink: 1, minWidth: 0, paddingHorizontal: t.space[12], paddingVertical: t.space[8] },
}));

/** DEV-01 "Form und Bewegung": radii 2.0, the concentric rule, the motion tokens and the chrome material. */
export function FoundationSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="foundation" focusableScroll>
      <Group title="Radien" note="0 · 4 · 8 · 12 · 20 · rund. 10 und 16 gibt es in 2.0 nicht mehr.">
        <View style={styles.radii}>
          {RADII.map(({ token, use }) => (
            <View key={token} style={styles.radius} testID={`DEV-01.foundation.radius.${token}`}>
              <View style={[styles.radiusBox, { borderRadius: radius[token] }]} />
              <NoteText variant="callout">{`${token} · ${token === 'full' ? 'rund' : radius[token]}`}</NoteText>
              <Text variant="caption" color="text.secondary">
                {use}
              </Text>
            </View>
          ))}
        </View>
      </Group>
      <Group
        title="Abstände"
        note={`${SPACE_STEPS.filter(({ value }) => !isWebSectionStep(value)).map(({ value }) => value).join(' · ')}, dazu ${SPACE_STEPS.filter(({ value }) => isWebSectionStep(value)).map(({ value }) => value).join(' und ')} nur für Web-Abschnitte. Kein Wert dazwischen.`}
      >
        <View style={styles.ruler} testID="DEV-01.foundation.spacing">
          {SPACE_STEPS.map(({ token, value }) => (
            <View key={token} style={styles.step} testID={`DEV-01.foundation.space.${token}`}>
              <View style={[styles.stepBar, { width: value }]} />
              <NoteText variant="callout" numeric>
                {isWebSectionStep(value) ? `${value} · nur Web` : String(value)}
              </NoteText>
            </View>
          ))}
        </View>
      </Group>
      <Group title="Konzentrisch" note="Innen = außen − Abstand: concentric(20, 8) ergibt 12, nie ein fester Wert.">
        <View style={styles.nest} testID="DEV-01.foundation.concentric">
          <View style={styles.nestInner} />
        </View>
      </Group>
      <Group
        title="Bewegung"
        note="Reanimated-Federn, Masse 1. Effekte sind kritisch gedämpft; bei reduzierter Bewegung wird jede Feder zur effect.default-Überblendung."
      >
        <View style={styles.tokens}>
          {(Object.keys(motion.css) as (keyof typeof motion.css)[]).map((token) => {
            const spring = springOf(token);
            const css = motion.css[token];
            return (
              <View key={token} style={styles.token} testID={`DEV-01.foundation.motion.${token}`}>
                <Text variant="headline">{token}</Text>
                <NoteText variant="caption" color="text.secondary" numeric>
                  {`Steifigkeit ${spring.stiffness} · Dämpfung ${spring.damping} · Masse ${spring.mass} · CSS ${css.duration} ms`}
                </NoteText>
                <Text variant="callout">{MOTION_USE[token]}</Text>
              </View>
            );
          })}
        </View>
      </Group>
      <Group
        title="Chrome-Material"
        note="Nur für Navigation und schwebende Bedienelemente: Glas auf iOS, sonst chrome.translucent; deckend bei reduzierter Transparenz und auf Android ohne Blur-Ziel."
      >
        <View style={styles.chromeStage}>
          <Photo aspect="16:9" corner="none" {...PHOTOS.r34}>
            <PhotoScrim />
          </Photo>
          <View style={styles.chromeBar}>
            <FloatingControl icon="caret-left" label="Zurück" onPress={noop} testID="DEV-01.foundation.floating" />
            <ChromeSurface style={styles.chromePill} testID="DEV-01.foundation.chrome">
              <Text variant="callout" numberOfLines={1} hyphenate={false}>
                Nissan Skyline GT-R R34
              </Text>
            </ChromeSurface>
          </View>
        </View>
      </Group>
    </SectionScreen>
  );
}
