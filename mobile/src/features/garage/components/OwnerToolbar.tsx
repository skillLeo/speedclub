import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { createStyles, space } from '@/theme';
import { ListRow, Progress, Sheet, Text, type ContextMenuItem, type OwnerCapsuleAction } from '@/ui';

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  head: { gap: t.space[8] },
  list: { marginHorizontal: -t.space[16], marginBottom: -t.space[8] },
}));


/**
 * DQ-1062: GAR-02 is the VEH-01 owner composition (09 §7.6 "= VEH-01 + OwnerCapsule + completeness card"). The capsule's glyph
 * actions keep the toolbar's test IDs (`GAR-02.tool.edit`, `.mods`, `.photos`, `.qr`); Sichtbarkeit and Teilen go into "Mehr".
 * "Bearbeiten" asks what: Grunddaten, Technik or Verlauf (`OwnerEditSheet`).
 */
export function ownerCapsuleOf(
  vehicle: PublicVehicle,
  routeId: string,
  { t, go, onEdit, onShare }: { t: TFunction<'garage'>; go: (path: string) => void; onEdit: () => void; onShare: () => void },
): { actions: OwnerCapsuleAction[]; more: ContextMenuItem[] } {
  const base = `/garage/${vehicle.id}`;
  const actions: OwnerCapsuleAction[] = [
    // In the garage "Bearbeiten" is the first tool (priority 0): it stays in the capsule wherever only one glyph fits.
    ...(vehicle.qr ? [{ key: 'qr', icon: 'qr-code' as const, label: t('owner.qr'), onPress: () => go(`/qr/${vehicle.id}`), priority: 1, testID: `${routeId}.tool.qr` }] : []),
    { key: 'edit', icon: 'pencil-simple', label: t('owner.edit'), onPress: onEdit, priority: 0, testID: `${routeId}.tool.edit` },
    { key: 'mods', icon: 'wrench', label: t('owner.mods'), onPress: () => go(`${base}/mods`), priority: 2, testID: `${routeId}.tool.mods` },
    { key: 'photos', icon: 'image', label: t('owner.photos'), onPress: () => go(`${base}/photos`), priority: 3, testID: `${routeId}.tool.photos` },
  ];
  const more: ContextMenuItem[] = [
    { key: 'visibility', icon: vehicle.visibility === 'private' ? 'lock-simple' : 'eye', label: t('owner.visibility'), onSelect: () => go(`${base}/visibility`) },
    ...(vehicle.status === 'published' && vehicle.visibility !== 'private' ? [{ key: 'share', icon: 'share-network' as const, label: t('owner.share'), onSelect: onShare }] : []),
  ];
  return { actions, more };
}

/** "Bearbeiten" on GAR-02: Grunddaten, Technik or Verlauf. */
export function OwnerEditSheet({ vehicle, routeId, visible, onClose }: { vehicle: PublicVehicle; routeId: string; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const base = `/garage/${vehicle.id}`;
  const editRows = [
    { key: 'basics', icon: 'pencil-simple' as const, title: t('owner.editBasics'), subtitle: t('owner.editBasicsHint'), path: `${base}/basics` },
    { key: 'specs', icon: 'engine' as const, title: t('owner.editSpecs'), subtitle: t('owner.editSpecsHint'), path: `${base}/specs` },
    ...(vehicle.status === 'published'
      ? [{ key: 'history', icon: 'list' as const, title: t('owner.editHistory'), subtitle: t('owner.editHistoryHint'), path: `${base}/history` }]
      : []),
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('owner.editTitle')} expandable={false} narrow testID={`${routeId}.editSheet`}>
      {editRows.map((row, index) => (
        <ListRow
          key={row.key}
          icon={row.icon}
          title={row.title}
          subtitle={row.subtitle}
          onPress={() => {
            onClose();
            router.push(row.path as never);
          }}
          inset={space[0]}
          divider={index < editRows.length - 1}
          testID={`${routeId}.editSheet.${row.key}`}
        />
      ))}
    </Sheet>
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
        <Text variant="headline" role="heading" {...({ 'aria-level': 2 } as object)}>
          {completeness.line}
        </Text>
        <Progress value={completeness.percent / 100} label={completeness.line} />
        {completeness.hint ? (
          <Text variant="callout" color="text.secondary" testID={`${routeId}.completeness.hint`}>
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
