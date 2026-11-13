import { layout, size } from '@/theme';
import { Button, Header, HeaderLargeTitle, Photo, PhotoScrim } from '@/ui';

import { PHOTOS, noop } from '../data';
import { FullBleed, Group, SectionScreen, Specimen } from '../parts';

export function HeaderSection() {
  return (
    <SectionScreen section="header">
      <Group
        title="Kompakt"
        note={`${size.header} hoch, headline mittig, Aktionen ${size.iconButton} × ${size.iconButton}. Randlos auf bg.canvas wie auf einem echten Bildschirm.`}
      >
        <Specimen label="Mit Zurück" fill>
          <FullBleed>
            <Header safeTop={false} title="Technik" onBack={noop} testID="DEV-01.header.back" />
          </FullBleed>
        </Specimen>
        <Specimen label={`Zurück mit vorherigem Titel (ab ${layout.phoneLargeMinWidth}\u00a0pt Breite, nicht auf Android)`} fill>
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
        <Specimen label="Aktionen mit Ungelesen-Punkt" fill>
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
      <Group
        title="Groß"
        note={`Direkt auf bg.canvas wie auf der ersten Seite eines Tabs: title.1 am Seitenrand, klappt nach ${size.headerLargeTitleBlock} zur kompakten Leiste zusammen.`}
      >
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
