import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInputSelectionChangeEvent } from 'react-native';
import { z } from 'zod';

import { newIdempotencyKey } from '@/api/client';
import { useVehicleMods } from '@/api/queries/mods';
import { useMyVehicles } from '@/api/queries/profile';
import {
  UPDATE_TEXT_MAX,
  isEditWindowClosed,
  useBuildUpdate,
  useCreateBuildUpdate,
  useEditBuildUpdate,
  useMentionSuggestions,
  type BuildUpdateAudience,
  type MentionSuggestion,
} from '@/api/queries/social2';
import { useFlag } from '@/api/queries/appConfig';
import { applyServerErrors } from '@/features/auth/forms';
import {
  CentredState,
  EditorForm,
  RestrictedNotice,
  SignInState,
  useGarageAccess,
} from '@/features/garage/components/frames';
import { pickPhotos } from '@/features/garage/photos';
import { uploadQueue } from '@/features/garage/uploads';
import { variantUrl } from '@/features/vehicle/media';
import { paramOf } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import type { PickedPhoto } from '@/state/uploads';
import { useOnline } from '@/state/online';
import { createStyles, size } from '@/theme';
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  Header,
  IconButton,
  MemberRow,
  OfflineBanner,
  Photo,
  PressableScale,
  Radio,
  Screen,
  Text,
  TextInput,
  toast,
} from '@/ui';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';

import {
  activeMention,
  COMPOSER_PHOTO_LIMIT,
  composerIssues,
  insertMention,
  pairsWithout,
  parseDay,
  parseMileage,
  tapForPair,
  todayGerman,
  type LocalPair,
} from '../model';
import { finishPostWhenUploaded } from '../pairing';

const ROUTE = 'UPD-01';
const EDGES = ['top', 'left', 'right'] as const;
const MENTIONS_FLAG = 'mentions';

const schema = z
  .object({ text: z.string(), mileage: z.string(), date: z.string(), photoCount: z.number() })
  .superRefine((value, context) => {
    const issues = composerIssues(value);
    for (const [path, code] of Object.entries(issues))
      context.addIssue({ code: 'custom', path: [path], message: code });
  });
type Values = z.infer<typeof schema>;

const useStyles = createStyles((t) => ({
  group: { gap: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  suggestions: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  tile: { borderRadius: t.radius.sm, overflow: 'hidden', width: t.size.thumb.card + t.size.thumb.card / 2 },
  tilePaired: { borderColor: t.color.text.primary, borderWidth: t.size.border.focusRing },
  tilePending: { borderColor: t.color.accent.fg, borderWidth: t.size.border.focusRing },
  tileBadge: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    bottom: t.space[4],
    left: t.space[4],
    paddingHorizontal: t.space[4],
    position: 'absolute',
  },
  tileRemove: { position: 'absolute', right: 0, top: 0 },
  none: { padding: t.space[16] },
  rows: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[4],
    padding: t.space[12],
  },
  photoActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // ADR-426 e (DQ-1066 a): a form section header is callout.strong text.secondary, sentence case; space.8 above it adds to the
  // form's space.24 for the 32 between groups.
  sectionTitle: { alignItems: 'baseline', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: t.space[8] },
}));

