import { View } from 'react-native';

import { createStyles } from '@/theme';
import { GridTile, IconButton, VehicleCard } from '@/ui';

import { E46, LUKAS, PHOTOS, R34, noop, photoUri } from '../data';
import { FORCED, Group, SectionScreen, Specimen } from '../parts';

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', gap: t.space[12] },
  tile: { flex: 1, minWidth: 0 },
}));

export function CardsSection() {
  const styles = useStyles();
  const avatarUri = photoUri(PHOTOS.wheels);
  return (
    <SectionScreen section="cards">
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
            completeness={{ label: 'Build zu 70 % vollständig', value: 0.7 }}
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
