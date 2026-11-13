import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  HIGHLIGHTS_MAX,
  useHighlights,
  useSetHighlights,
  type Highlight,
  type HighlightPick,
} from '@/api/queries/social2';
import type { BuildUpdate, PublicVehicle, VehicleMedia } from '@/api/queries/vehicles';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { Button, Checkbox, Photo, PressableScale, SectionHeader, Sheet, Text, toast } from '@/ui';

import { photoFields, visiblePhotos } from '../media';

const CARD = size.railCard;

const useStyles = createStyles((t) => ({
  header: { marginBottom: t.space[12] },
  row: { gap: t.space[12] },
  card: { borderRadius: t.radius.md, overflow: 'hidden', width: CARD },
  textCard: {
    aspectRatio: 3 / 4,
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    justifyContent: 'flex-end',
    padding: t.space[12],
    width: CARD,
  },
  caption: { marginTop: t.space[8], width: CARD },
  ownerEmpty: { gap: t.space[8] },
  editorGroup: { gap: t.space[8], marginBottom: t.space[20] },
  editorList: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[4],
    padding: t.space[12],
  },
  editorPhotos: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  editorPhoto: { gap: t.space[4], width: t.size.thumb.card },
}));

export type HighlightsRailProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** Edge-to-edge scroll on a phone: the rail starts on the gutter and runs to the screen edge. */
  bleed: number;
  onOpenUpdate: (updateId: string) => void;
  onOpenPhoto: (index: number) => void;
  /** The rail's own gap to its neighbours, applied only when it shows (DQ-1056). */
  style?: StyleProp<ViewStyle>;
};

/** The first photo with a file of an update, for its card. */
function coverOf(update: BuildUpdate | null): VehicleMedia | null {
  return update ? (update.photos.find((photo) => photo.variants.length > 0) ?? null) : null;
}

/**
 * 09 §8.5 Highlights: up to 8 updates or photos the owner pins to the build, permanent (no stories). 3:4 rail cards, radius 12.
 * Visitors see the rail only when it has items; the owner also sees an invitation and edits the rail in a sheet.
 */
