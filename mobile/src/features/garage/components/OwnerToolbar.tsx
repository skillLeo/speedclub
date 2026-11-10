import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { createStyles, space } from '@/theme';
import { Button, ListRow, Progress, Sheet, Text, type IconName } from '@/ui';

const useStyles = createStyles((t) => ({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  head: { gap: t.space[8] },
  list: { marginHorizontal: -t.space[16], marginBottom: -t.space[8] },
}));

type ToolKey = 'edit' | 'mods' | 'photos' | 'qr' | 'visibility';
type Tool = { key: ToolKey; icon: IconName; label: string; onPress: () => void };

/** The tools in their order. QR only for a vehicle with a code; a draft has none yet. */
function toolKeys(hasQr: boolean): ToolKey[] {
  return hasQr ? ['edit', 'mods', 'photos', 'qr', 'visibility'] : ['edit', 'mods', 'photos', 'visibility'];
}

/** The toolbar's labels, for the loading state of GAR-02, which draws the same buttons as blocks (DQ-178). */
export function ownerToolLabels(t: TFunction<'garage'>, hasQr: boolean): string[] {
  return toolKeys(hasQr).map((key) => t(`owner.${key}`));
}

/**
 * GAR-02 owner toolbar (04_SCREEN_REGISTER): Bearbeiten, Mods, Fotos, QR, Sichtbarkeit. Secondary S buttons that wrap at a
 * large font rather than scroll, so no action hides. "Bearbeiten" asks what: Grunddaten, Technik or Verlauf.
 */
export function OwnerToolbar({ vehicle, routeId }: { vehicle: PublicVehicle; routeId: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const base = `/garage/${vehicle.id}`;
  const go = (path: string) => router.push(path as never);
  const actions: Record<ToolKey, Omit<Tool, 'key' | 'label'>> = {
    edit: { icon: 'pencil-simple', onPress: () => setEditing(true) },
    mods: { icon: 'wrench', onPress: () => go(`${base}/mods`) },
    photos: { icon: 'image', onPress: () => go(`${base}/photos`) },
    qr: { icon: 'qr-code', onPress: () => go(`/qr/${vehicle.id}`) },
    visibility: { icon: vehicle.visibility === 'private' ? 'lock-simple' : 'eye', onPress: () => go(`${base}/visibility`) },
  };
  const tools: Tool[] = toolKeys(Boolean(vehicle.qr)).map((key) => ({ key, label: t(`owner.${key}`), ...actions[key] }));
  const editRows = [
    { key: 'basics', icon: 'pencil-simple' as const, title: t('owner.editBasics'), subtitle: t('owner.editBasicsHint'), path: `${base}/basics` },
    { key: 'specs', icon: 'engine' as const, title: t('owner.editSpecs'), subtitle: t('owner.editSpecsHint'), path: `${base}/specs` },
    ...(vehicle.status === 'published'
      ? [{ key: 'history', icon: 'list' as const, title: t('owner.editHistory'), subtitle: t('owner.editHistoryHint'), path: `${base}/history` }]
      : []),
  ];
  return (
    <>
      <View role="toolbar" aria-label={t('owner.toolbar')} style={styles.toolbar} testID={`${routeId}.tools`}>
        {tools.map((tool) => (
          <Button key={tool.key} label={tool.label} icon={tool.icon} variant="secondary" size="s" onPress={tool.onPress} testID={`${routeId}.tool.${tool.key}`} />
        ))}
      </View>
      <Sheet visible={editing} onClose={() => setEditing(false)} title={t('owner.editTitle')} expandable={false} narrow testID={`${routeId}.editSheet`}>
        {editRows.map((row, index) => (
          <ListRow
            key={row.key}
            icon={row.icon}
            title={row.title}
            subtitle={row.subtitle}
            onPress={() => {
              setEditing(false);
              go(row.path);
            }}
            inset={space[0]}
            divider={index < editRows.length - 1}
            testID={`${routeId}.editSheet.${row.key}`}
          />
        ))}
      </Sheet>
    </>
  );
}

const SECTION_PATH: Record<string, string> = { basics: 'basics', specs: 'specs', photos: 'photos', mods: 'mods' };

/**
 * GAR-02's first block of Übersicht: "Build zu 70 % vollständig", the bar, the server's hint ("Noch 3 Angaben bis zum
 * vollständigen Build") and one row per missing item, each leading to the editor that fills it.
 */
export function CompletenessHints({ vehicle, routeId }: { vehicle: PublicVehicle; routeId: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const completeness = vehicle.completeness;
  if (!completeness || completeness.is_complete) return null;
  const missing = completeness.missing;
  return (
    <View style={styles.card} testID={`${routeId}.completeness`}>
      <View style={styles.head}>
        <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)}>
          {completeness.line}
        </Text>
        <Progress value={completeness.percent / 100} label={completeness.line} />
        {completeness.hint ? (
          <Text variant="supporting" color="text.secondary" testID={`${routeId}.completeness.hint`}>
            {completeness.hint}
          </Text>
        ) : null}
      </View>
      {missing.length > 0 ? (
        <View style={styles.list}>
          {missing.map((item, index) => {
            const section = SECTION_PATH[item.section];
            const path = section === 'mods' ? `/garage/${vehicle.id}/mods` : section ? `/garage/${vehicle.id}/${section}` : null;
            return (
              <ListRow
                key={item.key}
                title={item.label}
                value={path ? t('owner.fill') : undefined}
                // DQ-179: "Ergänzen" moves under the title once the title would squeeze beside it ("Mindes- / tens 3").
                adaptiveValue
                onPress={path ? () => router.push(path as never) : undefined}
                inset={space[16]}
                divider={index < missing.length - 1}
                testID={`${routeId}.completeness.${item.key}`}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** A private or unlisted vehicle says so first, with the way to change it. */
export function VisibilityNote({ vehicle, routeId }: { vehicle: PublicVehicle; routeId: string }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  if (vehicle.status === 'published' && vehicle.visibility === 'public') return null;
  const key = vehicle.status === 'draft' ? 'draft' : vehicle.visibility;
  return (
    <ListRow
      icon={key === 'private' ? 'lock-simple' : key === 'draft' ? 'pencil-simple' : 'link'}
      title={t(`owner.note.${key}.title`)}
      subtitle={t(`owner.note.${key}.body`)}
      onPress={() =>
        key === 'draft'
          ? router.push(`/add-vehicle/${vehicle.id}/review` as never, { withAnchor: true })
          : router.push(`/garage/${vehicle.id}/visibility` as never)
      }
      inset={space[0]}
      testID={`${routeId}.visibilityNote`}
    />
  );
}
