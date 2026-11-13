import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, ContextMenu, ContextMenuArea, ContextMenuButton, Dialog, ImageViewer, ListRow, OwnerCapsule, Photo, Sheet, Switch, Text, TextInput, ToastHost, dismissToast, toast, type ContextMenuItem } from '@/ui';
import { useCurrentToast } from '@/ui/toast';

import { PHOTOS, noop, viewerImages } from '../data';
import { FullBleed, Group, Panel, SectionScreen, Specimen, Wrap } from '../parts';

type Variant = 'sheet' | 'sheet-full' | 'sheet-form' | 'sheet-toast' | 'sheet-locked' | 'dialog' | 'dialog-destructive' | 'dialog-long' | 'toast' | 'viewer' | 'menu';

const VARIANTS: readonly { id: Variant; label: string }[] = [
  { id: 'sheet', label: 'Sheet' },
  { id: 'sheet-full', label: 'Sheet 90 %' },
  { id: 'sheet-form', label: 'Sheet mit Formular' },
  { id: 'sheet-toast', label: 'Sheet mit Toast' },
  { id: 'sheet-locked', label: 'Sheet ohne Schließen' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'dialog-destructive', label: 'Dialog löschen' },
  { id: 'dialog-long', label: 'Dialog mit langem Text' },
  { id: 'toast', label: 'Toast' },
  { id: 'viewer', label: 'Bildansicht' },
  { id: 'menu', label: 'Kontextmenü' },
];

const MAKES = ['Audi', 'BMW', 'Honda', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan', 'Porsche', 'Subaru', 'Toyota', 'Volkswagen', 'Volvo'];

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16] },
  area: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, padding: t.space[16] },
  capsuleStage: { justifyContent: 'flex-end' },
  capsule: { bottom: t.space[24], left: 0, position: 'absolute', right: 0 },
}));

/** A vehicle's more menu: share, compare, report; destructive last (09 §5 ContextMenu). */
const MENU_ITEMS: readonly ContextMenuItem[] = [
  { key: 'share', label: 'Teilen', icon: 'share-network', onSelect: noop },
  { key: 'copy', label: 'Link kopieren', icon: 'link', onSelect: noop },
  { key: 'report', label: 'Melden', icon: 'flag', destructive: true, onSelect: noop },
  { key: 'compare', label: 'Vergleichen', icon: 'arrows-left-right', onSelect: noop },
  { key: 'hide', label: 'Ausblenden', icon: 'eye-slash', disabled: true, onSelect: noop },
];

function SheetRows() {
  return (
    <>
      <ListRow title="Foto ersetzen" icon="camera" onPress={noop} inset={0} divider />
      <ListRow title="Als Titelbild setzen" icon="star" onPress={noop} inset={0} divider />
      <ListRow title="Foto löschen" icon="trash" destructive onPress={noop} inset={0} />
    </>
  );
}

/** The gallery's standard undo toast; tests/ui/ToastFit.test.tsx measures it at 360, 393 and 412. */
export const TOAST_MESSAGE = 'Aus deiner Garage entfernt.';

function showToast() {
  toast(TOAST_MESSAGE, { undo: noop, testID: 'DEV-01.overlays.toast' });
}

