import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { garageKeys, type GarageMedia, type GarageVehicle } from '@/api/queries/garage';
import { useBlurPhoto } from '@/api/queries/signature';
import { photoFields } from '@/features/vehicle/media';
import { isWeb } from '@/lib/platform';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Button, Chip, Dialog, Photo, Spinner, Switch, Text, toast } from '@/ui';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { keyOf } from '@/ui/useRovingKeys';

import {
  addRegion,
  blurPayload,
  canAddRegion,
  DEFAULT_REGION,
  isNudgeKey,
  MAX_BLUR_REGIONS,
  nudgeRegion,
  regionAt,
  regionFromDrag,
  regionPercent,
  removeRegion,
  replaceRegion,
  TAP_SLOP,
  type BlurRegion,
  type NudgeKey,
  type Point,
} from '../blur';
import { saveErrorMessage } from '../errors';
import { FormGroup } from './fields';

export const PLATE_BLUR_FLAG = 'sig.plate_blur';

/** The whole photo stays in view, as on the focal stage: at most 480 high on wide screens. */
const STAGE_MAX_HEIGHT = (layout.feedColumn * 3) / 4;
/** How often GAR-08 asks whether the server finished the new variants. */
const PROCESSING_POLL_MS = 3000;
/** The preview's blur, strong enough that a plate is gone at any stage width. */
const PREVIEW_BLUR = 24;

const ACTIONS: Partial<Record<string, { key: NudgeKey; resize?: boolean }>> = {
  moveLeft: { key: 'ArrowLeft' },
  moveRight: { key: 'ArrowRight' },
  moveUp: { key: 'ArrowUp' },
  moveDown: { key: 'ArrowDown' },
  grow: { key: 'ArrowRight', resize: true },
  shrink: { key: 'ArrowLeft', resize: true },
};

