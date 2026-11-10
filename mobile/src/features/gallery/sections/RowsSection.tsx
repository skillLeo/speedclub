import { useState } from 'react';

import { createStyles } from '@/theme';
import { BuildUpdateRow, Button, ListRow, MemberRow, ModRow, OwnerRow, SectionHeader, Switch } from '@/ui';

import { LUKAS, PHOTOS, noop, photoUri } from '../data';
import { FORCED, Group, Panel, SectionScreen, Specimen } from '../parts';

/** Pressed and focus: hover differs from pressed only in the token, the list row shows all three. */
const ROW_STATES = FORCED.filter(({ state }) => !state.hovered);

const OWNER_ACTIONS = (
  <>
    <Button label="Folgen" size="m" variant="secondary" onPress={noop} />
    <Button label="Nachricht" size="m" onPress={noop} />
  </>
);

/** On FS-3 the 16 above the owner row hold its state fill. A specimen label sits closer, so the fill gets its room here. */
const useStyles = createStyles((t) => ({ owner: { paddingTop: t.space[8] } }));

export function RowsSection() {
  const styles = useStyles();
  const [publicVehicle, setPublicVehicle] = useState(true);
  const avatarUri = photoUri(PHOTOS.wheels);
  const avatarBlurhash = PHOTOS.wheels.blurhash;
  return (
    <SectionScreen section="rows">
      <Group title="Section Header" note="title.s, optionale Textaktion.">
        <SectionHeader title="Neue Builds" actionLabel="Alle" onAction={noop} actionAccessibilityLabel="Alle neuen Builds" testID="DEV-01.rows.sectionHeader" />
        <SectionHeader title="Deine Fahrzeuge und alle gespeicherten Builds der letzten Wochen" />
      </Group>
      <Group title="Build-Update" note="56er Thumb, Zahlenwerte im Diff in tnum, Trennlinie ab Textbeginn.">
        <Panel>
          <BuildUpdateRow
            title="Fahrwerk geändert"
            diff="Serie → KW V3 · −35 mm"
            meta="@jann.ptrs · vor 2 Std."
            photo={PHOTOS.wheels}
            onPress={noop}
            inset={16}
            testID="DEV-01.rows.update"
          />
          <BuildUpdateRow
            title="Felgen montiert"
            diff={'Serie → BBS LM 19″ × 9,5J ET35 · 255/35 R19'}
            meta={`${LUKAS.username} · gestern`}
            photo={PHOTOS.r34}
            onPress={noop}
            inset={16}
          />
          <BuildUpdateRow
            title="Bremsanlage geändert"
            diff="Serie → 6-Kolben · 380 mm"
            meta="@jann.ptrs · vor 3 Tagen"
            photo={PHOTOS.wheels}
            onPress={noop}
            inset={16}
            divider={false}
            testID="DEV-01.rows.updateHyphen"
          />
        </Panel>
      </Group>
      {/* Forced states of the update row */}
      <Group title="Build-Update, Zustände">
        {ROW_STATES.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <Panel>
              <BuildUpdateRow
                title="Fahrwerk geändert"
                diff="Serie → KW V3 · −35 mm"
                meta="@jann.ptrs · vor 2 Std."
                photo={PHOTOS.wheels}
                onPress={noop}
                inset={16}
                divider={false}
              />
            </Panel>
          </Specimen>
        ))}
      </Group>
      <Group title="Member" note="Avatar 40, Follow-Button M.">
        <Panel>
          <MemberRow
            name={LUKAS.name}
            meta={LUKAS.meta}
            avatarUri={avatarUri}
            avatarBlurhash={avatarBlurhash}
            onPress={noop}
            trailing={<Button label="Folgen" size="m" variant="secondary" onPress={noop} />}
            inset={16}
            divider
            testID="DEV-01.rows.member"
          />
          <MemberRow
            name="Jann Peters"
            meta="@jann.ptrs · Hamburg"
            onPress={noop}
            trailing={<Button label="Folge ich" size="m" variant="tertiary" onPress={noop} />}
            inset={16}
          />
        </Panel>
      </Group>
      <Group title="Member, Zustände">
        {ROW_STATES.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <Panel>
              <MemberRow
                name={LUKAS.name}
                meta={LUKAS.meta}
                onPress={noop}
                trailing={<Button label="Folgen" size="m" variant="secondary" onPress={noop} />}
                inset={16}
              />
            </Panel>
          </Specimen>
        ))}
      </Group>
      <Group title="Mod" note="Kategorie-Glyphe 20, Werte in tnum, Status-Pill, Chevron.">
        <Panel>
          <ModRow icon="wheel" name="BBS LM" values={'19″ × 9,5J ET35 · 255/35 R19'} status="Verbaut" onPress={noop} inset={16} divider testID="DEV-01.rows.mod" />
          <ModRow icon="coilover" name="KW V3" values="−35 mm" status="Verbaut" onPress={noop} inset={16} divider />
          <ModRow icon="exhaust" name="HKS Hi-Power Titan" values="Endschalldämpfer" status="Geplant" onPress={noop} inset={16} divider />
          <ModRow icon="brake-disc" name="Brembo GT" values="6-Kolben · 380 mm" status="Entfernt" onPress={noop} inset={16} />
        </Panel>
      </Group>
      <Group title="Mod, Zustände">
        {ROW_STATES.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <Panel>
              <ModRow icon="wheel" name="BBS LM" values={'19″ × 9,5J ET35 · 255/35 R19'} status="Verbaut" onPress={noop} inset={16} />
            </Panel>
          </Specimen>
        ))}
      </Group>
      <Group title="Liste" note="56 einzeilig, 72 mit Untertitel oder Thumb.">
        <Panel>
          <ListRow title="Sprache" icon="info" value="Deutsch" onPress={noop} inset={16} divider testID="DEV-01.rows.list" />
          <ListRow title="Benachrichtigungen" subtitle="Nachrichten, neue Follower, Build-Updates" icon="bell" onPress={noop} inset={16} divider />
          <ListRow
            title="Öffentlich sichtbar"
            icon="eye"
            control={<Switch value={publicVehicle} onValueChange={setPublicVehicle} label="Öffentlich sichtbar" />}
            inset={16}
            divider
          />
          <ListRow title="Entwurf · Schritt 2 von 4" subtitle="BMW M3 E46" thumb={PHOTOS.e46} onPress={noop} inset={16} divider />
          <ListRow title="QR-Code ersetzen" icon="qr-code" destructive onPress={noop} inset={16} divider />
          <ListRow title="Konto löschen" icon="trash" disabled onPress={noop} inset={16} />
        </Panel>
        <Specimen label="Gedrückt" fill forced={{ pressed: true }}>
          <Panel>
            <ListRow title="Sprache" icon="info" value="Deutsch" onPress={noop} inset={16} />
          </Panel>
        </Specimen>
        <Specimen label="Hover" fill forced={{ hovered: true }}>
          <Panel>
            <ListRow title="Sprache" icon="info" value="Deutsch" onPress={noop} inset={16} />
          </Panel>
        </Specimen>
        <Specimen label="Fokus" fill forced={{ focused: true }}>
          <Panel>
            <ListRow title="Sprache" icon="info" value="Deutsch" onPress={noop} inset={16} />
          </Panel>
        </Specimen>
      </Group>
      <Group title="Besitzer" note="Unter dem Spec-Strip einer Build-Seite, direkt auf bg.canvas. Die Aktionen stehen unter dem Namen, sobald Avatar, 140 Meta und ihre gemessene Breite (im breitesten Zustand) nicht in eine Zeile passen, und bei großer Schrift.">
        <OwnerRow
          name={LUKAS.name}
          meta={LUKAS.meta}
          avatarUri={avatarUri}
          avatarBlurhash={avatarBlurhash}
          onPress={noop}
          inset={0}
          actions={OWNER_ACTIONS}
          style={styles.owner}
          testID="DEV-01.rows.owner"
        />
        {ROW_STATES.map(({ label, state }) => (
          <Specimen key={label} label={label} fill forced={state}>
            <OwnerRow name={LUKAS.name} meta={LUKAS.meta} onPress={noop} inset={0} actions={OWNER_ACTIONS} style={styles.owner} />
          </Specimen>
        ))}
      </Group>
    </SectionScreen>
  );
}