export function OverlaysSection() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ variant?: string }>();
  const initial = VARIANTS.some((v) => v.id === params.variant) ? (params.variant as Variant) : null;
  const [open, setOpen] = useState<Variant | null>(initial);
  const [notify, setNotify] = useState(true);
  const [images] = useState(viewerImages);
  const close = () => setOpen(null);
  const window = useWindowDimensions();

  const current = useCurrentToast();
  const keepToast = initial === 'toast' && open === 'toast';
  useEffect(() => {
    // A static screenshot must find the toast, whenever it is taken: it comes back after its 4 s.
    if (keepToast && !current) showToast();
    return undefined;
  }, [keepToast, current]);
  useEffect(() => () => dismissToast(), []);

  return (
    <SectionScreen section="overlays" footer={<ToastHost testID="DEV-01.overlays.toast" />}>
      <Group title="Live auslösen" note="Jede Variante hat auch eine eigene URL: /dev/gallery/overlays?variant=sheet.">
        <Wrap>
          {VARIANTS.map(({ id, label }) => (
            <Button
              key={id}
              label={label}
              variant="secondary"
              size="m"
              onPress={() => {
                if (id === 'toast') showToast();
                else setOpen(id);
              }}
              testID={`DEV-01.overlays.open.${id}`}
            />
          ))}
        </Wrap>
      </Group>
      <Group title="Kontextmenü" note="Native: lange drücken (mittleres Haptik-Feedback). Web: Knopf oder Rechtsklick. Im Menü Pfeiltasten, Pos1/Ende, Enter, Escape.">
        <Wrap>
          <ContextMenuButton items={MENU_ITEMS} label="Weitere Aktionen" variant="tonal" testID="DEV-01.overlays.menu" />
        </Wrap>
        <ContextMenuArea items={MENU_ITEMS} label="Aktionen für Nissan Skyline GT-R R34" style={styles.area} testID="DEV-01.overlays.menuArea">
          <Text variant="headline">Nissan Skyline GT-R R34</Text>
          <Text variant="callout" color="text.secondary">
            Lange drücken oder Rechtsklick für das Menü
          </Text>
        </ContextMenuArea>
      </Group>
      <Group title="Besitzer-Kapsel" note="Schwebt unten über dem Foto: Update posten als kleiner Primärknopf, dann Bearbeiten, Fotos, Mods, QR und Mehr. Unter 430 wandert Fotos in Mehr, QR bleibt sichtbar.">
        <Specimen label="Über einem Foto" fill>
          <FullBleed>
            <Photo {...PHOTOS.r34} aspect="4:5" style={styles.capsuleStage}>
              <OwnerCapsule
                label="Aktionen für deinen Build"
                primary={{ label: 'Update posten', onPress: noop }}
                actions={[
                  { key: 'edit', icon: 'pencil-simple', label: 'Bearbeiten', onPress: noop, priority: 1 },
                  { key: 'photos', icon: 'camera', label: 'Fotos', onPress: noop, priority: 3 },
                  { key: 'mods', icon: 'wrench', label: 'Mods', onPress: noop, priority: 2 },
                  { key: 'qr', icon: 'qr-code', label: 'QR-Code', onPress: noop, priority: 0 },
                ]}
                more={{ label: 'Mehr', items: MENU_ITEMS }}
                style={styles.capsule}
                testID="DEV-01.overlays.capsule"
              />
            </Photo>
          </FullBleed>
        </Specimen>
      </Group>
      <Group title="Darunter" note="Inhalt hinter Scrim und Blatt, damit der Layer sichtbar wird.">
        <Panel>
          <ListRow title="Benachrichtigungen" icon="bell" value="An" inset={16} divider />
          <ListRow title="Sprache" icon="info" value="Deutsch" inset={16} />
        </Panel>
        <Text variant="body" color="text.secondary">
          {'Seit 2019 in meiner Garage. Motor überholt, Fahrwerk auf KW\u00A0V3 umgebaut, die BBS\u00A0LM frisch aufbereitet.'}
        </Text>
      </Group>

      <Sheet visible={open === 'sheet'} onClose={close} title="Foto bearbeiten" testID="DEV-01.overlays.sheet">
        <SheetRows />
      </Sheet>

      <Sheet visible={open === 'sheet-full'} onClose={close} title="Marke wählen" initialSnap="full" expandable testID="DEV-01.overlays.sheetFull">
        {MAKES.map((make, index) => (
          <ListRow key={make} title={make} onPress={noop} inset={0} divider={index < MAKES.length - 1} chevron={false} />
        ))}
      </Sheet>

      <Sheet
        visible={open === 'sheet-form'}
        onClose={close}
        title="Mod hinzufügen"
        footer={<Button label="Speichern" size="l" fullWidth onPress={close} testID="DEV-01.overlays.sheetForm.save" />}
        testID="DEV-01.overlays.sheetForm"
      >
        <View style={styles.body}>
          <TextInput label="Name" defaultValue="KW V3" />
          <TextInput label="Tieferlegung" defaultValue="35" suffix="mm" keyboardType="numeric" />
          <ListRow
            title="Im Build-Verlauf anzeigen"
            control={<Switch value={notify} onValueChange={setNotify} label="Im Build-Verlauf anzeigen" />}
            inset={0}
          />
        </View>
      </Sheet>

      <Sheet visible={open === 'sheet-toast'} onClose={close} title="Foto speichern" testID="DEV-01.overlays.sheetToast">
        <Button label="Speichern" size="m" fullWidth onPress={showToast} testID="DEV-01.overlays.sheetToast.raise" />
      </Sheet>

      <Sheet
        visible={open === 'sheet-locked'}
        onClose={close}
        dismissable={false}
        title="Upload läuft"
        testID="DEV-01.overlays.sheetLocked"
      >
        <Button label="Fertig" size="m" fullWidth onPress={close} testID="DEV-01.overlays.sheetLocked.done" />
      </Sheet>

      <Dialog
        visible={open === 'dialog'}
        onClose={close}
        title="Änderungen verwerfen?"
        body="Deine Änderungen werden nicht gespeichert."
        actions={[
          { label: 'Weiter bearbeiten', variant: 'secondary', onPress: close },
          { label: 'Verwerfen', destructive: true, onPress: close },
        ]}
        testID="DEV-01.overlays.dialog"
      />

      <Dialog
        visible={open === 'dialog-destructive'}
        onClose={close}
        title="Fahrzeug löschen?"
        body="Nissan Skyline GT-R R34 wird mit allen Fotos und Mods gelöscht. Der QR-Code funktioniert danach nicht mehr."
        actions={[
          { label: 'Fahrzeug löschen', destructive: true, onPress: close },
          { label: 'Abbrechen', variant: 'secondary', onPress: close },
        ]}
        testID="DEV-01.overlays.dialogDestructive"
      />

      <Dialog
        visible={open === 'dialog-long'}
        onClose={close}
        title="Konto endgültig löschen?"
        body="Dein Konto wird mit allen Fahrzeugen, Fotos, Mods und Nachrichten gelöscht. Alle QR-Codes deiner Fahrzeuge funktionieren danach nicht mehr, auch die Sticker, die schon auf deinen Autos kleben. Wer sie scannt, sieht nur noch den Hinweis, dass der Link nicht mehr gültig ist. Deinen Benutzernamen kann für 90 Tage niemand übernehmen, danach wird er wieder frei. Daten, die wir gesetzlich aufbewahren müssen, bleiben bis zum Ablauf der Frist gesperrt gespeichert und werden dann gelöscht. Gib zur Bestätigung deinen Benutzernamen ein."
        actions={[
          { label: 'Konto löschen', destructive: true, onPress: close, testID: 'DEV-01.overlays.dialogLong.delete' },
          { label: 'Abbrechen', variant: 'secondary', onPress: close, testID: 'DEV-01.overlays.dialogLong.cancel' },
        ]}
        testID="DEV-01.overlays.dialogLong"
      >
        <TextInput label="Benutzername" testID="DEV-01.overlays.dialogLong.input" />
      </Dialog>

      {/* A fixed anchor near the top right, as a "more" button in a header would open it (for the screenshot matrix). */}
      <ContextMenu
        visible={open === 'menu'}
        anchor={{ x: window.width - 64, y: 64, width: 44, height: 44 }}
        items={MENU_ITEMS}
        label="Weitere Aktionen"
        onClose={close}
        testID="DEV-01.overlays.menuPanel"
      />

      <ImageViewer visible={open === 'viewer'} images={images} initialIndex={0} onClose={close} testID="DEV-01.overlays.viewer" />
    </SectionScreen>
  );
}
