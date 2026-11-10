import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { useFlag } from '@/api/queries/appConfig';
import { useUpdateMedia, type GarageMedia, type GarageVehicle, type MediaPatch } from '@/api/queries/garage';
import { KnownTextSkeleton, linesInHeight } from '@/features/vehicle/components/KnownTextSkeleton';
import type { MediaCategory } from '@/api/queries/vehicles';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { MEDIA_CATEGORIES, photoFields } from '@/features/vehicle/media';
import { paramOf } from '@/features/vehicle/navigation';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { buttonChrome, buttonHeight, estimatedLabelWidth } from '@/features/vehicle/skeletonGeometry';
import { createStyles, layout, size, space, typography, useBreakpoint, useTheme } from '@/theme';
import { Button, Photo, PressableScale, Skeleton, SkeletonBlock, SkeletonText, Text, TextInput, toast } from '@/ui';
import { keyOf } from '@/ui/useRovingKeys';
import { PhotoCategoryAssist } from '@/features/ai/PhotoCategoryAssist';

import { BlurTool, PLATE_BLUR_FLAG } from '../components/BlurTool';
import { ChoiceChips, FieldPair, FormGroup, useCharCount } from '../components/fields';
import { CentredState, EditorForm, EditorScreen, FORM_MAX_WIDTH, GoneState, RestrictedNotice } from '../components/frames';
import { saveErrorMessage } from '../errors';
import { ALT_MAX_LENGTH, fieldMessage, photoDetailsSchema } from '../schemas';
import { useOwnVehicle } from '../useOwnVehicle';

const ROUTE = 'GAR-08';
/** One arrow key press or one screen-reader action moves the point by this share of the photo. */
const KEY_STEP = 0.05;
type Delta = readonly [number, number];
const FOCUS_KEYS: Partial<Record<string, Delta>> = {
  ArrowLeft: [-KEY_STEP, 0],
  ArrowRight: [KEY_STEP, 0],
  ArrowUp: [0, -KEY_STEP],
  ArrowDown: [0, KEY_STEP],
};
const FOCUS_ACTIONS: Partial<Record<string, Delta>> = {
  moveLeft: [-KEY_STEP, 0],
  moveRight: [KEY_STEP, 0],
  moveUp: [0, -KEY_STEP],
  moveDown: [0, KEY_STEP],
};
const CENTRE = 0.5;
const ALT_ROWS = 3;
/** The whole photo stays in view: at most 480 high on wide screens. */
const STAGE_MAX_HEIGHT = (layout.feedColumn * 3) / 4;
/** The skeleton's stage before the photo is known: a portrait phone photo. */
const SKELETON_STAGE_RATIO = 4 / 5;

type Values = { alt: string; category: MediaCategory; x: number; y: number };

const useStyles = createStyles((t) => ({
  stage: { alignSelf: 'center', borderRadius: t.radius.md, overflow: 'hidden', width: '100%' },
  marker: {
    borderColor: t.color.onPhoto.primary,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.focusRing,
    height: t.size.icon.l,
    marginLeft: -t.size.icon.l / 2,
    marginTop: -t.size.icon.l / 2,
    pointerEvents: 'none',
    position: 'absolute',
    width: t.size.icon.l,
  },
  markerDot: { backgroundColor: t.color.onPhoto.primary, borderRadius: t.radius.full, height: t.space[4], left: t.space[8], position: 'absolute', top: t.space[8], width: t.space[4] },
  previews: { gap: t.space[8] },
  previewLabel: { marginTop: t.space[8] },
  centreRow: { alignItems: 'flex-start' },
  field: { gap: t.space[8] },
  // The skeleton in EditorForm's column and FormGroup's rhythm (frames.tsx, fields.tsx).
  skeletonColumn: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  skeletonGroup: { gap: t.space[16] },
  skeletonEyebrow: { marginBottom: -t.space[4] },
  skeletonStage: { alignSelf: 'center' },
  skeletonButton: { alignSelf: 'flex-start' },
  skeletonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // The text of the real field, invisible, in the column it has between the field's 16 of padding.
  skeletonAltMeasure: { left: t.space[16], opacity: 0, pointerEvents: 'none', position: 'absolute', right: t.space[16], top: t.space[12] },
}));

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

