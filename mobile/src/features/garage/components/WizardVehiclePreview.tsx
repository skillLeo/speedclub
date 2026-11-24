import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { GarageVehicle } from '@/api/queries/garage';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { ProfileHero } from '@/features/vehicle/components/ProfileHero';
import { ProfileSummary, VehicleIdentity } from '@/features/vehicle/components/ProfileSummary';
import { heroIdentityOverlap, scrimOverlapDataSet } from '@/features/vehicle/layout';
import { visiblePhotos } from '@/features/vehicle/media';
import { aspect, createStyles, space } from '@/theme';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { PhotoScrim } from '@/ui/PhotoScrim';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { ratioOf } from '@/ui/Photo';

import { catalogueCaption } from '../card';
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
    return <EmptyStage title={draft.full_title.trim() || t('wizard.untitled')} caption={catalogueCaption(draft)} overlap={overlap} onAddPhoto={onAddPhoto} width={width} />;
  }

  const photos = visiblePhotos(vehicle.photos);
  return (
    <View role="group" aria-label={t('review.previewLabel')} testID={ROUTE}>
      {photos.length > 0 ? (
        <View style={styles.stage} testID={`${ROUTE}.stage`}>
          <ProfileHero
            photos={photos}
            width={width}
            corner="none"
            vehicleTitle={vehicle.full_title}
            onOpen={() => undefined}
            ratio={HERO_RATIO}
            aspect="4:5"
            identityOverlap={overlap}
            routeId={ROUTE}
          />
          <VehicleIdentity
            vehicle={vehicle}
            routeId={ROUTE}
            tone="photo"
            layoutWidth={inner}
            dataSet={scrimOverlapDataSet(overlap)}
            style={[styles.identity, { marginTop: -overlap }]}
          />
        </View>
      ) : (
        <EmptyStage title={vehicle.title} caption={catalogueCaption(draft)} overlap={overlap} onAddPhoto={onAddPhoto} width={width} />
      )}
      <ProfileSummary vehicle={vehicle} routeId={ROUTE} layoutWidth={width} style={styles.summary} />
    </View>
  );
}

function EmptyStage({ title, caption, overlap, onAddPhoto, width }: { title: string; caption?: string; overlap: number; onAddPhoto: () => void; width: number }) {
  return <Stage photo={null} title={title} caption={caption} overlap={overlap} onAddPhoto={onAddPhoto} route={ROUTE} width={width} />;
}

/**
 * The stage both previews share: the draft's cover, or (without one) the GAR-01 empty photo badged "Beispiel" with "Foto
 * hinzufügen" on it (DQ-1052), never a grey box; the name in `display.title` and the meta line on the scrim.
 */
function Stage({
  photo,
  title,
  caption,
  overlap,
  onAddPhoto,
  route,
  width,
}: {
  photo: PhotoFields | null;
  title: string;
  caption?: string;
  overlap: number;
  onAddPhoto?: () => void;
  route: string;
  /** The stage's width: the title is laid out at it less the side padding. */
  width: number;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const inner = Math.max(0, width - 2 * space[16]);
  const own = photo?.source ? photo : null;
  return (
    <View style={styles.stage} testID={`${route}.${own ? 'stage' : 'empty'}`}>
      <Photo {...(own ?? EMPTY_HERO)} aspect="4:5">
        <PhotoScrim />
        {own ? null : (
          <View style={styles.emptyAction}>
            <Badge kind="sample" tone="onPhoto" testID={`${route}.emptySample`} />
            {onAddPhoto ? (
              <Button label={t('photos.addShort')} variant="secondary" size="s" icon="camera" onPress={onAddPhoto} testID={`${route}.addPhoto`} />
            ) : null}
          </View>
        )}
      </Photo>
      <View style={[styles.emptyText, { marginTop: -overlap }]} dataSet={scrimOverlapDataSet(overlap)}>
        {/* A card title (30/34 at every width, 24/28 when that saves a line), never the desktop page size in the narrow pane. The
            placeholder "Neues Fahrzeug" is copy, which may hyphenate; a car name only wraps at its spaces. */}
        <DisplayTitle placement="card" kind={title === t('wizard.untitled') ? 'copy' : 'vehicle'} color="onPhoto.primary" layoutWidth={inner}>
          {title}
        </DisplayTitle>
        {caption ? (
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export type WizardDraftPreviewProps = {
  /** The live card data of steps 1–3 (`usePreview`): name, sub-line, cover, spec chips. */
  preview: { title: string; subtitle?: string; photo: PhotoFields; specs?: readonly string[] };
  /** The pane's inner width. */
  width: number;
  /** "Foto hinzufügen" on the sample stage; left out where the step itself adds photos or no draft exists yet. */
  onAddPhoto?: () => void;
  testID: string;
};

/**
 * DQ-1218: the desktop Vorschau pane of steps 1–3, the review step's stage at the pane's width: the draft's cover, else the badged
 * sample stage with "Foto hinzufügen"; the name on the scrim and one meta line ("2002 · 2,6 l R6 Biturbo · AWD"), never a pill.
 */
export function WizardDraftPreview({ preview, width, onAddPhoto, testID }: WizardDraftPreviewProps) {
  const overlap = heroIdentityOverlap(width, HERO_RATIO);
  const meta = [preview.subtitle, ...(preview.specs ?? [])].filter((part): part is string => Boolean(part && part.trim())).join(' · ');
  return (
    // The stage keeps the review step's ids (`GAR-03.vehPreview.empty|stage`): steps 1–3 and step 4 never show both panes at once, and
    // they are the stages whose identity may reach into the photo (dom-audit SCRIM_OVERLAP_STAGES, ADR-465 c).
    <View style={{ width }} testID={testID}>
      <Stage photo={preview.photo} title={preview.title} caption={meta || undefined} overlap={overlap} onAddPhoto={onAddPhoto} route={ROUTE} width={width} />
    </View>
  );
}
