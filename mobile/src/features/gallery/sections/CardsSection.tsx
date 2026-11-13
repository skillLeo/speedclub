import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { createStyles, useBreakpoint } from '@/theme';
import { BUILD_REACTION_GLYPHS } from '@/ui/motion/kit';
import { GridTile, IconButton, MEDIA_WALL_GAP, MediaCard, MediaCardSkeleton, mediaWallTileWidth, VehicleCard } from '@/ui';

import { E46, LUKAS, PHOTOS, R34, noop, photoUri } from '../data';
import { FORCED, FullBleed, Group, SectionScreen, Specimen } from '../parts';

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', gap: t.space[12] },
  tile: { flex: 1, minWidth: 0 },
  rail: { gap: t.space[12] },
  railCard: { width: t.size.railCard },
  wall: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIA_WALL_GAP },
}));

const REACTIONS = [
  { key: 'stark', label: 'Stark', icon: BUILD_REACTION_GLYPHS.stark },
  { key: 'sauber', label: 'Sauber', icon: BUILD_REACTION_GLYPHS.sauber },
  { key: 'tief', label: 'Tief', icon: BUILD_REACTION_GLYPHS.tief },
  { key: 'laut', label: 'Laut', icon: BUILD_REACTION_GLYPHS.laut },
];

const CAPTION =
  'KW V3 ist drin, 35 mm tiefer und endlich ohne Aufsetzen über die Tiefgaragenrampe. Die Spur ist neu vermessen, die Felgen sind frisch versiegelt. Nächste Woche geht es auf den Prüfstand, dann gibt es die Leistungskurve.';

function MediaCards() {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  // The wall's tiles from its own width: two columns, 2 apart (mediaWallTileWidth).
  const [wallWidth, setWallWidth] = useState(0);
  const tile = { width: mediaWallTileWidth(wallWidth) };
  const [saved, setSaved] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);
  const avatarUri = photoUri(PHOTOS.wheels);
  const owner = { username: 'lukas.sc', avatarUri, avatarBlurhash: PHOTOS.wheels.blurhash };
  return (
    <>
      <Group title="Media-Karte: Lead" note="Volle Breite, 4:5 (16:9 ab 1280), Radius 0, Scrim in die dunkle Bühne, Name in display.title. Text erst unterhalb der sicheren Linie. Das Skelett ist ein Block im Seitenverhältnis auf der dunklen Bühne, die Balken liegen unten darin.">
        <FullBleed>
          <MediaCard
            variant="lead"
            title={R34.title}
            photo={PHOTOS.r34}
            spec="500 PS · 540 Nm · AWD"
            owner={owner}
            save={{ saved, onToggle: () => setSaved((value) => !value) }}
            onPress={noop}
            testID="DEV-01.cards.lead"
          />
        </FullBleed>
        <Specimen label="Beispielinhalt" fill>
          <FullBleed>
            <MediaCard variant="lead" title={E46.title} photo={PHOTOS.e46} spec="343 PS · 365 Nm · RWD" sample={{ is_sample: true, is_editorial: true }} onPress={noop} testID="DEV-01.cards.leadSample" />
          </FullBleed>
        </Specimen>
        <Specimen label="Lädt" fill>
          <FullBleed>
            <MediaCardSkeleton variant="lead" testID="DEV-01.cards.leadSkeleton" />
          </FullBleed>
        </Specimen>
      </Group>
      <Group title="Media-Karte: Feed" note="Kopfzeile mit Fahrzeug, Medien randlos mit Seitenanzeige, drei Zeilen Text und mehr, Mod-Chips, Reaktion, Merken, Teilen. Keine öffentlichen Zahlen.">
        <FullBleed>
          <MediaCard
            variant="feed"
            title={R34.title}
            photos={[
              { ...PHOTOS.r34, alt: 'Blauer Nissan Skyline GT-R R34 von hinten' },
              { ...PHOTOS.wheels, alt: 'Mehrteilige Felge vor pinkem Bremssattel' },
              { ...PHOTOS.interior, alt: 'Cockpit mit Handschaltung' },
            ]}
            vehicleAvatar={{ uri: photoUri(PHOTOS.r34), blurhash: PHOTOS.r34.blurhash }}
            owner={owner}
            time="vor 2 Std."
            caption={CAPTION}
            mods={[
              { key: 'kw', label: 'KW V3', icon: 'coilover', onPress: noop },
              { key: 'bbs', label: 'BBS LM 19″', icon: 'wheel', onPress: noop },
            ]}
            reaction={{ reactions: REACTIONS, selected: reaction, lastUsed: 'stark', onSelect: setReaction, label: 'Reagieren' }}
            save={{ saved, onToggle: () => setSaved((value) => !value) }}
            onShare={noop}
            onPress={noop}
            testID="DEV-01.cards.feed"
          />
        </FullBleed>
        <Specimen label="Quadratisch, ein Foto, Beispiel" fill>
          <FullBleed>
            <MediaCard
              variant="feed"
              square
              title={E46.title}
              photos={[PHOTOS.e46]}
              vehicleAvatar={{ uri: photoUri(PHOTOS.e46), blurhash: PHOTOS.e46.blurhash }}
              owner={{ username: 'speedclub.editorial' }}
              time="14. Juni 2026"
              caption="Saugmotor, 8.000 Umdrehungen, keine Ausreden."
              sample={{ is_sample: true }}
              save={{ saved: false, onToggle: noop }}
              onShare={noop}
              testID="DEV-01.cards.feedSquare"
            />
          </FullBleed>
        </Specimen>
        <Specimen label="Lädt" fill>
          <FullBleed>
            <MediaCardSkeleton variant="feed" testID="DEV-01.cards.feedSkeleton" />
          </FullBleed>
        </Specimen>
      </Group>
      <Group title="Media-Karte: Rail" note="3:4, Radius 12, Name zwei Zeilen darunter, Technik als Caption.">
        <FullBleed>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingHorizontal: gutter }]}>
            <MediaCard variant="rail" title={R34.title} photo={PHOTOS.r34} spec="500 PS · AWD" onPress={noop} style={styles.railCard} testID="DEV-01.cards.rail" />
            <MediaCard variant="rail" title={E46.title} photo={PHOTOS.e46} spec="343 PS · RWD" sample={{ is_sample: true }} onPress={noop} style={styles.railCard} />
            <MediaCard variant="rail" title="Volkswagen Golf GTI Clubsport S mit Sportfahrwerk" photo={{}} spec="310 PS · FWD" onPress={noop} style={styles.railCard} testID="DEV-01.cards.railNoPhoto" />
            <MediaCardSkeleton variant="rail" style={styles.railCard} />
          </ScrollView>
        </FullBleed>
        <Wrap3 />
      </Group>
      <Group title="Media-Karte: Wand" note="Zwei Spalten, 2 Abstand, Radius 0, Name auf dem Scrim. Bei großer Schrift steht der Name unter dem Foto.">
        <FullBleed>
          <View style={styles.wall} onLayout={(event) => setWallWidth(event.nativeEvent.layout.width)}>
            <MediaCard variant="wall" title={R34.title} photo={PHOTOS.r34} onPress={noop} style={tile} testID="DEV-01.cards.wall" />
            <MediaCard variant="wall" title={E46.title} photo={PHOTOS.e46} sample={{ is_sample: true }} onPress={noop} style={tile} />
            <MediaCard variant="wall" title="Felgen-Detail" photo={PHOTOS.wheels} onPress={noop} style={tile} />
            <MediaCardSkeleton variant="wall" style={tile} />
          </View>
        </FullBleed>
      </Group>
    </>
  );
}

