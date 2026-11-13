import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { BuildUpdate, VehicleMedia } from '@/api/queries/vehicles';
import { unpairedPhotos, updatePairs } from '@/features/updates/model';
import { useFormat } from '@/lib/useFormat';
import { createStyles, layout as layoutTokens } from '@/theme';
import { Photo, PressableScale, SectionHeader, Text } from '@/ui';

import { photoFields } from '../media';
import { updateHeadline } from '../model';

const useStyles = createStyles((t) => ({
  header: { marginBottom: t.space[12] },
  // 44 at least, also for a text-only entry of one caption and one line (DOM audit, 09 §4.10).
  card: { gap: t.space[8], minHeight: t.size.touchMin },
  photo: { borderRadius: t.radius.md, overflow: 'hidden' },
}));

export type LatestUpdateProps = {
  update: BuildUpdate;
  routeId: string;
  onOpen: (update: BuildUpdate) => void;
  onShowAll: () => void;
  /** DQ-1054: the car's photo for an update without photos of its own, labelled "Foto aus der Galerie". */
  fallbackPhoto?: VehicleMedia | null;
};

/**
 * 09 §7.6 Übersicht: the newest entry of Verlauf as a feed card — its first photo (the "after" of a pair), the kind and the date,
 * the text in three lines. Opens VEH-05; "Ganzer Verlauf" switches to the tab.
 */
export function LatestUpdate({ update, routeId, onOpen, onShowAll, fallbackPhoto = null }: LatestUpdateProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const pair = updatePairs(update)[0];
  const own = pair?.after ?? unpairedPhotos(update)[0] ?? null;
  const photo = own ?? fallbackPhoto;
  const when = update.created_at ? format.date(new Date(update.created_at)) : null;
  // DQ-1059: the kind once — the title names the change, the meta carries its system and the date.
  const head = updateHeadline(update, (key, values) => t(`history.title.${key}`, values));
  const meta = [head.system, when, update.edited_at ? t('update.edited') : null]
    .filter(Boolean)
    .join(' · ');
  // DQ-1059/1085: a note (or post) is titled by its own words, never "Notiz"; its kind is clear from what it says.
  const note = update.type === 'note' || update.type === 'post' ? update.note?.trim() || null : null;
  const title = note ?? head.title;
  const text = note ? null : update.note?.trim() || (head.namesChange ? null : update.summary);
  const testID = `${routeId}.latest`;
  return (
    <View testID={testID}>
      <SectionHeader
        title={t('latest.title')}
        actionLabel={t('latest.all')}
        onAction={onShowAll}
        wraps
        style={styles.header}
        testID={`${testID}.header`}
      />
      <PressableScale
        role="link"
        aria-label={[title, meta, text].filter(Boolean).join('. ')}
        onPress={() => onOpen(update)}
        style={styles.card}
        testID={`${testID}.card`}
      >
        {photo ? (
          <View style={styles.photo}>
            <Photo {...photoFields(photo, layoutTokens.feedColumn)} aspect={own ? '4:5' : '16:9'} corner="md" />
          </View>
        ) : null}
        {photo && !own ? (
          <Text variant="caption" color="text.tertiary" testID={`${testID}.fallbackPhoto`}>
            {t('update.galleryPhoto')}
          </Text>
        ) : null}
        <Text variant="headline" numberOfLines={note ? 3 : 2} testID={`${testID}.title`}>
          {title}
        </Text>
        <Text variant="caption" color="text.secondary">
          {meta}
        </Text>
        {text ? (
          <Text variant="body" numberOfLines={3}>
            {text}
          </Text>
        ) : null}
      </PressableScale>
    </View>
  );
}
