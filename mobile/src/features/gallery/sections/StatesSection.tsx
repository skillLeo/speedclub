import { BuildUpdateRowSkeleton, EmptyState, ErrorState, OfflineBanner, Skeleton, SkeletonText, Spinner, VehicleCardSkeleton } from '@/ui';

import { noop } from '../data';
import { FullBleed, Group, Panel, SectionScreen, Specimen, Wrap } from '../parts';

export function StatesSection() {
  return (
    <SectionScreen section="states">
      <Group title="Skeleton" note={'bg.raised in der Geometrie des Inhalts, auch bei großer Schrift, Shimmer 1,2\u00a0s, erst nach 300\u00a0ms.'}>
        <Specimen label="Fahrzeugkarte" fill>
          <Skeleton testID="DEV-01.states.skeletonCard">
            <VehicleCardSkeleton />
          </Skeleton>
        </Specimen>
        <Specimen label="Build-Update-Zeile" fill>
          <Panel>
            <Skeleton testID="DEV-01.states.skeletonRow">
              <BuildUpdateRowSkeleton inset={16} divider={false} />
            </Skeleton>
          </Panel>
        </Specimen>
        <Specimen label="Absatz" fill>
          <SkeletonText variant="body" lines={3} />
        </Specimen>
      </Group>
      <Group title="Spinner">
        <Wrap>
          <Specimen label="16">
            <Spinner size={16} label="Wird geladen" />
          </Specimen>
          <Specimen label="20">
            <Spinner size={20} label="Wird geladen" />
          </Specimen>
          <Specimen label="24">
            <Spinner size={24} label="Wird geladen" />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Leerer Zustand" note="Eine Glyphe, ein Titel, eine Zeile, ein Button.">
        <Specimen label="Standard" fill>
          <EmptyState
            icon="magnifying-glass"
            title="Keine Treffer"
            body="Ändere deine Filter oder such nach einem anderen Modell."
            action={{ label: 'Filter zurücksetzen', onPress: noop, variant: 'secondary', size: 'm' }}
            testID="DEV-01.states.empty"
          />
        </Specimen>
        <Specimen label="Marke · leere Garage" fill>
          <EmptyState
            variant="brand"
            icon="wheel"
            title="Füge dein erstes Auto hinzu"
            body="Dokumentiere Technik und Mods und erhalte deinen persönlichen QR-Code."
            action={{ label: 'Fahrzeug hinzufügen', onPress: noop, size: 'l' }}
            testID="DEV-01.states.emptyBrand"
          />
        </Specimen>
        <Specimen label="Eingeschränktes Konto" fill>
          <EmptyState
            icon="lock-simple"
            title="Dein Konto ist eingeschränkt"
            body="Diese Funktion steht dir gerade nicht zur Verfügung."
            testID="DEV-01.states.restricted"
          />
        </Specimen>
      </Group>
      <Group title="Fehler" note="Klare Ursache und Erneut versuchen, nie rohe Codes.">
        <Specimen label="Standard" fill>
          <ErrorState onRetry={noop} testID="DEV-01.states.error" />
        </Specimen>
        <Specimen label="Eigene Ursache" fill>
          <ErrorState
            title="Foto konnte nicht hochgeladen werden"
            message="Die Datei ist größer als 20 MB. Wähle ein kleineres Foto."
            onRetry={noop}
            retryLabel="Anderes Foto wählen"
          />
        </Specimen>
        <Specimen label="Versucht es erneut" fill>
          <ErrorState onRetry={noop} retrying />
        </Specimen>
      </Group>
      <Group title="Offline" note="Randlos oben am Bildschirm. Mindestens 32 hoch; bricht der Text um, kommen 8 Innenabstand dazu.">
        <FullBleed>
          <OfflineBanner testID="DEV-01.states.offline" />
        </FullBleed>
      </Group>
    </SectionScreen>
  );
}