/** Hover, pressed and focus of a rail card. */
function Wrap3() {
  const styles = useStyles();
  return (
    <View style={styles.grid}>
      {FORCED.map(({ label, state }) => (
        <Specimen key={label} label={label} forced={state} style={styles.tile}>
          <MediaCard variant="rail" title={R34.title} photo={PHOTOS.r34} spec="500 PS" onPress={noop} />
        </Specimen>
      ))}
    </View>
  );
}

export function CardsSection() {
  const styles = useStyles();
  const avatarUri = photoUri(PHOTOS.wheels);
  return (
    <SectionScreen section="cards">
      <MediaCards />
      <Group title="Fahrzeugkarte" note="4:3, Titel 12 darunter, Spec-Chips 8 darunter.">
        <Specimen label="Hauptfahrzeug mit Besitzer" fill>
          <VehicleCard
            {...R34}
            photo={PHOTOS.r34}
            isMain
            owner={{ username: LUKAS.username, avatarUri, avatarBlurhash: PHOTOS.wheels.blurhash, time: 'vor 2 Std.' }}
            onPress={noop}
            testID="DEV-01.cards.main"
          />
        </Specimen>
        <Specimen label="Eigene Garage mit Vollständigkeit und QR" fill>
          <VehicleCard
            {...E46}
            photo={PHOTOS.e46}
            onPress={noop}
            completeness={{ label: 'Build zu 70\u00a0% vollständig', value: 0.7 }}
            trailing={<IconButton icon="qr-code" label="QR-Code von BMW M3 E46" onPress={noop} testID="DEV-01.cards.qr" />}
            testID="DEV-01.cards.owner"
          />
        </Specimen>
        <Specimen label="Ohne Foto" fill>
          <VehicleCard title="Audi RS 6 Avant C8" subtitle="2021 · 4,0 l V8 Biturbo" specs={['600 PS', '800 Nm', 'AWD']} photo={{}} onPress={noop} testID="DEV-01.cards.noPhoto" />
        </Specimen>
        {FORCED.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <VehicleCard {...E46} photo={PHOTOS.e46} onPress={noop} />
          </Specimen>
        ))}
      </Group>
      <Group title="Grid-Kachel" note="Zwei Spalten, Abstand 12, Titel zwei Zeilen, bei großer Schrift ohne Grenze.">
        <View style={styles.grid}>
          <GridTile style={styles.tile} title={R34.title} spec="500 PS · AWD" photo={PHOTOS.r34} onPress={noop} testID="DEV-01.cards.tile" />
          <GridTile style={styles.tile} title={E46.title} spec="343 PS · RWD" photo={PHOTOS.e46} onPress={noop} />
        </View>
        <View style={styles.grid}>
          <GridTile
            style={styles.tile}
            title="Volkswagen Golf GTI Clubsport S mit Sportfahrwerk und Aerodynamikpaket"
            spec="310 PS · FWD"
            photo={PHOTOS.wheels}
            onPress={noop}
          />
          <GridTile style={styles.tile} title="Ohne Foto" spec="Foto fehlt" photo={{}} onPress={noop} />
        </View>
      </Group>
    </SectionScreen>
  );
}