/** GAR-08 /garage/[id]/photos/[mediaId]: focal point with 4:3 and 1:1 previews, alt text, category; [SIG] the blur tool. */
export function PhotoEditScreen() {
  const { t } = useTranslation('garage');
  const params = useLocalSearchParams<{ mediaId: string }>();
  const mediaId = paramOf(params.mediaId) ?? '';
  const own = useOwnVehicle(ROUTE, {
    path: 'photos',
    loading: (known) => (
      <PhotoEditSkeleton photo={known.vehicle?.photos.find((entry) => entry.id === mediaId)} vehicleTitle={known.vehicle?.full_title ?? known.card?.full_title ?? ''} />
    ),
  });
  const photo = own.vehicle?.photos.find((entry) => entry.id === mediaId);
  let body = own.state;
  if (!body && own.vehicle && !photo) {
    body = (
      <CentredState>
        <GoneState routeId={ROUTE} title={t('photoEdit.goneTitle')} body={t('photoEdit.goneBody')} />
      </CentredState>
    );
  }
  return (
    <EditorScreen routeId={ROUTE} title={t('photoEdit.title')} fallback={own.id ? `/garage/${own.id}/photos` : '/garage'} offlineLabel={t('offline.editor')}>
      {body ?? (own.vehicle && photo ? <PhotoForm key={photo.id} vehicle={own.vehicle} photo={photo} restriction={own.restriction} /> : null)}
    </EditorScreen>
  );
}

