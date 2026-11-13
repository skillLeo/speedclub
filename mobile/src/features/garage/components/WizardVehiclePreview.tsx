import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { GarageVehicle } from '@/api/queries/garage';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { ProfileHero } from '@/features/vehicle/components/ProfileHero';
import { ProfileSummary, VehicleIdentity } from '@/features/vehicle/components/ProfileSummary';
import { heroIdentityOverlap } from '@/features/vehicle/layout';
import { visiblePhotos } from '@/features/vehicle/media';
import { aspect, createStyles, space } from '@/theme';
import { Badge, Button, Photo, PhotoScrim, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { ratioOf } from '@/ui/Photo';

import { cardCaption } from '../card';
import { EMPTY_HERO } from '../sample';

const ROUTE = 'GAR-03.vehPreview';
const HERO_RATIO = ratioOf(aspect.hero);

const useStyles = createStyles((t) => ({
  // The dark stage of VEH-01 (ADR-421 b): the photo fades into it in every theme, the identity sits on it.
  stage: { backgroundColor: t.color.scrim.photoEnd, borderRadius: t.radius.xl, overflow: 'hidden' },
  identity: { paddingBottom: t.space[20], paddingHorizontal: t.space[16] },
  summary: { marginTop: t.space[16] },
  // Without a photo: the GAR-01 empty photo with its call to add one, never a grey box (DQ-1052).
  // DQ-1052: the stand-in photo is badged "Beispiel" (it is not the member's car), and the way to add one is a solid secondary
  // button, readable on any photo, instead of a hairline ghost.
  emptyAction: { alignItems: 'flex-start', gap: t.space[8], left: t.space[16], position: 'absolute', top: t.space[16] },
  emptyText: { gap: t.space[4], paddingBottom: t.space[20], paddingHorizontal: t.space[16] },
}));

export type WizardVehiclePreviewProps = {
  draft: GarageVehicle;
  /** The width the preview is laid out at: the form column on phones, the right pane on desktop. */
  width: number;
  /** "Foto hinzufügen" on the photo-less stage: back to the photos step. */
  onAddPhoto: () => void;
  /** The root's id in every state (`GAR-03.review.card`, which the flows and the axe spec wait for). */
  testID: string;
};

/**
 * GAR-03 step 4 "Vorschau" (09 §7.6, DQ-1052): the real VEH-01 render of the draft as others will see it — the 4:5 hero with the
 * identity on its scrim (VehicleIdentity, the same component and texts as VEH-01), then the SpecStrip (ProfileSummary). No
 * actions: it is a picture of the page, not the page. The owner reads the draft through the public endpoint (VehiclePolicy view).
 */
export function WizardVehiclePreview({ draft, width, onAddPhoto, testID }: WizardVehiclePreviewProps) {
  return (
    <View testID={testID}>
      <PreviewBody draft={draft} width={width} onAddPhoto={onAddPhoto} />
    </View>
  );
}

function PreviewBody({ draft, width, onAddPhoto }: Omit<WizardVehiclePreviewProps, 'testID'>) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const query = usePublicVehicle(draft.slug);
  const vehicle = query.data;
  const inner = Math.max(0, width - 2 * space[16]);
  const overlap = heroIdentityOverlap(width, HERO_RATIO);

  if (!vehicle) {
    if (query.isPending) {
      return (
        <Skeleton testID={`${ROUTE}.skeleton`}>
          <SkeletonBlock aspectRatio={HERO_RATIO} corner="xl" />
          <View style={styles.summary}>
            <SkeletonText variant="heroNumeral" width="60%" />
          </View>
        </Skeleton>
      );
    }
    // Not readable (offline before the first read): the draft's own words on the same stage, so the step never shows a hole.
    return <EmptyStage title={draft.full_title.trim() || t('wizard.untitled')} caption={cardCaption(draft)} overlap={overlap} onAddPhoto={onAddPhoto} />;
  }

  const photos = visiblePhotos(vehicle.photos);
  return (
    <View role="group" aria-label={t('review.previewLabel')} testID={ROUTE}>
      {photos.length > 0 ? (
        <View style={styles.stage}>
          <ProfileHero
            photos={photos}
            width={width}
            corner="none"
            vehicleTitle={vehicle.full_title}
            ownerUsername={vehicle.owner?.username}
            onOpen={() => undefined}
            ratio={HERO_RATIO}
            aspect="4:5"
            identityOverlap={overlap}
            routeId={ROUTE}
          />
          <VehicleIdentity vehicle={vehicle} routeId={ROUTE} tone="photo" layoutWidth={inner} style={[styles.identity, { marginTop: -overlap }]} />
        </View>
      ) : (
        <EmptyStage title={vehicle.title} caption={cardCaption(draft)} overlap={overlap} onAddPhoto={onAddPhoto} />
      )}
      <ProfileSummary vehicle={vehicle} routeId={ROUTE} layoutWidth={width} style={styles.summary} />
    </View>
  );
}

function EmptyStage({ title, caption, overlap, onAddPhoto }: { title: string; caption?: string; overlap: number; onAddPhoto: () => void }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View style={styles.stage} testID={`${ROUTE}.empty`}>
      <Photo {...EMPTY_HERO} aspect="4:5">
        <PhotoScrim />
        <View style={styles.emptyAction}>
          <Badge kind="sample" tone="onPhoto" testID={`${ROUTE}.emptySample`} />
          <Button label={t('photos.addShort')} variant="secondary" size="s" icon="camera" onPress={onAddPhoto} testID={`${ROUTE}.addPhoto`} />
        </View>
      </Photo>
      <View style={[styles.emptyText, { marginTop: -overlap }]}>
        <Text variant="displayTitle" color="onPhoto.primary" hyphenate={false}>
          {title}
        </Text>
        {caption ? (
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
