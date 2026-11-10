import type { ReactNode } from 'react';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, IconButton, Photo, PhotoScrim, StickyCTABar, type ButtonVariant } from '@/ui';

import { PHOTOS, noop } from '../data';
import { FORCED, FullBleed, Group, Panel, SectionScreen, Specimen, Wrap } from '../parts';

const VARIANTS: readonly { variant: ButtonVariant; title: string; note: string; label: string }[] = [
  { variant: 'primary', title: 'Primary', note: 'Inverse Fläche, der Standard für die Hauptaktion.', label: 'Speichern' },
  { variant: 'brand', title: 'Brand', note: 'Rot, nur an Markenmomenten.', label: 'In der App öffnen' },
  { variant: 'secondary', title: 'Secondary', note: 'bg.raised mit Rahmen.', label: 'Folgen' },
  { variant: 'tertiary', title: 'Tertiary', note: 'Nur Text.', label: 'Alle anzeigen' },
  { variant: 'destructive', title: 'Destructive', note: 'Roter Text, gefüllt nur in der letzten Bestätigung.', label: 'Fahrzeug löschen' },
];

const useStyles = createStyles((t) => ({
  // §4: a large font wraps the row instead of leaving the photo. ADR-129: a scrim share cannot carry a label 44 above the
  // bottom or two tall rows, so at every font scale the row sits on a band of the scrim's end colour.
  labelsOnPhoto: {
    backgroundColor: t.color.overlay.photoScrimEnd,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[8],
    left: 0,
    padding: t.space[12],
    position: 'absolute',
    right: 0,
  },
  labelsBandFade: { bottom: '100%', height: t.space[48] },
  overlay: {
    alignItems: 'flex-end',
    bottom: t.space[16],
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[8],
    left: t.space[16],
    position: 'absolute',
    right: t.space[16],
  },
}));

/** Actions on the bottom of a photo, on a band of the scrim's end colour with a fade above it (ADR-129). */
function PhotoActions({ children, testID }: { children: ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.labelsOnPhoto} testID={testID}>
      <PhotoScrim style={styles.labelsBandFade} />
      {children}
    </View>
  );
}

/** The two labels on a photo. A large font wraps them, still on the band. */
export function OnPhotoButtons() {
  return (
    <Photo aspect="4:3" corner="md" {...PHOTOS.r34}>
      <PhotoActions testID="DEV-01.buttons.onPhotoRow">
        <Button label="Galerie öffnen" variant="onPhoto" size="m" onPress={noop} testID="DEV-01.buttons.onPhoto" />
        <Button label="Überspringen" variant="onPhotoText" size="m" onPress={noop} testID="DEV-01.buttons.onPhotoSkip" />
      </PhotoActions>
    </Photo>
  );
}

function VariantGroup({ variant, title, note, label }: (typeof VARIANTS)[number]) {
  const id = `DEV-01.buttons.${variant}`;
  return (
    <Group title={title} note={note}>
      <Wrap>
        <Specimen label="L · 52">
          <Button label={label} variant={variant} size="l" onPress={noop} testID={`${id}.l`} />
        </Specimen>
        <Specimen label="M · 44">
          <Button label={label} variant={variant} size="m" onPress={noop} testID={`${id}.m`} />
        </Specimen>
        <Specimen label="S · 36">
          <Button label={label} variant={variant} size="s" onPress={noop} testID={`${id}.s`} />
        </Specimen>
      </Wrap>
      <Wrap>
        {FORCED.map(({ label: state, state: forced }) => (
          <Specimen key={state} label={state} forced={forced}>
            <Button label={label} variant={variant} size="m" onPress={noop} />
          </Specimen>
        ))}
        <Specimen label="Deaktiviert">
          <Button label={label} variant={variant} size="m" disabled />
        </Specimen>
        <Specimen label="Lädt">
          <Button label={label} variant={variant} size="m" loading onPress={noop} />
        </Specimen>
      </Wrap>
    </Group>
  );
}