function PhotoForm({ vehicle, photo, restriction }: { vehicle: GarageVehicle; photo: GarageMedia; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const vehicleT = useTranslation('vehicle').t;
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const charCount = useCharCount();
  const { width: screenWidth } = useBreakpoint();
  const update = useUpdateMedia(vehicle);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const blurEnabled = useFlag(PLATE_BLUR_FLAG);
  const [blurDirty, setBlurDirty] = useState(false);
  const { control, handleSubmit, setValue, setError, formState } = useForm<Values>({
    resolver: zodResolver(photoDetailsSchema),
    mode: 'onTouched',
    defaultValues: { alt: photo.alt ?? '', category: photo.category, x: photo.focal_x ?? CENTRE, y: photo.focal_y ?? CENTRE },
  });
  const { isDirty } = formState;
  const [x, y, alt] = [useWatch({ control, name: 'x' }), useWatch({ control, name: 'y' }), useWatch({ control, name: 'alt' })];
  const focal = { x, y };
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const locked = restriction !== null;
  const fields = photoFields(photo, screenWidth);

  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) router.back();
    else router.replace(`/garage/${vehicle.id}/photos`);
  }, [router, saved, vehicle.id]);

  const place = (nextX: number, nextY: number) => {
    setValue('x', clamp(nextX), { shouldDirty: true });
    setValue('y', clamp(nextY), { shouldDirty: true });
  };
  const pan = usePanGesture({
    enabled: !locked,
    minDistance: 0,
    onBegin: (event) => {
      'worklet';
      if (stage.width > 0) scheduleOnRN(place, event.x / stage.width, event.y / stage.height);
    },
    onUpdate: (event) => {
      'worklet';
      if (stage.width > 0) scheduleOnRN(place, event.x / stage.width, event.y / stage.height);
    },
  });
  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const delta = FOCUS_KEYS[keyOf(event) ?? ''];
    if (!delta) return;
    event.preventDefault?.();
    place(x + delta[0], y + delta[1]);
  };
  // Screen readers on iOS and Android cannot drag the point: they get the four moves as actions, and hear where it is now.
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const delta = FOCUS_ACTIONS[event.nativeEvent.actionName];
    if (!delta) return;
    const nextX = clamp(x + delta[0]);
    const nextY = clamp(y + delta[1]);
    place(nextX, nextY);
    AccessibilityInfo.announceForAccessibility(t('photoEdit.position', { x: Math.round(nextX * 100), y: Math.round(nextY * 100) }));
  };

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const body: MediaPatch = { alt: values.alt.trim() || null, category: values.category, focal_x: values.x, focal_y: values.y };
    try {
      await update.mutateAsync({ id: photo.id, body });
      toast(t('editor.saved'), { haptic: 'success', testID: `${ROUTE}.saved` });
      setSaved(true);
    } catch (error) {
      setNotice(applyServerErrors(error, setError, { alt: 'alt', category: 'category', focal_x: 'x', focal_y: 'y' }) === null ? null : saveErrorMessage(t, error));
    }
  });

  const position = t('photoEdit.position', { x: Math.round(x * 100), y: Math.round(y * 100) });

  return (
    <EditorForm
      routeId={ROUTE}
      dirty={(isDirty || blurDirty) && !update.isPending && !saved}
      cta={{ label: t('editor.save'), onPress: () => void submit(), loading: update.isPending, disabled: locked || !online || !isDirty }}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      <FormGroup title={t('photoEdit.focusGroup')}>
        <Text variant="supporting" color="text.secondary">
          {t('photoEdit.focusHint')}
        </Text>
        <GestureDetector gesture={pan} touchAction="none" userSelect="none">
          <PressableScale
            role="button"
            aria-label={`${t('photoEdit.focusLabel')}: ${position}`}
            accessibilityHint={isWeb ? t('photoEdit.focusKeys') : t('photoEdit.focusActions')}
            accessibilityActions={
              locked
                ? undefined
                : [
                    { name: 'moveLeft', label: t('photoEdit.moveLeft') },
                    { name: 'moveRight', label: t('photoEdit.moveRight') },
                    { name: 'moveUp', label: t('photoEdit.moveUp') },
                    { name: 'moveDown', label: t('photoEdit.moveDown') },
                  ]
            }
            onAccessibilityAction={onAccessibilityAction}
            feedback={false}
            ring="inset"
            disabled={locked}
            onLayout={(event: LayoutChangeEvent) => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
            style={[styles.stage, { aspectRatio: ratio, maxWidth: STAGE_MAX_HEIGHT * ratio }]}
            testID={`${ROUTE}.stage`}
            {...({ onKeyDown } as object)}
          >
            <Photo {...fields} focal={null} aspect="4:3" style={{ aspectRatio: ratio }} label={photo.alt ?? undefined} />
            <View style={[styles.marker, { left: `${x * 100}%`, top: `${y * 100}%` }]} testID={`${ROUTE}.marker`}>
              <View style={styles.markerDot} />
            </View>
          </PressableScale>
        </GestureDetector>
        <View style={styles.centreRow}>
          <Button label={t('photoEdit.centre')} variant="tertiary" size="s" icon="arrow-clockwise" flush="start" onPress={() => place(CENTRE, CENTRE)} disabled={locked} testID={`${ROUTE}.centre`} />
        </View>
        <FieldPair>
          {[
            <View key="card" style={styles.previews}>
              <Photo {...fields} focal={focal} aspect="4:3" corner="sm" testID={`${ROUTE}.preview43`} />
              <Text variant="caption" color="text.secondary" style={styles.previewLabel}>
                {t('photoEdit.preview43')}
              </Text>
            </View>,
            <View key="square" style={styles.previews}>
              <Photo {...fields} focal={focal} aspect="1:1" corner="sm" testID={`${ROUTE}.preview11`} />
              <Text variant="caption" color="text.secondary" style={styles.previewLabel}>
                {t('photoEdit.preview11')}
              </Text>
            </View>,
          ]}
        </FieldPair>
      </FormGroup>
      <FormGroup title={t('photoEdit.detailsGroup')}>
        <Controller
          control={control}
          name="alt"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('photoEdit.alt')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('photoEdit.altPlaceholder', { vehicle: vehicle.full_title })}
              helper={`${t('photoEdit.altHelper')} ${charCount(alt.length, ALT_MAX_LENGTH)}`}
              error={fieldMessage(t, fieldState.error)}
              disabled={locked}
              multiline
              maxRows={ALT_ROWS}
              maxLength={ALT_MAX_LENGTH}
              testID={`${ROUTE}.alt`}
            />
          )}
        />
        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <View style={styles.field}>
              <Text variant="labelS" color="text.secondary" aria-hidden>
                {t('photoEdit.category')}
              </Text>
              <ChoiceChips
                label={t('photoEdit.category')}
                options={MEDIA_CATEGORIES.map((value) => ({ value, label: vehicleT(`gallery.categories.${value}`) }))}
                value={field.value}
                onChange={(next) => field.onChange(next || field.value)}
                disabled={locked}
                testID={`${ROUTE}.category`}
              />
              {/* M3.7: the AI's category, one tap to take; nothing changes before Speichern. */}
              <PhotoCategoryAssist
                mediaId={photo.id}
                current={field.value}
                disabled={locked}
                onAccept={(category) => setValue('category', category, { shouldDirty: true })}
                testID={`${ROUTE}.ai`}
              />
            </View>
          )}
        />
      </FormGroup>
      {blurEnabled ? <BlurTool vehicle={vehicle} photo={photo} disabled={locked || !online} onDirtyChange={setBlurDirty} routeId={ROUTE} /> : null}
    </EditorForm>
  );
}

