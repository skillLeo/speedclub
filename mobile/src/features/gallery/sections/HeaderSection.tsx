import { Button, Header, HeaderLargeTitle, Photo, PhotoScrim } from '@/ui';

import { PHOTOS, noop } from '../data';
import { FullBleed, Group, SectionScreen, Specimen } from '../parts';

export function HeaderSection() {
  return (
    <SectionScreen section="header">
      <Group title="Compact" note="44 hoch, headline mittig, Aktionen 44 × 44. Randlos auf bg.canvas wie auf einem echten Screen.">
        <Specimen label="Mit Zurück" fill>
          <FullBleed>
            <Header safeTop={false} title="Technik" onBack={noop} testID="DEV-01.header.back" />
          </FullBleed>
        </Specimen>
        <Specimen label="Zurück mit vorherigem Titel (ab 390 Breite, nicht auf Android)" fill>
          <FullBleed>
            <Header safeTop={false} title="Technik" onBack={noop} backTitle="Garage" />
          </FullBleed>
        </Specimen>
        <Specimen label="Modal mit Schließen und Textaktion" fill>
          <FullBleed>
            <Header
              safeTop={false}
              title="Mod bearbeiten"
              onBack={noop}
              backIcon="close"
              trailing={<Button label="Speichern" variant="tertiary" size="s" onPress={noop} />}
            />
          </FullBleed>
        </Specimen>
        <Specimen label="Aktionen mit Unread" fill>
          <FullBleed>
            <Header
              safeTop={false}
              title="Start"
              actions={[
                { icon: 'magnifying-glass', label: 'Suchen', onPress: noop },
                { icon: 'bell', label: 'Benachrichtigungen', onPress: noop, unread: { label: 'Neue Benachrichtigungen' } },
              ]}
              testID="DEV-01.header.actions"
            />
          </FullBleed>
        </Specimen>
        <Specimen label="Langer Titel" fill>
          <FullBleed>
            <Header safeTop={false} title="Nissan Skyline GT-R R34 V-Spec II Nür" onBack={noop} actions={[{ icon: 'share-network', label: 'Teilen', onPress: noop }]} />
          </FullBleed>
        </Specimen>
      </Group>
      <Group title="Large" note="Direkt auf bg.canvas wie auf einem Tab-Root: title.l auf dem Gutter, klappt nach 52 zur kompakten Leiste zusammen.">
        <FullBleed>
          <Header
            safeTop={false}
            variant="large"
            title="Garage"
            actions={[{ icon: 'plus', label: 'Fahrzeug hinzufügen', onPress: noop }]}
            testID="DEV-01.header.large"
          />
          <HeaderLargeTitle title="Garage" />
        </FullBleed>
      </Group>
      <Group title="Auf Foto" note="Icon-Kreise über dem Hero, die Leiste wird beim Scrollen fest.">
        <Photo aspect="4:3" corner="md" {...PHOTOS.r34}>
          <PhotoScrim />
          <Header
            safeTop={false}
            variant="photo"
            title="Nissan Skyline GT-R R34"
            onBack={noop}
            actions={[
              { icon: 'share-network', label: 'Teilen', onPress: noop },
              { icon: 'dots-three', label: 'Mehr', onPress: noop },
            ]}
            testID="DEV-01.header.photo"
          />
        </Photo>
      </Group>
    </SectionScreen>
  );
}
