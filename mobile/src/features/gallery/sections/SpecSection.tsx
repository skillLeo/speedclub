import { SpecRow, SpecStrip } from '@/ui';

import { Group, Panel, SectionScreen } from '../parts';

export function SpecSection() {
  return (
    <SectionScreen section="spec">
      <Group title="Spec-Strip" note="Hero-Zahlen in Barlow, tabellarisch.">
        <SpecStrip
          items={[
            { value: '500', label: 'PS' },
            { value: '540', label: 'Nm' },
            { value: '2002', label: 'Baujahr' },
            { value: 'AWD', label: 'Antrieb' },
          ]}
          testID="DEV-01.spec.strip"
        />
      </Group>
      <Group title="Spec-Zeilen" note="Mindestens 48 hoch, Herkunft nur, wenn es keine Werksangabe ist.">
        <Panel>
          <SpecRow label="Leistung" value="500" unit="PS" provenance="Besitzerangabe" inset={16} testID="DEV-01.spec.power" />
          <SpecRow label="Drehmoment" value="540" unit="Nm" provenance="Gemessen" inset={16} />
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