/**
 * DQ-214: the alt field as TextInput draws it: as tall as its text or its placeholder, up to `ALT_ROWS` rows and 12 above and
 * below them, and never below the 52 of a single line.
 */
function AltFieldSkeleton({ text }: { text: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const [textHeight, setTextHeight] = useState(0);
  const rows = Math.min(ALT_ROWS, linesInHeight(textHeight, 'body', fontScale));
  return (
    <View>
      <SkeletonBlock height={Math.max(size.input, rows * typography.body.lineHeight * fontScale + 2 * space[12])} corner="sm" />
      <View aria-hidden style={styles.skeletonAltMeasure}>
        <Text variant="body" hyphenate={false} selectable={false} onLayout={(event) => setTextHeight(event.nativeEvent.layout.height)}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/**
 * DQ-207: GAR-08 loads in its own shape: the eyebrow and the hint, the stage in the photo's ratio (a portrait one while the
 * photo is not known yet), "Zentrieren", the 4:3 and 1:1 previews with their captions, then the alt text and the category.
 */
function PhotoEditSkeleton({ photo, vehicleTitle }: { photo: GarageMedia | undefined; vehicleTitle: string }) {
  const { t } = useTranslation('garage');
  const vehicleT = useTranslation('vehicle').t;
  const styles = useStyles();
  const { fontScale } = useTheme();
  const charCount = useCharCount();
  const ratio = photo ? (photo.width && photo.height ? photo.width / photo.height : 4 / 3) : SKELETON_STAGE_RATIO;
  const centre = t('photoEdit.centre');
  const alt = photo?.alt ?? '';
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeletonColumn}>
        <View style={styles.skeletonGroup}>
          <SkeletonText variant="eyebrow" width="25%" style={styles.skeletonEyebrow} />
          <KnownTextSkeleton text={t('photoEdit.focusHint')} variant="supporting" />
          <SkeletonBlock width="100%" aspectRatio={ratio} corner="md" style={[styles.skeletonStage, { maxWidth: STAGE_MAX_HEIGHT * ratio }]} />
          <SkeletonBlock
            width={estimatedLabelWidth(centre, 's', fontScale) + buttonChrome('s', true)}
            height={buttonHeight('s', fontScale)}
            corner="sm"
            style={styles.skeletonButton}
          />
          <FieldPair>
            {[
              <View key="card" style={styles.previews}>
                <SkeletonBlock width="100%" aspectRatio={4 / 3} corner="sm" />
                <SkeletonText variant="caption" width="60%" style={styles.previewLabel} />
              </View>,
              <View key="square" style={styles.previews}>
                <SkeletonBlock width="100%" aspectRatio={1} corner="sm" />
                <SkeletonText variant="caption" width="60%" style={styles.previewLabel} />
              </View>,
            ]}
          </FieldPair>
        </View>
        <View style={styles.skeletonGroup}>
          <SkeletonText variant="eyebrow" width="25%" style={styles.skeletonEyebrow} />
          <View style={styles.field}>
            <SkeletonText variant="labelS" width="35%" />
            <AltFieldSkeleton text={alt || t('photoEdit.altPlaceholder', { vehicle: vehicleTitle })} />
            <KnownTextSkeleton text={`${t('photoEdit.altHelper')} ${charCount(alt.length, ALT_MAX_LENGTH)}`} variant="helper" />
          </View>
          <View style={styles.field}>
            <SkeletonText variant="labelS" width="25%" />
            <View style={styles.skeletonChips}>
              {MEDIA_CATEGORIES.map((category) => (
                <SkeletonBlock
                  key={category}
                  width={Math.max(size.touchMin, estimatedLabelWidth(vehicleT(`gallery.categories.${category}`), 's', fontScale) + 2 * space[12])}
                  height={size.chip}
                  corner="full"
                />
              ))}
            </View>
          </View>
        </View>
      </View>
    </Skeleton>
  );
}
