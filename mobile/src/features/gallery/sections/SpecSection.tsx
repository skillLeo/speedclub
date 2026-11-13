import { useState } from 'react';

import { Button, SpecRow, SpecStrip } from '@/ui';

import { Group, Panel, SectionScreen } from '../parts';

const R34 = [
  { value: '500', unit: 'PS', label: 'Leistung', provenance: 'Prüfstand' },
  { value: '540', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

const M3 = [
  { value: '510', unit: 'PS', label: 'Leistung', provenance: 'Herstellerangabe' },
  { value: '650', unit: 'Nm', label: 'Drehmoment', provenance: 'Herstellerangabe' },
  { value: '3,9', unit: 's', label: '0–100', provenance: 'Herstellerangabe' },
  { value: '1.725', unit: 'kg', label: 'Gewicht', provenance: 'Geschätzt' },
];

export function SpecSection() {
  // SM6: every press mounts a new strip under a new key, so the odometer rolls again (in the app: once per vehicle).
  const [roll, setRoll] = useState(1);
  return (
    // Strips and rows only, nothing to focus: with the long strip (M4.1) the page overflows a phone, so its scroller is the tab stop.
    <SectionScreen section="spec" focusableScroll>
      <Group
        title="Spec-Strip 2.0"
        note={'Datenlabel in label.caps, Hero-Zahl in Archivo Condensed mit Einheit in label.unit, Herkunft als Caption. Eine Reihe, wenn alles passt, sonst 2\u00A0×\u00A02, zuletzt eine Spalte.'}
      >
        <SpecStrip items={R34} testID="DEV-01.spec.strip" />
      </Group>
      <Group title="Mit Einheiten und Herkunft" note="Leistung, Drehmoment, 0–100 und Gewicht wie auf VEH-01 eines Builds mit Herstellerangaben.">
        <SpecStrip items={M3} testID="DEV-01.spec.stripLong" />
      </Group>
      <Group title="Drei Werte" note="Ohne Herkunft, die Zeile bleibt so hoch wie ihr Inhalt.">
        <SpecStrip
          items={[
            { value: '343', unit: 'PS', label: 'Leistung' },
            { value: '2004', label: 'Baujahr' },
            { value: 'RWD', label: 'Antrieb' },
          ]}
          testID="DEV-01.spec.stripThree"
        />
      </Group>
      <Group title="Odometer (SM6)" note="Die Zahlen rollen einmal pro Fahrzeug und Sitzung von null hoch; bei reduzierter Bewegung stehen sie sofort.">
        <SpecStrip key={roll} items={M3} rollKey={`gallery-${roll}`} testID="DEV-01.spec.stripRoll" />
        <Button label="Noch einmal rollen" variant="secondary" size="m" onPress={() => setRoll((value) => value + 1)} testID="DEV-01.spec.roll" />
      </Group>
      <Group title="Spec-Zeilen" note="Mindestens 48 hoch, Herkunft nur, wenn es keine Herstellerangabe ist.">
        <Panel>
          <SpecRow label="Leistung" value="500" unit="PS" provenance="Geschätzt" inset={16} testID="DEV-01.spec.power" />
          <SpecRow label="Drehmoment" value="540" unit="Nm" provenance="Prüfstand" inset={16} />
          <SpecRow label="Hubraum" value="2.568" unit="cm³" inset={16} />
          <SpecRow label="Motor" value="RB26DETT, 2,6 l R6 Biturbo" inset={16} />
          <SpecRow label="Antrieb" value="AWD" inset={16} />
          <SpecRow label="Getriebe" value="6-Gang manuell" inset={16} />
          <SpecRow label="Felgen" value={'BBS LM 19″ × 9,5J ET35'} inset={16} />
          <SpecRow label="Reifen" value="255/35 R19" inset={16} />
          <SpecRow label="Tieferlegung" value="−35" unit="mm" inset={16} divider={false} />
        </Panel>
      </Group>
    </SectionScreen>
  );
}
