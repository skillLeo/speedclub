import { View } from 'react-native';

import { createStyles, useTheme } from '@/theme';
import { BrandWordmark, Button, EmptyState, Hairline, Photo, PhotoScrim, Text } from '@/ui';

import { PHOTOS, noop } from '../data';
import { Group, SectionScreen, Specimen } from '../parts';

/** The brand mark, the same in every language. */
const KATAKANA = 'スピードクラブ';

/** FS-1: the scrim of the Welcome screen covers the bottom 55 %. */
const WELCOME_SCRIM = 0.55;

const useStyles = createStyles((t) => ({
  center: { alignItems: 'center' },
  onPhoto: { bottom: t.space[16], left: t.space[16], position: 'absolute' },
  katakana: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: t.space[12] },
  rule: { flex: 1 },
  welcome: { bottom: t.space[16], gap: t.space[12], left: t.space[16], position: 'absolute', right: t.space[16] },
}));

export function BrandSection() {
  const styles = useStyles();
  const { size } = useTheme();
  const wide = size.qrMinOnScreen;
  return (
    <SectionScreen section="brand">
      <Group title="Wortmarke" note="Nur Original-Datei, nur reines Weiß oder Schwarz, nur an Markenmomenten.">
        <Specimen label="Breit, folgt dem Theme" fill>
          <View style={styles.center}>
            <BrandWordmark width={wide} testID="DEV-01.brand.wide" />
          </View>
        </Specimen>
        <Specimen label="Gestapelt, folgt dem Theme" fill>
          <View style={styles.center}>
            <BrandWordmark width={wide} shape="square" testID="DEV-01.brand.square" />
          </View>
        </Specimen>
        <Specimen label="Weiß auf Foto mit Scrim" fill>
          <Photo aspect="16:9" corner="md" {...PHOTOS.r34}>
            <PhotoScrim />
            <View style={styles.onPhoto}>
              <BrandWordmark width={wide} tone="white" />
            </View>
          </Photo>
        </Specimen>
      </Group>
      <Group title="Katakana" note="Zwischen Hairlines, nie im Produkt-Layer.">
        <View style={styles.katakana} aria-hidden>
          <Hairline style={styles.rule} />
          <Text variant="labelBadge" color="text.secondary" selectable={false}>
            {KATAKANA}
          </Text>
          <Hairline style={styles.rule} />
        </View>
      </Group>
      <Group title="Leere Garage" note="Katakana-Rahmen und Primary L, wie FS-4 es vorgibt.">
        <EmptyState
          variant="brand"
          icon="wheel"
          title="Füge dein erstes Auto hinzu"
          body="Dokumentiere Technik und Mods und erhalte deinen persönlichen QR-Code."
          action={{ label: 'Fahrzeug hinzufügen', onPress: noop, size: 'l' }}
          testID="DEV-01.brand.moment"
        />
      </Group>
      <Group title="Markenmoment" note={'Der rote Button gehört auf den Willkommen-Screen, hier FS-1 mit Scrim über 55\u00a0%.'}>
        <Photo aspect="4:3" corner="md" {...PHOTOS.r34}>
          <PhotoScrim coverage={WELCOME_SCRIM} />
          <View style={styles.welcome}>
            <Button label="Konto erstellen" variant="brand" size="l" fullWidth onPress={noop} testID="DEV-01.brand.cta" />
          </View>
        </Photo>
      </Group>
    </SectionScreen>
  );
}
