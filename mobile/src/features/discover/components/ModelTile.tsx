import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { aspect, createStyles, fontScaleCap, typeScale } from '@/theme';
import { Photo, PressableScale, SampleBadges, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { ratioOf } from '@/ui/Photo';
import { joinLabel } from '@/ui/rowParts';

const useStyles = createStyles((t) => ({
  // 09 §5 rail card: the photo 3:4 radius 12, the name and its caption below it.
  text: { gap: t.space[2], marginTop: t.space[8] },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  hover: { backgroundColor: t.color.state.hover, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
}));

/**
 * The cover of a model on DISC-03: the newest build of that model among the make's builds that has a photo. The API sends no
 * cover per model (lane B gap `models[].cover`), so the make's newest builds stand in; a model without one keeps the quiet stage.
 */
export function modelCovers(models: readonly { slug: string; name: string }[], builds: readonly FeedVehicle[]): ReadonlyMap<string, FeedVehicle> {
  const covers = new Map<string, FeedVehicle>();
  const bySlug = new Map(models.map((model) => [model.name.trim().toLowerCase(), model.slug]));
  for (const build of builds) {
    const slug = build.model ? bySlug.get(build.model.trim().toLowerCase()) : undefined;
    if (slug && build.cover && !covers.has(slug)) covers.set(slug, build);
  }
  return covers;
}

export type ModelTileProps = {
  name: string;
  count: number;
  /** The build whose cover stands for the model, or none. */
  cover?: FeedVehicle;
  width: number;
  onOpen: () => void;
  /** `DISC-03.model.<slug>`: `.photo`, `.name`, `.count`, `.sample`. */
  testID: string;
};

/**
 * DQ-1028: one model of DISC-03 as a rail card (09 §5): its top build's cover 3:4 at radius 12, the model as its wordmark in
 * `display.wordmark` (cars speak Archivo) and the real count of builds in tnum. Opens DISC-04.
 */
export const ModelTile = memo(function ModelTile({ name, count, cover, width, onOpen, testID }: ModelTileProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const format = useFormat();
  const countLabel = t('make.modelCount', { count, formatted: format.number(count) });
  return (
    <PressableScale role="link" aria-label={isWeb ? undefined : joinLabel([name, countLabel])} onPress={onOpen} ring="card" testID={testID}>
      {(state) => (
        <>
          <Photo {...photoFields(cover?.cover ?? null, width)} aspect={aspect.rail} corner="md" testID={`${testID}.photo`}>
            {state.hovered ? <View style={styles.hover} /> : null}
            {cover ? <SampleBadges flags={{ is_sample: cover.is_sample }} tone="onPhoto" style={styles.badges} testID={`${testID}.sample`} /> : null}
          </Photo>
          <View style={styles.text}>
            <Text
              variant="displayWordmark"
              fontScaleCap={fontScaleCap.pill}
              hyphenate={false}
              numberOfLines={typeScale.displayWordmark.maxLines}
              testID={`${testID}.name`}
            >
              {keepNameTogether(name)}
            </Text>
            <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={`${testID}.count`}>
              {countLabel}
            </Text>
          </View>
        </>
      )}
    </PressableScale>
  );
});

/** The tile while the make loads: the 3:4 photo block at radius 12, the wordmark and the count line. */
export function ModelTileSkeleton({ width }: { width: number }) {
  const styles = useStyles();
  return (
    <View style={{ width }}>
      <SkeletonBlock aspectRatio={ratioOf(aspect.rail)} corner="md" />
      <View style={styles.text}>
        <SkeletonText variant="displayWordmark" width="70%" />
        <SkeletonText variant="caption" width="40%" />
      </View>
    </View>
  );
}