const useStyles = createStyles((t) => ({
  stage: { alignSelf: 'center', borderRadius: t.radius.md, overflow: 'hidden', width: '100%' },
  region: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderColor: t.color.onPhoto.primary,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
  },
  // The photo takes no pointer: on web an <img> is draggable, and a mouse drag on it starts the browser's image drag, whose
  // pointercancel ends the pan before a region exists (M2.8). The stage under it gets the pointer instead; touch never drags.
  photo: { pointerEvents: 'none' },
  regionSelected: { borderWidth: t.size.border.focusRing },
  regionPreview: { backgroundColor: t.color.media.ground },
  draft: { borderColor: t.color.onPhoto.primary, borderWidth: t.size.border.focusRing, pointerEvents: 'none', position: 'absolute' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  controls: { alignItems: 'flex-start', gap: t.space[8] },
  previewRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between', minHeight: t.size.row.single },
  previewText: { flex: 1, gap: t.space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  processing: { alignItems: 'center', backgroundColor: t.color.bg.raised, borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[12], padding: t.space[12] },
  processingText: { flex: 1 },
}));

type Drag = { start: Point; end: Point };

export type BlurToolProps = {
  vehicle: GarageVehicle;
  photo: GarageMedia;
  /** Offline, restricted or a session that ended: nothing can be sent. */
  disabled: boolean;
  /** Marked regions not sent yet count as unsaved changes for the route's discard guard. */
  onDirtyChange: (dirty: boolean) => void;
  routeId: string;
};

/**
 * GAR-08 [SIG `sig.plate_blur`]: rectangles over number plates or faces, drawn with a finger or the mouse, nudged and resized
 * with the arrow keys (Alt resizes, Shift goes five times as far, Delete removes) or with screen-reader actions. The preview
 * blurs on the device; "Unkenntlich machen" asks once, because the server pixelates every variant and replaces the original.
 * While it works the photo is `processing`, and the screen polls until the new variants are there.
 */
export function BlurTool({ vehicle, photo, disabled, onDirtyChange, routeId }: BlurToolProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const client = useQueryClient();
  const { width: screenWidth } = useBreakpoint();
  const blur = useBlurPhoto(vehicle);
  const [open, setOpen] = useState(false);
  const [regions, setRegions] = useState<readonly BlurRegion[]>([]);
  const [selected, setSelected] = useState(-1);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  // The photo's variants when the request went out: new ones mean the server is done.
  const [sentFrom, setSentFrom] = useState<string | null>(null);
  const latestDirty = useRef(onDirtyChange);
  // The gesture's callbacks run from the UI thread: they read the newest drag, regions and stage through these.
  const dragRef = useRef<Drag | null>(null);
  const latest = useRef({ regions, stage });
  const testID = `${routeId}.blur`;
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  // A data: URL on web, not expo-image's blob: placeholder, which WebKit fails to load when the preview unmounts.
  const placeholder = useImagePlaceholder(photo.blurhash, 'fill');
  const fields = photoFields(photo, screenWidth);
  const ready = photo.status === 'ready';
  // Done once the photo is ready again with other files than before; until then it is processing on the server.
  const finished = sentFrom !== null && ready && variantKey(photo) !== sentFrom;
  const processing = sentFrom !== null && !finished;
  const toasted = useRef<string | null>(null);

  useEffect(() => {
    latestDirty.current = onDirtyChange;
    latest.current = { regions, stage };
  });
  useEffect(() => latestDirty.current(regions.length > 0 && !processing), [processing, regions.length]);

  // The new variants come from the queue: ask again until the photo is ready with other files than before.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void client.invalidateQueries({ queryKey: garageKeys.vehicle(vehicle.id) }), PROCESSING_POLL_MS);
    return () => clearInterval(timer);
  }, [client, processing, vehicle.id]);
  useEffect(() => {
    if (!finished || toasted.current === sentFrom) return;
    toasted.current = sentFrom;
    toast(t('blur.done'), { haptic: 'success', testID: `${testID}.done` });
  }, [finished, sentFrom, t, testID]);

  const announce = (region: BlurRegion, index: number) => {
    AccessibilityInfo.announceForAccessibility(t('blur.regionLabel', { number: index + 1, ...regionPercent(region) }));
  };

  const add = (region: BlurRegion) => {
    const current = latest.current.regions;
    if (!canAddRegion(current)) {
      toast(t('blur.full', { max: MAX_BLUR_REGIONS }), { testID: `${testID}.full` });
      return;
    }
    const next = addRegion(current, region);
    latest.current = { ...latest.current, regions: next };
    setRegions(next);
    setSelected(next.length - 1);
  };

  const nudge = (index: number, key: NudgeKey, options: { fast?: boolean; resize?: boolean }) => {
    const region = regions[index];
    if (!region) return;
    const next = nudgeRegion(region, key, options);
    setRegions(replaceRegion(regions, index, next));
    announce(next, index);
  };

  const remove = (index: number) => {
    setRegions(removeRegion(regions, index));
    setSelected(-1);
  };

  const begin = (x: number, y: number) => {
    dragRef.current = { start: { x, y }, end: { x, y } };
    setDrag(dragRef.current);
  };
  const move = (x: number, y: number) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, end: { x, y } };
    setDrag(dragRef.current);
  };
  const end = (x: number, y: number, canceled: boolean) => {
    const current = dragRef.current;
    const { regions: shown, stage: box } = latest.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || canceled || box.width === 0) return;
    const finish = { x, y };
    if (Math.hypot(finish.x - current.start.x, finish.y - current.start.y) < TAP_SLOP) {
      setSelected(regionAt(shown, { x: finish.x / box.width, y: finish.y / box.height }));
      return;
    }
    const region = regionFromDrag(current.start, finish, box);
    if (region) add(region);
  };

  const pan = usePanGesture({
    enabled: open && !disabled && !processing,
    minDistance: 0,
    onBegin: (event) => {
      'worklet';
      scheduleOnRN(begin, event.x, event.y);
    },
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(move, event.x, event.y);
    },
    onFinalize: (event) => {
      'worklet';
      scheduleOnRN(end, event.x, event.y, event.canceled);
    },
  });

  const onChipKey = (index: number) => (event: { key?: string; nativeEvent?: { key?: string; altKey?: boolean; shiftKey?: boolean }; altKey?: boolean; shiftKey?: boolean; preventDefault?: () => void }) => {
    const key = keyOf(event);
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault?.();
      remove(index);
      return;
    }
    if (!isNudgeKey(key)) return;
    event.preventDefault?.();
    nudge(index, key, { fast: Boolean(event.shiftKey ?? event.nativeEvent?.shiftKey), resize: Boolean(event.altKey ?? event.nativeEvent?.altKey) });
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const action = ACTIONS[event.nativeEvent.actionName];
    if (action && selected >= 0) nudge(selected, action.key, { resize: action.resize });
  };

  const cancel = () => {
    setRegions([]);
    setSelected(-1);
    setPreview(false);
    setOpen(false);
  };

  const apply = () => {
    const from = variantKey(photo);
    blur.mutate(
      { mediaId: photo.id, regions: blurPayload(regions) },
      {
        onSuccess: () => {
          setConfirming(false);
          setRegions([]);
          setSelected(-1);
          setPreview(false);
          setOpen(false);
          setSentFrom(from);
        },
        onError: (error) => {
          setConfirming(false);
          toast(saveErrorMessage(t, error), { testID: `${testID}.failed` });
        },
      },
    );
  };

  const draft = drag && stage.width > 0 ? regionFromDrag(drag.start, drag.end, stage) : null;
  const chosen = regions[selected];

  return (
    <FormGroup title={t('blur.group')} testID={testID}>
      <Text variant="callout" color="text.secondary">
        {t('blur.intro')}
      </Text>
      {processing ? (
        <View style={styles.processing} role="status" aria-live="polite" testID={`${testID}.processing`}>
          <Spinner size={20} label={t('blur.processing')} />
          <Text variant="callout" style={styles.processingText}>
            {t('blur.processing')}
          </Text>
        </View>
      ) : !ready ? (
        <Text variant="callout" color="text.secondary" role="status" testID={`${testID}.notReady`}>
          {t('blur.notReady')}
        </Text>
      ) : !open ? (
        <View style={styles.controls}>
          <Button
            label={t('blur.start')}
            variant="secondary"
            size="m"
            icon="selection"
            disabled={disabled}
            onPress={() => setOpen(true)}
            testID={`${testID}.start`}
          />
        </View>
      ) : (
        <>
          <GestureDetector gesture={pan} touchAction="none" userSelect="none">
            <View
              role="img"
              aria-label={`${t('blur.stageLabel')}. ${t('blur.count', { count: regions.length, max: MAX_BLUR_REGIONS })}`}
              accessibilityHint={selected >= 0 && !isWeb ? `${t('blur.stageHint')} ${t('blur.regionActions')}` : t('blur.stageHint')}
              accessibilityActions={
                selected >= 0
                  ? [
                      { name: 'moveLeft', label: t('photoEdit.moveLeft') },
                      { name: 'moveRight', label: t('photoEdit.moveRight') },
                      { name: 'moveUp', label: t('photoEdit.moveUp') },
                      { name: 'moveDown', label: t('photoEdit.moveDown') },
                      { name: 'grow', label: t('blur.grow') },
                      { name: 'shrink', label: t('blur.shrink') },
                    ]
                  : undefined
              }
              onAccessibilityAction={onAccessibilityAction}
              onLayout={(event: LayoutChangeEvent) => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
              style={[styles.stage, { aspectRatio: ratio, maxWidth: STAGE_MAX_HEIGHT * ratio }]}
              testID={`${testID}.stage`}
            >
              <Photo
                {...fields}
                focal={null}
                aspect="4:3"
                style={[styles.photo, { aspectRatio: ratio }]}
                label={photo.alt ?? undefined}
                testID={`${testID}.photo`}
              />
              {regions.map((region, index) => (
                <View
                  key={index}
                  style={[styles.region, index === selected ? styles.regionSelected : null, preview ? styles.regionPreview : null, boxStyle(region)]}
                  testID={`${testID}.region.${index}`}
                >
                  {preview && typeof fields.source === 'string' && stage.width > 0 ? (
                    <Image
                      source={{ uri: fields.source }}
                      {...placeholder}
                      blurRadius={PREVIEW_BLUR}
                      contentFit="fill"
                      accessible={false}
                      style={[
                        StyleSheet.absoluteFill,
                        { left: -region.x * stage.width, top: -region.y * stage.height, width: stage.width, height: stage.height, aspectRatio: ratio },
                      ]}
                    />
                  ) : null}
                </View>
              ))}
              {draft ? <View style={[styles.draft, boxStyle(draft)]} testID={`${testID}.draft`} /> : null}
            </View>
          </GestureDetector>
          <Text variant="caption" color="text.secondary" testID={`${testID}.count`}>
            {regions.length === 0 ? t('blur.empty') : t('blur.count', { count: regions.length, max: MAX_BLUR_REGIONS })}
            {isWeb ? ` ${t('blur.regionKeys')}` : ''}
          </Text>
          {regions.length > 0 ? (
            <View style={styles.chips} role="radiogroup" aria-label={t('blur.stageLabel')}>
              {regions.map((_region, index) => (
                <View key={index} {...({ onKeyDown: onChipKey(index) } as object)}>
                  <Chip
                    label={t('blur.chip', { number: index + 1 })}
                    selected={index === selected}
                    selectionRole="radio"
                    onPress={() => setSelected(index === selected ? -1 : index)}
                    onRemove={() => remove(index)}
                    removeLabel={t('blur.remove', { number: index + 1 })}
                    testID={`${testID}.chip.${index}`}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {chosen ? (
            <Text variant="caption" color="text.tertiary" role="status" aria-live="polite" testID={`${testID}.selected`}>
              {t('blur.regionLabel', { number: selected + 1, ...regionPercent(chosen) })}
            </Text>
          ) : null}
          <View style={styles.controls}>
            <Button
              label={t('blur.add')}
              variant="tertiary"
              size="s"
              icon="plus"
              flush="start"
              disabled={disabled || !canAddRegion(regions)}
              onPress={() => add(DEFAULT_REGION)}
              testID={`${testID}.add`}
            />
          </View>
          <View style={styles.previewRow}>
            <View style={styles.previewText}>
              <Text variant="body" aria-hidden>
                {t('blur.preview')}
              </Text>
              <Text variant="caption" color="text.secondary">
                {t('blur.previewHint')}
              </Text>
            </View>
            <Switch value={preview} onValueChange={setPreview} label={t('blur.preview')} disabled={regions.length === 0} testID={`${testID}.preview`} />
          </View>
          <View style={styles.actions}>
            <Button
              label={t('blur.apply')}
              size="m"
              icon="eye-slash"
              disabled={disabled || regions.length === 0}
              loading={blur.isPending}
              onPress={() => setConfirming(true)}
              testID={`${testID}.apply`}
            />
            <Button label={t('blur.cancel')} variant="tertiary" size="m" onPress={cancel} testID={`${testID}.cancel`} />
          </View>
        </>
      )}
      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('blur.confirmTitle')}
        body={t('blur.confirmBody')}
        testID={`${testID}.confirm`}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${testID}.confirm.cancel` },
          { label: t('blur.confirm'), destructive: true, loading: blur.isPending, onPress: apply, testID: `${testID}.confirm.apply` },
        ]}
      />
    </FormGroup>
  );
}

function boxStyle(region: BlurRegion) {
  return { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` } as const;
}

/** The files of a photo: they change with every reprocess, as their URLs carry a version (ADR-123). */
function variantKey(photo: GarageMedia): string {
  return photo.variants.map((variant) => variant.url).join('|');
}
