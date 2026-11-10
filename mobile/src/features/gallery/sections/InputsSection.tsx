import { useState } from 'react';

import { RangeSlider, SearchBar, Stepper, TextInput, type RangeValue } from '@/ui';

import { noop } from '../data';
import { FORCED, Group, SectionScreen, Specimen, Wrap } from '../parts';

const formatPs = (value: number) => `${value} PS`;

export function InputsSection() {
  const [query, setQuery] = useState('Skyline');
  const [power, setPower] = useState<RangeValue>([200, 800]);
  const [owners, setOwners] = useState(2);

  return (
    <SectionScreen section="inputs">
      <Group title="Textfeld" note="52 hoch, Label oben, Hinweis oder Fehler unten.">
        <Specimen label="Leer" fill>
          <TextInput label="Modell" placeholder="z. B. Skyline GT-R R34" testID="DEV-01.inputs.empty" />
        </Specimen>
        <Specimen label="Ausgefüllt mit Hinweis" fill>
          <TextInput
            label="Motorcode"
            defaultValue="RB26DETT"
            helper="Steht im Fahrzeugschein oder auf dem Ventildeckel."
            testID="DEV-01.inputs.helper"
          />
        </Specimen>
        <Specimen label="Fokus" fill forced={{ focused: true }}>
          <TextInput label="Felge" defaultValue="BBS LM 19″ × 9,5J ET35" />
        </Specimen>
        <Specimen label="Hover" fill forced={{ hovered: true }}>
          <TextInput label="Reifen" defaultValue="255/35 R19" />
        </Specimen>
        <Specimen label="Fehler" fill>
          <TextInput
            label="Leistung"
            defaultValue="15000"
            suffix="PS"
            error="Gib einen Wert zwischen 1 und 3.000 PS ein."
            testID="DEV-01.inputs.error"
          />
        </Specimen>
        <Specimen label="Fehler mit Fokus" fill forced={{ focused: true }}>
          <TextInput label="Baujahr" defaultValue="20022" error="Das Baujahr hat vier Stellen." />
        </Specimen>
        <Specimen label="Einheit" fill>
          <TextInput label="Hubraum" defaultValue="2568" suffix="cm³" keyboardType="numeric" />
        </Specimen>
        <Specimen label="Passwort" fill>
          <TextInput label="Passwort" defaultValue="kurvenreich2002" secure testID="DEV-01.inputs.password" />
        </Specimen>
        <Specimen label="Mehrzeilig" fill>
          <TextInput
            label="Beschreibung"
            multiline
            maxRows={5}
            defaultValue="Seit 2019 in meiner Garage. Motor überholt, Fahrwerk auf KW V3 umgebaut und die BBS LM frisch aufbereitet."
          />
        </Specimen>
        <Specimen label="Lädt" fill>
          <TextInput label="Benutzername" defaultValue="lukas.sc" loading helper="Wird geprüft." />
        </Specimen>
        <Specimen label="Deaktiviert" fill>
          <TextInput label="Fahrgestellnummer" defaultValue="BNR34-400123" disabled helper="Nicht änderbar." testID="DEV-01.inputs.disabled" />
        </Specimen>
      </Group>
      <Group title="Suche" note="44 hoch, Radius 10, Abbrechen erscheint beim Fokus.">
        <Specimen label="Leer" fill>
          <SearchBar value="" onChangeText={noop} placeholder="Fahrzeuge und Mitglieder suchen" testID="DEV-01.inputs.search" />
        </Specimen>
        <Specimen label="Mit Text" fill>
          <SearchBar value={query} onChangeText={setQuery} placeholder="Fahrzeuge und Mitglieder suchen" testID="DEV-01.inputs.searchLive" />
        </Specimen>
        <Specimen label="Fokus" fill forced={{ focused: true }}>
          <SearchBar value="Nissan" onChangeText={noop} onCancel={noop} placeholder="Fahrzeuge und Mitglieder suchen" />
        </Specimen>
      </Group>
      <Group title="Bereichsregler" note="Leistung von 50 bis 1500 PS, Schrittweite 10.">
        <Specimen label="Mit Eingabefeldern" fill>
          <RangeSlider
            min={50}
            max={1500}
            step={10}
            value={power}
            onChange={setPower}
            lowLabel="Mindestleistung"
            highLabel="Höchstleistung"
            formatValue={formatPs}
            inputs={{ lowLabel: 'Von', highLabel: 'Bis', suffix: 'PS' }}
            testID="DEV-01.inputs.range"
          />
        </Specimen>
        {FORCED.filter(({ state }) => !state.hovered).map(({ label, state }) => (
          <Specimen key={label} label={`${label}, oberer Griff`} fill forced={state}>
            <RangeSlider
              min={50}
              max={1500}
              step={10}
              value={[300, 1000]}
              onChange={noop}
              lowLabel="Mindestleistung"
              highLabel="Höchstleistung"
              formatValue={formatPs}
            />
          </Specimen>
        ))}
        <Specimen label="Deaktiviert" fill>
          <RangeSlider
            min={50}
            max={1500}
            step={10}
            value={[300, 1000]}
            onChange={noop}
            lowLabel="Mindestleistung"
            highLabel="Höchstleistung"
            formatValue={formatPs}
            disabled
          />
        </Specimen>
      </Group>
      <Group title="Stepper" note="36 hoch, Minus und Plus mit 44er Ziel.">
        <Wrap>
          <Specimen label="Standard">
            <Stepper value={owners} onChange={setOwners} min={0} max={9} label="Vorbesitzer" testID="DEV-01.inputs.stepper" />
          </Specimen>
          {FORCED.map(({ label, state }) => (
            <Specimen key={label} label={`${label}, Plus`} forced={state}>
              <Stepper value={2} onChange={noop} min={0} max={9} label={`Vorbesitzer, ${label}`} />
            </Specimen>
          ))}
          <Specimen label="Am Minimum">
            <Stepper value={0} onChange={noop} min={0} max={9} label="Sitzplätze hinten" />
          </Specimen>
          <Specimen label="Am Maximum">
            <Stepper value={9} onChange={noop} min={0} max={9} label="Gänge" />
          </Specimen>
          <Specimen label="Deaktiviert">
            <Stepper value={4} onChange={noop} label="Türen" disabled />
          </Specimen>
        </Wrap>
      </Group>
    </SectionScreen>
  );
}
