import { useState } from 'react';
import { View } from 'react-native';

import { size } from '@/theme';
import { Checkbox, Chip, ContentTabs, Radio, SegmentedControl, Switch } from '@/ui';

import { noop } from '../data';
import { FORCED, Group, SectionScreen, Specimen, Wrap } from '../parts';

const TABS = [
  { value: 'overview', label: 'Übersicht' },
  { value: 'tech', label: 'Technik' },
  { value: 'mods', label: 'Modifikationen' },
  { value: 'gallery', label: 'Galerie' },
  { value: 'history', label: 'Verlauf' },
] as const;

export function SelectionSection() {
  const [chip, setChip] = useState(true);
  const [toggle, setToggle] = useState(true);
  const [box, setBox] = useState(true);
  const [radio, setRadio] = useState('awd');
  const [view, setView] = useState('photos');
  const [unit, setUnit] = useState('ps');
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('tech');

  return (
    <SectionScreen section="selection">
      <Group title="Chip" note={`${size.chip} hoch, Auswahl invertiert die Fläche; gedrückt liegt state.pressedInverse über der invertierten Fläche.`}>
        <Wrap>
          <Specimen label="Standard">
            <Chip label="Allrad" onPress={noop} selected={false} testID="DEV-01.selection.chip" />
          </Specimen>
          <Specimen label="Live">
            <Chip label="Japan" selected={chip} onPress={() => setChip(!chip)} testID="DEV-01.selection.chipLive" />
          </Specimen>
          {FORCED.map(({ label, state }) => (
            <Specimen key={label} label={label} forced={state}>
              <Chip label="Heckantrieb" onPress={noop} selected={false} />
            </Specimen>
          ))}
          <Specimen label="Gewählt">
            <Chip label="Biturbo" onPress={noop} selected />
          </Specimen>
          {/* ADR-421 c: the pressed tone on the inverted fill of a selected chip. */}
          <Specimen label="Gewählt · gedrückt" forced={{ pressed: true }}>
            <Chip label="Biturbo" onPress={noop} selected testID="DEV-01.selection.chipSelectedPressed" />
          </Specimen>
          <Specimen label="Mit Zähler">
            <Chip label="Filter" onPress={noop} icon="funnel" count={3} />
          </Specimen>
          <Specimen label="Entfernbar">
            <Chip label="Nissan" onPress={noop} onRemove={noop} selected testID="DEV-01.selection.chipRemove" />
          </Specimen>
          <Specimen label="Deaktiviert">
            <Chip label="Kombi" onPress={noop} selected={false} disabled />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Switch" note={`${size.switch.width} × ${size.switch.height}, ohne Grün.`}>
        <Wrap>
          <Specimen label="Live">
            <Switch value={toggle} onValueChange={setToggle} label="Öffentlich sichtbar" testID="DEV-01.selection.switch" />
          </Specimen>
          <Specimen label="Aus">
            <Switch value={false} onValueChange={noop} label="Benachrichtigungen" />
          </Specimen>
          <Specimen label="Fokus" forced={{ focused: true }}>
            <Switch value onValueChange={noop} label="Kennzeichen verbergen" />
          </Specimen>
          <Specimen label="Aus, deaktiviert">
            <Switch value={false} onValueChange={noop} label="Standort teilen" disabled />
          </Specimen>
          <Specimen label="An, deaktiviert">
            <Switch value onValueChange={noop} label="Konto aktiv" disabled />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Checkbox" note={`${size.checkbox} sichtbar, ${size.touchMin}er Ziel.`}>
        <Wrap>
          <Specimen label="Live">
            <Checkbox checked={box} onChange={setBox} label="AGB akzeptieren" testID="DEV-01.selection.checkbox" />
          </Specimen>
          <Specimen label="Aus">
            <Checkbox checked={false} onChange={noop} label="Newsletter" />
          </Specimen>
          <Specimen label="Fokus" forced={{ focused: true }}>
            <Checkbox checked onChange={noop} label="TÜV eingetragen" />
          </Specimen>
          <Specimen label="Fehler">
            <Checkbox checked={false} onChange={noop} label="Datenschutz bestätigen" error />
          </Specimen>
          <Specimen label="Deaktiviert">
            <Checkbox checked onChange={noop} label="Serienausstattung" disabled />
          </Specimen>
        </Wrap>
        <Specimen label="Mit sichtbarem Text" fill>
          <Checkbox checked={box} onChange={setBox} label="Fahrwerk ist im Fahrzeugschein eingetragen" showLabel />
        </Specimen>
      </Group>
      <Group title="Radio">
        <View role="radiogroup" aria-label="Antrieb">
          <Radio checked={radio === 'awd'} onChange={() => setRadio('awd')} label="Allrad (AWD)" showLabel testID="DEV-01.selection.radioAwd" />
          <Radio checked={radio === 'rwd'} onChange={() => setRadio('rwd')} label="Heckantrieb (RWD)" showLabel />
          <Radio checked={radio === 'fwd'} onChange={() => setRadio('fwd')} label="Frontantrieb (FWD)" showLabel />
        </View>
        <Wrap>
          <Specimen label="Fokus" forced={{ focused: true }}>
            <Radio checked onChange={noop} label="Schaltgetriebe" />
          </Specimen>
          <Specimen label="Fehler">
            <Radio checked={false} onChange={noop} label="Automatik" error />
          </Specimen>
          <Specimen label="Deaktiviert">
            <Radio checked={false} onChange={noop} label="Doppelkupplung" disabled />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Segmented Control" note={`${size.segmented} hoch, höchstens drei Segmente.`}>
        <Specimen label="Drei Segmente" fill>
          <SegmentedControl
            label="Ansicht"
            value={view}
            onChange={setView}
            options={[
              { value: 'photos', label: 'Fotos' },
              { value: 'tech', label: 'Technik' },
              { value: 'mods', label: 'Mods' },
            ]}
            testID="DEV-01.selection.segmented"
          />
        </Specimen>
        <Specimen label="Zwei Segmente als Formularwert" fill>
          <SegmentedControl
            label="Einheit"
            role="radiogroup"
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'ps', label: 'PS' },
              { value: 'kw', label: 'kW' },
            ]}
          />
        </Specimen>
        <Specimen label="Fokus" fill forced={{ focused: true }}>
          <SegmentedControl
            label="Sortierung"
            value="new"
            onChange={noop}
            options={[
              { value: 'new', label: 'Neu' },
              { value: 'popular', label: 'Beliebt' },
            ]}
          />
        </Specimen>
        <Specimen label="Deaktiviert" fill>
          <SegmentedControl
            label="Sichtbarkeit"
            value="public"
            onChange={noop}
            disabled
            options={[
              { value: 'public', label: 'Öffentlich' },
              { value: 'private', label: 'Privat' },
            ]}
          />
        </Specimen>
      </Group>
      <Group title="Content Tabs" note={`${size.contentTab} hoch, Unterstrich in accent.fg, scrollt bei Überlänge.`}>
        <Specimen label="Live" fill>
          <ContentTabs label="Fahrzeugbereiche" tabs={TABS} value={tab} onChange={setTab} testID="DEV-01.selection.tabs" />
        </Specimen>
        {FORCED.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <ContentTabs label={`Fahrzeugbereiche, ${label}`} tabs={TABS} value="tech" onChange={noop} />
          </Specimen>
        ))}
        <Specimen label="Deaktiviert" fill>
          <ContentTabs
            label="Fahrzeugbereiche, deaktiviert"
            tabs={[
              { value: 'overview', label: 'Übersicht' },
              { value: 'tech', label: 'Technik', disabled: true },
              { value: 'history', label: 'Verlauf', disabled: true },
            ]}
            value="overview"
            onChange={noop}
          />
        </Specimen>
      </Group>
    </SectionScreen>
  );
}
