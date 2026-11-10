import { View } from 'react-native';

import { createStyles, typography, type TypeVariant } from '@/theme';
import { Text } from '@/ui';

import { Group, SectionScreen } from '../parts';

const SAMPLES: readonly { variant: TypeVariant; name: string; text: string }[] = [
  { variant: 'displayXl', name: 'display.xl', text: 'Skyline GT-R' },
  { variant: 'displayL', name: 'display.l', text: 'Nissan Skyline GT-R R34' },
  { variant: 'displayM', name: 'display.m', text: 'Featured Build der Woche' },
  { variant: 'titleL', name: 'title.l', text: 'Garage' },
  { variant: 'titleM', name: 'title.m', text: 'Lukas Schneider' },
  { variant: 'titleS', name: 'title.s', text: 'Nissan Skyline GT-R R34' },
  { variant: 'headline', name: 'headline', text: 'Fahrzeugdetails' },
  { variant: 'body', name: 'body', text: 'Seit 2019 in meiner Garage. Motor überholt, Fahrwerk auf KW V3 umgebaut, die BBS LM frisch aufbereitet.' },
  { variant: 'bodyStrong', name: 'body.strong', text: 'Fahrwerk geändert' },
  { variant: 'bodyDense', name: 'body.dense', text: 'Hast du die BBS LM selbst aufbereitet oder machen lassen?' },
  { variant: 'label', name: 'label', text: 'Fahrzeug hinzufügen' },
  { variant: 'labelS', name: 'label.s', text: 'Filter zurücksetzen' },
  { variant: 'supporting', name: 'supporting', text: '2002 · 2,6 l R6 Biturbo' },
  { variant: 'helper', name: 'helper', text: 'Wird auf deiner öffentlichen Build-Seite angezeigt.' },
  { variant: 'caption', name: 'caption', text: 'vor 2 Std.' },
  { variant: 'eyebrow', name: 'eyebrow', text: 'NISSAN' },
  { variant: 'tab', name: 'tab', text: 'Nachrichten' },
  { variant: 'badge', name: 'badge', text: 'Hauptfahrzeug' },
  { variant: 'specStrip', name: 'spec.strip', text: '500 · 540 · 2002' },
  { variant: 'specValue', name: 'spec.value', text: '540 Nm' },
  { variant: 'specUnit', name: 'spec.unit', text: 'cm³' },
  { variant: 'code', name: 'code', text: '7H2K QXMB' },
];

const useStyles = createStyles((t) => ({
  list: { gap: t.space[20] },
  sample: { gap: t.space[4] },
}));

export function TypographySection() {
  const styles = useStyles();
  return (
    <SectionScreen section="typography" focusableScroll>
      <Group title="Typ-Skala" note="Barlow Semi Condensed für Display und Spec-Zahlen, Inter für alles andere.">
        <View style={styles.list}>
          {SAMPLES.map(({ variant, name, text }) => (
            <View key={variant} style={styles.sample}>
              <Text variant="caption" color="text.tertiary">
                {`${name} · ${typography[variant].fontSize}/${typography[variant].lineHeight}`}
              </Text>
              <Text variant={variant}>{text}</Text>
            </View>
          ))}
        </View>
      </Group>
      <Group title="Lange deutsche Wörter" note="Silbentrennung statt Abschneiden.">
        <Text variant="titleS">Hauptuntersuchungsbescheinigung für Sportfahrwerksumbauten</Text>
        <Text variant="body">
          Die Unbedenklichkeitsbescheinigung und das Teilegutachten gehören zur Fahrzeugdokumentation.
        </Text>
      </Group>
    </SectionScreen>
  );
}