export function ButtonsSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="buttons">
      {VARIANTS.map((entry) => (
        <VariantGroup key={entry.variant} {...entry} />
      ))}
      <Group title="Destructive, gefüllt" note="Nur in der letzten Bestätigung.">
        <Wrap>
          <Specimen label="Standard">
            <Button label="Endgültig löschen" variant="destructive" filled size="m" onPress={noop} />
          </Specimen>
          <Specimen label="Lädt">
            <Button label="Endgültig löschen" variant="destructive" filled size="m" loading onPress={noop} />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Mit Icon und volle Breite">
        <Specimen label="Icon L" fill>
          <Button label="Fahrzeug hinzufügen" icon="plus" size="l" fullWidth onPress={noop} />
        </Specimen>
        <Wrap>
          <Specimen label="Icon M">
            <Button label="QR-Code teilen" icon="share-network" variant="secondary" size="m" onPress={noop} />
          </Specimen>
          <Specimen label="Icon S">
            <Button label="Filtern" icon="funnel" variant="secondary" size="s" onPress={noop} />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Auf Foto" note="Weiße Schrift auf einem Band in der Endfarbe des Scrims, 12 vom Rand, mindestens 9,29:1 auch auf reinem Weiß. Bei größerer Schrift bricht die Reihe um und bleibt auf dem Band.">
        <Specimen label="Outline und Text" fill>
          <OnPhotoButtons />
        </Specimen>
        <Specimen label="Lädt" fill>
          <Photo aspect="16:9" corner="md" {...PHOTOS.r34}>
            <PhotoActions>
              <Button label="Galerie öffnen" variant="onPhoto" size="m" loading onPress={noop} />
            </PhotoActions>
          </Photo>
        </Specimen>
      </Group>
      <Group title="Icon Button" note="44er Ziel, 24er Glyphe.">
        <Wrap>
          <Specimen label="Standard">
            <IconButton icon="share-network" label="Teilen" onPress={noop} testID="DEV-01.buttons.icon" />
          </Specimen>
          {FORCED.map(({ label, state }) => (
            <Specimen key={label} label={label} forced={state}>
              <IconButton icon="share-network" label="Teilen" onPress={noop} />
            </Specimen>
          ))}
          <Specimen label="Gewählt">
            <IconButton icon="bookmark-simple" label="Gespeichert" selected onPress={noop} />
          </Specimen>
          <Specimen label="Deaktiviert">
            <IconButton icon="trash" label="Löschen" disabled />
          </Specimen>
          <Specimen label="Lädt">
            <IconButton icon="bookmark-simple" label="Speichern" loading onPress={noop} />
          </Specimen>
        </Wrap>
        <Specimen label="Auf Foto · 36er Kreis" fill>
          <Photo aspect="16:9" corner="md" {...PHOTOS.wheels}>
            <View style={styles.overlay}>
              <IconButton icon="caret-left" label="Zurück" variant="onPhoto" onPress={noop} />
              <IconButton icon="share-network" label="Teilen" variant="onPhoto" onPress={noop} />
              <IconButton icon="bookmark-simple" label="Gespeichert" variant="onPhoto" selected onPress={noop} />
            </View>
          </Photo>
        </Specimen>
      </Group>
      <Group title="Sticky CTA" note="52er Button, 12 und 16 Abstand, sitzt über der Tastatur.">
        <Specimen label="Nur Hauptaktion" fill>
          <Panel>
            <StickyCTABar label="Weiter" onPress={noop} testID="DEV-01.buttons.cta" />
          </Panel>
        </Specimen>
        <Specimen label="Mit Entwurf speichern" fill>
          <Panel>
            <StickyCTABar label="Weiter" onPress={noop} secondary={{ label: 'Entwurf speichern', onPress: noop }} />
          </Panel>
        </Specimen>
        <Specimen label="Lädt" fill>
          <Panel>
            <StickyCTABar label="Veröffentlichen" loading onPress={noop} />
          </Panel>
        </Specimen>
        <Specimen label="Deaktiviert" fill>
          <Panel>
            <StickyCTABar label="Weiter" disabled onPress={noop} />
          </Panel>
        </Specimen>
        <Specimen label="Brand" fill>
          <Panel>
            <StickyCTABar label="QR-Code ansehen" variant="brand" onPress={noop} />
          </Panel>
        </Specimen>
        <Specimen label="Langes Label, randlos wie auf einem Screen" fill>
          <FullBleed>
            <StickyCTABar label="Fahrzeug veröffentlichen" onPress={noop} testID="DEV-01.buttons.ctaLong" />
          </FullBleed>
        </Specimen>
        <Specimen label="Langes Label mit Entwurf speichern, randlos" fill>
          <FullBleed>
            <StickyCTABar
              label="Änderungen speichern"
              onPress={noop}
              secondary={{ label: 'Entwurf speichern', onPress: noop }}
              testID="DEV-01.buttons.ctaLongDraft"
            />
          </FullBleed>
        </Specimen>
      </Group>
    </SectionScreen>
  );
}