/** A form section's header (ADR-426 e) with an optional count on its trailing edge ("3 von 10"). */
function FormSectionTitle({ title, trailing }: { title: string; trailing?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionTitle}>
      <Text variant={SECTION_HEADER_ROLE} color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} hyphenate={false}>
        {title}
      </Text>
      {trailing ? (
        <Text variant="caption" color="text.secondary" numeric hyphenate={false}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

type Picked = PickedPhoto & { key: string };

/**
 * UPD-01 "Update posten" (09 §7.6, §8.5): text with @mentions, up to 10 photos with before/after pairs, linked mods,
 * Kilometerstand, date (today by default) and the audience. "Posten" creates the post, then its photos upload through the app's
 * queue and their order and pairs follow (pairing.ts). The post is in the vehicle's Verlauf as soon as the server answers.
 */
export function PostUpdateScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const access = useGarageAccess();
  const params = useLocalSearchParams<{ vehicleId?: string; updateId?: string; slug?: string }>();
  // Edit mode (09 §8.5: within 24 hours): text, details, audience and mods of an existing post; its photos stay as they are.
  const editId = paramOf(params.updateId) ?? '';
  const editing = editId !== '';
  const existing = useBuildUpdate(editing ? editId : undefined);
  const vehicles = useMyVehicles();
  const published = useMemo(
    () => (vehicles.data ?? []).filter((vehicle) => vehicle.status === 'published'),
    [vehicles.data],
  );
  const [chosen, setChosen] = useState<string | null>(paramOf(params.vehicleId) ?? null);
  const vehicle = editing
    ? published.find((entry) => entry.id === existing.data?.vehicle_id)
    : (published.find((entry) => entry.id === chosen) ??
      published.find((entry) => entry.is_main) ??
      published[0]);
  const edit = useEditBuildUpdate(editId, vehicle?.slug ?? paramOf(params.slug) ?? '');
  const mods = useVehicleMods(vehicle?.id);
  const create = useCreateBuildUpdate();
  const mentionsOn = useFlag(MENTIONS_FLAG);

  const [photos, setPhotos] = useState<Picked[]>([]);
  const [pairs, setPairs] = useState<LocalPair[]>([]);
  const [pending, setPending] = useState<number | null>(null);
  const [pairing, setPairing] = useState(false);
  const [modIds, setModIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<BuildUpdateAudience>('vehicle');
  const [caret, setCaret] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const idempotency = useRef(newIdempotencyKey());

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { text: '', mileage: '', date: todayGerman(), photoCount: 0 },
    mode: 'onSubmit',
  });
  const text = useWatch({ control: form.control, name: 'text' });
  const loaded = useRef(false);
  const original = existing.data;
  useEffect(() => {
    if (!original || loaded.current) return;
    loaded.current = true;
    const day = original.happened_on ? original.happened_on.split('-').reverse().join('.') : '';
    form.reset({
      text: original.note ?? '',
      mileage: original.mileage_km === null ? '' : String(original.mileage_km),
      date: day,
      photoCount: original.photos.length,
    });
    setAudience(original.audience);
    setModIds(original.modifications.map((mod) => mod.id));
  }, [form, original]);
  const mention = mentionsOn ? activeMention(text, caret) : null;
  const suggestions = useMentionSuggestions(
    mention ? mention.query : null,
    mention !== null && mention.query.length > 0,
  );
  const dirty = editing
    ? !posted && form.formState.isDirty
    : !posted && (form.formState.isDirty || photos.length > 0 || modIds.length > 0 || audience !== 'vehicle');

  const close = () => (router.canGoBack() ? router.back() : router.replace('/garage'));

  const messageOf = (code: string | undefined) => {
    switch (code) {
      case 'textTooLong':
        return t('composer.textTooLong', { max: UPDATE_TEXT_MAX });
      case 'empty':
        return t('composer.empty');
      case 'mileageInvalid':
        return t('composer.mileageInvalid');
      case 'dateInvalid':
        return t('composer.dateInvalid');
      case 'dateFuture':
        return t('composer.dateFuture');
      default:
        return code;
    }
  };

  const addPhotos = async () => {
    const remaining = COMPOSER_PHOTO_LIMIT - photos.length;
    if (remaining <= 0) return;
    try {
      const picked = await pickPhotos(remaining);
      if (!picked || picked.length === 0) return;
      const next = [
        ...photos,
        ...picked.map((photo, index) => ({
          ...photo,
          key: `${Date.now()}-${index}-${photo.uri.slice(-12)}`,
        })),
      ];
      setPhotos(next);
      form.setValue('photoCount', next.length);
    } catch {
      toast(t('composer.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
    }
  };

  const removePhoto = (index: number) => {
    const next = photos.filter((_, position) => position !== index);
    setPhotos(next);
    setPairs(pairsWithout(pairs, index));
    setPending(null);
    form.setValue('photoCount', next.length);
  };

  const tapPhoto = (index: number) => {
    if (!pairing) return;
    haptics.selection();
    const next = tapForPair(pairs, pending, index);
    setPairs(next.pairs);
    setPending(next.pending);
  };

  const pickMention = (member: MentionSuggestion) => {
    if (!mention) return;
    const next = insertMention(text, mention, member.username);
    form.setValue('text', next.text, { shouldDirty: true });
    setCaret(next.caret);
  };

  const onValid = (values: Values) => {
    if (!vehicle) return;
    setNotice(null);
    if (editing) {
      edit.mutate(
        {
          text: values.text.trim() || null,
          mileage_km: parseMileage(values.mileage) ?? null,
          happened_on: parseDay(values.date) ?? null,
          audience,
          modification_ids: modIds,
        },
        {
          onSuccess: () => {
            haptics.success();
            setPosted(true);
            toast(t('composer.saved'), { testID: `${ROUTE}.toast` });
            requestAnimationFrame(close);
          },
          onError: (error) => {
            haptics.error();
            const left = isEditWindowClosed(error)
              ? null
              : applyServerErrors(error, form.setError, {
                  text: 'text',
                  mileage_km: 'mileage',
                  happened_on: 'date',
                });
            setNotice(left ?? (error.message || t('composer.failed')));
          },
        },
      );
      return;
    }
    create.mutate(
      {
        vehicleId: vehicle.id,
        slug: vehicle.slug,
        text: values.text.trim() || null,
        mileageKm: parseMileage(values.mileage) ?? null,
        happenedOn: parseDay(values.date) ?? null,
        audience,
        modificationIds: modIds,
        idempotencyKey: idempotency.current,
      },
      {
        onSuccess: (update) => {
          haptics.success();
          setPosted(true);
          if (photos.length > 0) {
            const queue = uploadQueue();
            const itemIds = queue.store
              .getState()
              .enqueue({ kind: 'update', vehicleId: vehicle.id, updateId: update.id }, photos);
            void finishPostWhenUploaded(queue.store, {
              updateId: update.id,
              slug: vehicle.slug,
              itemIds,
              pairs,
            });
            toast(t('composer.uploading', { count: photos.length }), { testID: `${ROUTE}.toast` });
          } else {
            toast(t('composer.posted'), { testID: `${ROUTE}.toast` });
          }
          // After the guard saw `posted` (next frame), so leaving does not ask to discard.
          requestAnimationFrame(close);
        },
        onError: (error) => {
          haptics.error();
          const left = applyServerErrors(error, form.setError, {
            text: 'text',
            mileage_km: 'mileage',
            happened_on: 'date',
          });
          setNotice(left ?? (error.message || t('composer.failed')));
        },
      },
    );
  };
  // Built on press, not during render: the handler reads the idempotency key (a ref).
  const submit = () => form.handleSubmit(onValid, () => haptics.warning())();

  let body;
  if (access.status === 'guest') {
    body = <SignInState routeId={ROUTE} returnTo="/post-update" />;
  } else if (vehicles.isSuccess && published.length === 0) {
    body = (
      <CentredState>
        <EmptyState
          title={t('composer.noVehicle')}
          action={{ label: t('composer.noVehicleAction'), onPress: () => router.replace('/garage') }}
          testID={`${ROUTE}.noVehicle`}
        />
      </CentredState>
    );
  } else {
    body = (
      <EditorForm
        routeId={ROUTE}
        sheet
        dirty={dirty}
        revealTop={notice}
        cta={{
          label: editing ? t('highlights.save') : t('composer.post'),
          onPress: () => void submit(),
          loading: create.isPending || edit.isPending,
          disabled: !online || !vehicle || access.restriction !== null || (editing && !original),
        }}
      >
        {access.restriction ? (
          <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} />
        ) : null}
        {notice ? (
          <Text variant="callout" color="accent.fg" role="alert" testID={`${ROUTE}.notice`}>
            {notice}
          </Text>
        ) : null}

        {published.length > 1 && !editing ? (
          <View style={styles.group} testID={`${ROUTE}.vehicles`}>
            <FormSectionTitle title={t('composer.vehicle')} />
            <View style={styles.chips} role="radiogroup" aria-label={t('composer.vehicle')}>
              {published.map((entry) => (
                <Chip
                  key={entry.id}
                  label={entry.title}
                  selected={entry.id === vehicle?.id}
                  selectionRole="radio"
                  onPress={() => {
                    setChosen(entry.id);
                    setModIds([]);
                  }}
                  testID={`${ROUTE}.vehicle.${entry.id}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Controller
            control={form.control}
            name="text"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onSelectionChange={(event: TextInputSelectionChangeEvent) =>
                  setCaret(event.nativeEvent.selection.end)
                }
                label={t('composer.text')}
                helper={mentionsOn ? t('composer.textHelper') : undefined}
                error={messageOf(fieldState.error?.message)}
                multiline
                maxRows={8}
                maxLength={UPDATE_TEXT_MAX + 100}
                testID={`${ROUTE}.text`}
              />
            )}
          />
          {mention && mention.query.length > 0 ? (
            <View
              style={styles.suggestions}
              role="list"
              aria-label={t('composer.suggestions')}
              testID={`${ROUTE}.mentions`}
            >
              {(suggestions.data ?? []).length === 0 && suggestions.isSuccess ? (
                <Text
                  variant="callout"
                  color="text.secondary"
                  style={styles.none}
                  testID={`${ROUTE}.mentions.none`}
                >
                  {t('composer.noSuggestions')}
                </Text>
              ) : (
                (suggestions.data ?? []).map((member, index, list) => (
                  <MemberRow
                    key={member.username}
                    name={member.display_name || `@${member.username}`}
                    meta={`@${member.username}`}
                    avatarUri={variantUrl(member.avatar, size.avatar.md)}
                    avatarBlurhash={member.avatar?.blurhash}
                    onPress={() => pickMention(member)}
                    divider={index < list.length - 1}
                    testID={`${ROUTE}.mention.${member.username}`}
                  />
                ))
              )}
            </View>
          ) : null}
        </View>

        {editing ? null : (
          <View style={styles.group} testID={`${ROUTE}.photos`}>
            <FormSectionTitle
              title={t('composer.photos')}
              trailing={t('composer.photosCount', { count: photos.length, max: COMPOSER_PHOTO_LIMIT })}
            />
            {photos.length > 0 ? (
              <View style={styles.photos}>
                {photos.map((photo, index) => {
                  const pair = pairs.find((entry) => entry.before === index || entry.after === index);
                  const role = pair
                    ? pair.before === index
                      ? t('composer.before')
                      : t('composer.after')
                    : null;
                  return (
                    <PressableScale
                      key={photo.key}
                      role={pairing ? 'button' : undefined}
                      aria-label={
                        role
                          ? `${t('composer.photos')} ${index + 1}, ${role}`
                          : `${t('composer.photos')} ${index + 1}`
                      }
                      onPress={pairing ? () => tapPhoto(index) : undefined}
                      disabled={!pairing}
                      style={[
                        styles.tile,
                        pair ? styles.tilePaired : null,
                        pending === index ? styles.tilePending : null,
                      ]}
                      testID={`${ROUTE}.photo.${index}`}
                    >
                      <Photo source={photo.uri} aspect="1:1" corner="sm" />
                      {role ? (
                        <View style={styles.tileBadge}>
                          <Text variant="labelBadge" color="onPhoto.primary">
                            {role}
                          </Text>
                        </View>
                      ) : null}
                      {pairing ? null : (
                        <View style={styles.tileRemove}>
                          <IconButton
                            icon="x"
                            variant="onPhoto"
                            label={t('composer.removePhoto')}
                            onPress={() => removePhoto(index)}
                            testID={`${ROUTE}.photo.${index}.remove`}
                          />
                        </View>
                      )}
                    </PressableScale>
                  );
                })}
              </View>
            ) : null}
            <View style={styles.photoActions}>
              <Button
                label={t('composer.addPhotos')}
                icon="image"
                variant="secondary"
                size="m"
                onPress={() => void addPhotos()}
                disabled={photos.length >= COMPOSER_PHOTO_LIMIT || pairing}
                testID={`${ROUTE}.addPhotos`}
              />
              {photos.length >= 2 ? (
                <Button
                  label={pairing ? t('composer.paired') : t('composer.pair')}
                  icon="arrows-left-right"
                  variant="tertiary"
                  size="m"
                  onPress={() => {
                    setPairing(!pairing);
                    setPending(null);
                  }}
                  testID={`${ROUTE}.pair`}
                />
              ) : null}
            </View>
            {pairing ? (
              <Text variant="caption" color="text.secondary" testID={`${ROUTE}.pairHint`}>
                {t('composer.pairHint')}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.group}>
          <FormSectionTitle title={t('composer.details')} />
          <Controller
            control={form.control}
            name="mileage"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('composer.mileage')}
                suffix="km"
                keyboardType="number-pad"
                error={messageOf(fieldState.error?.message)}
                testID={`${ROUTE}.mileage`}
              />
            )}
          />
          <Controller
            control={form.control}
            name="date"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('composer.date')}
                keyboardType="numbers-and-punctuation"
                error={messageOf(fieldState.error?.message)}
                testID={`${ROUTE}.date`}
              />
            )}
          />
        </View>

        <View style={styles.group}>
          <FormSectionTitle title={t('composer.audience')} />
          <View style={styles.rows} role="radiogroup" aria-label={t('composer.audience')}>
            <Radio
              checked={audience === 'vehicle'}
              onChange={() => setAudience('vehicle')}
              label={t('composer.audienceVehicle')}
              showLabel
              testID={`${ROUTE}.audience.vehicle`}
            />
            <Text variant="caption" color="text.secondary">
              {t('composer.audienceVehicleHint')}
            </Text>
            <Radio
              checked={audience === 'followers'}
              onChange={() => setAudience('followers')}
              label={t('composer.audienceFollowers')}
              showLabel
              testID={`${ROUTE}.audience.followers`}
            />
            <Text variant="caption" color="text.secondary">
              {t('composer.audienceFollowersHint')}
            </Text>
          </View>
        </View>

        {(mods.data ?? []).length > 0 ? (
          <View style={styles.group} testID={`${ROUTE}.mods`}>
            <FormSectionTitle title={t('composer.mods')} />
            <View style={styles.rows}>
              {(mods.data ?? []).map((mod) => (
                <Checkbox
                  key={mod.id}
                  checked={modIds.includes(mod.id)}
                  onChange={(next) =>
                    setModIds(next ? [...modIds, mod.id] : modIds.filter((id) => id !== mod.id))
                  }
                  label={mod.title}
                  showLabel
                  testID={`${ROUTE}.mod.${mod.id}`}
                />
              ))}
            </View>
          </View>
        ) : null}
      </EditorForm>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        title={editing ? t('update.edit') : t('composer.title')}
        onBack={close}
        backIcon="close"
        backLabel={t('composer.close')}
        testID={`${ROUTE}.header`}
      />
      {online ? null : <OfflineBanner label={t('composer.offline')} testID={`${ROUTE}.offline`} />}
      {body}
    </Screen>
  );
}