export function HighlightsRail({ vehicle, routeId, bleed, onOpenUpdate, onOpenPhoto, style }: HighlightsRailProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const own = vehicle.is_owner;
  const query = useHighlights(vehicle.id);
  const [editing, setEditing] = useState(false);
  const items = query.data ?? [];
  const photos = useMemo(() => visiblePhotos(vehicle.photos), [vehicle.photos]);
  const testID = `${routeId}.pins`;

  if (!query.isSuccess) return null;
  if (items.length === 0 && !own) return null;

  const dateOf = (update: BuildUpdate) => (update.created_at ? format.date(new Date(update.created_at)) : '');
  const open = (item: Highlight) => {
    if (item.type === 'build_update' && item.build_update) onOpenUpdate(item.build_update.id);
    if (item.type === 'photo' && item.photo) {
      const index = photos.findIndex((photo) => photo.id === item.photo?.id);
      if (index >= 0) onOpenPhoto(index);
    }
  };

  return (
    <View style={style} testID={testID}>
      <SectionHeader
        title={t('highlights.title')}
        // DQ-1076: an empty rail has one action, "Highlights auswählen", not a second "Bearbeiten" in its header.
        {...(own && items.length > 0 ? { actionLabel: t('highlights.edit'), onAction: () => setEditing(true) } : {})}
        style={styles.header}
        testID={`${testID}.header`}
      />
      {items.length === 0 ? (
        <View style={styles.ownerEmpty} testID={`${testID}.empty`}>
          <Text variant="callout" color="text.secondary">
            {t('highlights.emptyOwner')}
          </Text>
          <Button
            label={t('highlights.pick')}
            variant="secondary"
            size="m"
            onPress={() => setEditing(true)}
            testID={`${testID}.pick`}
          />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -bleed }}
          contentContainerStyle={[styles.row, { paddingHorizontal: bleed }]}
          testID={`${testID}.rail`}
        >
          {items.map((item, index) => {
            const update = item.type === 'build_update' ? item.build_update : null;
            const media = item.type === 'photo' ? item.photo : coverOf(update);
            const label = update
              ? update.summary || update.type_label
              : t('highlights.photoAlt', { n: index + 1 });
            return (
              <PressableScale
                key={`${item.type}-${item.id}`}
                role="button"
                aria-label={label}
                onPress={() => open(item)}
                testID={`${testID}.${index}`}
              >
                {media ? (
                  <View style={styles.card}>
                    <Photo {...photoFields(media, CARD)} aspect="3:4" corner="md" />
                  </View>
                ) : (
                  <View style={styles.textCard}>
                    <Text variant="headline" numberOfLines={4}>
                      {update?.note?.trim() || label}
                    </Text>
                  </View>
                )}
                {update ? (
                  <Text variant="caption" color="text.secondary" numberOfLines={2} style={styles.caption}>
                    {update.type_label} · {dateOf(update)}
                  </Text>
                ) : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      )}
      {own ? (
        <HighlightsEditor
          visible={editing}
          onClose={() => setEditing(false)}
          vehicle={vehicle}
          current={items}
          photos={photos}
          testID={`${testID}.editor`}
        />
      ) : null}
    </View>
  );
}

type EditorProps = {
  visible: boolean;
  onClose: () => void;
  vehicle: PublicVehicle;
  current: readonly Highlight[];
  photos: readonly VehicleMedia[];
  testID: string;
};

const keyOf = (pick: HighlightPick) => `${pick.type}:${pick.id}`;

/** The owner's pin editor: updates and photos with a checkbox each, at most 8, kept in the order they were chosen. */
function HighlightsEditor({ visible, onClose, vehicle, current, photos, testID }: EditorProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const setHighlights = useSetHighlights(vehicle.id);
  const [picks, setPicks] = useState<HighlightPick[] | null>(null);
  const chosen = picks ?? current.map((item) => ({ type: item.type, id: item.id }));
  const updates = vehicle.updates.filter((update) => !update.hidden);
  const has = (pick: HighlightPick) => chosen.some((entry) => keyOf(entry) === keyOf(pick));
  const toggle = (pick: HighlightPick, next: boolean) => {
    if (next && chosen.length >= HIGHLIGHTS_MAX) {
      toast(t('highlights.editorFull', { max: HIGHLIGHTS_MAX }), {
        haptic: 'warning',
        testID: `${testID}.toast`,
      });
      return;
    }
    setPicks(next ? [...chosen, pick] : chosen.filter((entry) => keyOf(entry) !== keyOf(pick)));
  };
  const close = () => {
    setPicks(null);
    onClose();
  };
  const save = () =>
    setHighlights.mutate(chosen, {
      onSuccess: () => {
        toast(t('highlights.saved'), { testID: `${testID}.toast` });
        close();
      },
      onError: (error) =>
        toast(error.message || t('highlights.failed'), { haptic: 'warning', testID: `${testID}.toast` }),
    });

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('highlights.editorTitle')}
      label={t('highlights.editorTitle')}
      footer={
        <Button
          label={t('highlights.save')}
          onPress={save}
          loading={setHighlights.isPending}
          fullWidth
          testID={`${testID}.save`}
        />
      }
      testID={testID}
    >
      <Text variant="callout" color="text.secondary" style={styles.editorGroup}>
        {t('highlights.editorHint', { max: HIGHLIGHTS_MAX })}
      </Text>
      {updates.length > 0 ? (
        <View style={styles.editorGroup}>
          <SectionHeader title={t('highlights.updates')} />
          <View style={styles.editorList}>
            {updates.map((update) => {
              const pick: HighlightPick = { type: 'build_update', id: update.id };
              return (
                <Checkbox
                  key={update.id}
                  checked={has(pick)}
                  onChange={(next) => toggle(pick, next)}
                  label={`${update.summary || update.type_label} · ${update.created_at ? format.date(new Date(update.created_at)) : ''}`}
                  showLabel
                  testID={`${testID}.update.${update.id}`}
                />
              );
            })}
          </View>
        </View>
      ) : null}
      {photos.length > 0 ? (
        <View style={styles.editorGroup}>
          <SectionHeader title={t('highlights.photos')} />
          <View style={styles.editorPhotos}>
            {photos.map((photo, index) => {
              const pick: HighlightPick = { type: 'photo', id: photo.id };
              return (
                <View key={photo.id} style={styles.editorPhoto}>
                  <Photo {...photoFields(photo, size.thumb.card)} aspect="1:1" corner="sm" />
                  <Checkbox
                    checked={has(pick)}
                    onChange={(next) => toggle(pick, next)}
                    label={t('highlights.photoAlt', { n: index + 1 })}
                    testID={`${testID}.photo.${photo.id}`}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
