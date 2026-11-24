import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  FORUM_LIMITS,
  useCreateThread,
  useForumCategories,
  useForumThread,
  useRemoveForumPhotos,
  useSimilarThreads,
  useUpdateThread,
  type ForumThread,
  type StoreThreadBody,
} from '@/api/queries/forum';
import { useMyVehicles } from '@/api/queries/profile';
import type { components } from '@/api/schema';
import { applyServerErrors } from '@/features/auth/forms';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { OptionRow } from '@/features/discover/components/OptionRow';
import { CentredState, EditorForm, EditorLoading } from '@/features/garage/components/frames';
import { pickPhotos } from '@/features/garage/photos';
import { uploadQueue } from '@/features/garage/uploads';
import type { WithPlateBlur } from '@/features/media/plateBlur/model';
import { usePlateBlurReview } from '@/features/media/plateBlur/PlateBlurReview';
import { photoFields } from '@/features/profile/media';
import { paramOf } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import type { PickedPhoto } from '@/state/uploads';
import { createStyles, size, space } from '@/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { Header } from '@/ui/Header';
import { IconButton } from '@/ui/IconButton';
import { ListRow } from '@/ui/ListRow';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Photo } from '@/ui/Photo';
import { RowGroup, SECTION_HEADER_ROLE } from '@/ui/RowGroup';
import { Screen } from '@/ui/Screen';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { useForumAccess } from '../access';
import { threadHref } from '../components/ThreadRow';
import { composerCategories, composerIssues, parseTags, similarQueryOf } from '../model';
import { threadPath } from '../navigation';

const ROUTE = 'FOR-04';
const EDGES = ['top', 'left', 'right'] as const;
const SIMILAR_DEBOUNCE_MS = 400;
/** "Ähnliche Themen" shows this many; more are one link away (FOR-01's search with the title). */
const SIMILAR_SHOWN = 3;

const schema = z
  .object({ title: z.string(), category: z.string(), body: z.string(), tags: z.string() })
  .superRefine((value, context) => {
    for (const [path, code] of Object.entries(composerIssues(value))) context.addIssue({ code: 'custom', path: [path], message: code });
  });
type Values = z.infer<typeof schema>;
type Picked = WithPlateBlur<PickedPhoto> & { key: string };
type Media = components['schemas']['MediaResource'];

const useStyles = createStyles((t) => ({
  group: { gap: t.space[12] },
  sectionTitle: { alignItems: 'baseline', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: t.space[8] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  tile: { borderRadius: t.radius.sm, overflow: 'hidden', width: t.size.thumb.card + t.size.thumb.card / 2 },
  tileRemove: { position: 'absolute', right: 0, top: 0 },
  similar: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, paddingHorizontal: t.space[16] },
  similarHead: { gap: t.space[2], paddingTop: t.space[12] },
  similarAll: { marginBottom: t.space[8] },
  sheetBody: { gap: t.space[24], paddingBottom: t.space[16] },
  error: { paddingTop: t.space[4] },
}));

function SectionTitle({ title, trailing }: { title: string; trailing?: string }) {
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

/**
 * FOR-04 Neues Thema `/forum-composer` (10 §7.2), a modal sheet like UPD-01 (a centred sheet of 640 from 768): title (≤ 120) with
 * "Ähnliche Themen" appearing while it is typed (`forum/similar`, debounced), the category (a picker sheet: sub-forums under their
 * parent), the text (Markdown subset), tags, up to 6 photos through the app's photo pipeline with the plate blur step, and the
 * attached car. Pre-moderation is announced before posting; the server's 422s go to their fields, 429 and the restricted state say
 * what happened. `?thread=` edits the author's thread (its photos can be removed and added there too). The discard guard asks before
 * a changed form is left.
 */
export function ForumComposerScreen() {
  const { t } = useTranslation('forum');
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; vehicleId?: string; thread?: string }>();
  const editId = paramOf(params.thread) ?? '';
  const existing = useForumThread(editId);
  const access = useForumAccess();
  const online = useOnline();
  const requireAuth = useRequireAuth();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/forum' as Href));

  let body;
  if (access.status === 'guest') {
    body = (
      <CentredState>
        <EmptyState
          icon="chats"
          title={t('composer.guestTitle')}
          body={t('composer.guestBody')}
          action={{ label: t('composer.guestSignIn'), onPress: () => requireAuth(undefined, { returnTo: '/forum-composer' }) }}
          testID={`${ROUTE}.guest`}
        />
      </CentredState>
    );
  } else if (editId && existing.isPending) {
    body = <EditorLoading routeId={ROUTE} groups={[1, 1, 3]} />;
  } else if (editId && (!existing.data || !existing.data.viewer.can_edit)) {
    body = (
      <CentredState>
        <EmptyState icon="chats" title={t('composer.notFound')} action={{ label: t('thread.toForum'), onPress: close, variant: 'secondary', size: 'm' }} testID={`${ROUTE}.notFound`} />
      </CentredState>
    );
  } else {
    body = (
      <ComposerForm
        key={existing.data?.id ?? 'new'}
        existing={existing.data ?? null}
        presetCategory={paramOf(params.category) ?? null}
        presetVehicle={paramOf(params.vehicleId) ?? null}
        onDone={close}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={editId ? t('composer.editTitle') : t('composer.title')} onBack={close} backIcon="close" backLabel={t('composer.close')} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('composer.offline')} testID={`${ROUTE}.offline`} />}
      {body}
    </Screen>
  );
}

function ComposerForm({
  existing,
  presetCategory,
  presetVehicle,
  onDone,
}: {
  existing: ForumThread | null;
  presetCategory: string | null;
  presetVehicle: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const access = useForumAccess();
  const categories = useForumCategories();
  const vehicles = useMyVehicles();
  const create = useCreateThread();
  const update = useUpdateThread(existing?.id ?? '');
  const removePhotos = useRemoveForumPhotos(existing?.id ?? '');
  const plateBlur = usePlateBlurReview(ROUTE);
  const idempotency = useRef(newIdempotencyKey());
  const editing = existing !== null;

  const options = useMemo(() => composerCategories(categories.data ?? []), [categories.data]);
  const published = useMemo(() => (vehicles.data ?? []).filter((vehicle) => vehicle.status === 'published'), [vehicles.data]);
  const [vehicleId, setVehicleId] = useState<string | null>(existing ? (existing.vehicle?.id ?? null) : presetVehicle);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [kept, setKept] = useState<Media[]>(existing?.photos ?? []);
  // SF-7: kept photos the author took out; deleted on the server only after the edit is saved.
  const [removed, setRemoved] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: existing?.title ?? '',
      category: existing?.category.slug ?? presetCategory ?? '',
      body: existing?.body ?? '',
      tags: existing?.tags.join(', ') ?? '',
    },
    mode: 'onSubmit',
  });
  const title = useWatch({ control: form.control, name: 'title' });
  const category = useWatch({ control: form.control, name: 'category' });
  const similarQuery = useDebouncedValue(editing ? null : similarQueryOf(title), SIMILAR_DEBOUNCE_MS);
  const similar = useSimilarThreads(similarQuery, category || null);
  const similarRows = similarQuery ? (similar.data ?? []) : [];
  const chosen = options.find((option) => option.slug === category);
  // A preset slug the tree does not know (an inactive category) is not offered.
  useEffect(() => {
    if (categories.isSuccess && category && !options.some((option) => option.slug === category)) form.setValue('category', '');
  }, [categories.isSuccess, category, form, options]);

  const photoCount = kept.length + photos.length;
  const dirty = !done && (form.formState.isDirty || photos.length > 0 || kept.length !== (existing?.photos.length ?? 0) || vehicleId !== (existing ? (existing.vehicle?.id ?? null) : presetVehicle));

  const messageOf = (code: string | undefined) => {
    switch (code) {
      case 'titleShort':
        return t('composer.titleShort', { min: FORUM_LIMITS.titleMin });
      case 'titleLong':
        return t('composer.titleLong', { max: FORUM_LIMITS.titleMax });
      case 'categoryMissing':
        return t('composer.categoryMissing');
      case 'bodyShort':
        return t('composer.bodyShort', { min: FORUM_LIMITS.openingMin });
      case 'bodyLong':
        return t('composer.bodyLong', { max: FORUM_LIMITS.openingMax });
      case 'tagsInvalid':
        return t('composer.tagsInvalid');
      case 'tagsTooMany':
        return t('composer.tagsTooMany', { max: FORUM_LIMITS.tags });
      default:
        return code;
    }
  };

  const addPhotos = async () => {
    const remaining = FORUM_LIMITS.photos - photoCount;
    if (remaining <= 0) return;
    try {
      const picked = await pickPhotos(remaining);
      if (!picked || picked.length === 0) return;
      const reviewed = await plateBlur.review(picked);
      if (!reviewed || reviewed.length === 0) return;
      setPhotos((current) => [...current, ...reviewed.slice(0, remaining).map((photo, index) => ({ ...photo, key: `${Date.now()}-${index}-${photo.uri.slice(-12)}` }))]);
    } catch {
      toast(t('composer.photoFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
    }
  };

  const removeKept = (media: Media) => {
    setKept((current) => current.filter((entry) => entry.id !== media.id));
    setRemoved((current) => [...current, media.id]);
  };

  const finish = async (thread: ForumThread) => {
    // The removals first, so the new photos never meet the 6-photo limit with the old ones still there.
    const failed = removed.length > 0 ? await removePhotos.mutateAsync(removed).catch(() => removed.length) : 0;
    haptics.success();
    setDone(true);
    if (failed > 0) toast(t('composer.photoRemoveFailed', { count: failed }), { haptic: 'warning', testID: `${ROUTE}.photoToast` });
    if (photos.length > 0) {
      uploadQueue().store.getState().enqueue({ kind: 'forum', vehicleId: thread.id, threadId: thread.id }, photos);
    }
    const message = thread.status === 'pending' ? t('composer.pending') : editing ? t('composer.saved') : t('composer.posted');
    toast(photos.length > 0 ? `${message} ${t('composer.uploading', { count: photos.length })}` : message, { testID: `${ROUTE}.toast` });
    // After the guard saw `done` (next frame): close the sheet, then open the thread (a new one) where it now lives.
    requestAnimationFrame(() => {
      onDone();
      if (!editing) router.push(threadPath(thread.id));
    });
  };

  const fail = (error: ApiError) => {
    haptics.error();
    if (error.kind === 'rate_limited') {
      setNotice(t('composer.rateLimited'));
      return;
    }
    const left = applyServerErrors(error, form.setError, { title: 'title', category: 'category', body: 'body', tags: 'tags', 'tags.0': 'tags', vehicle_id: 'category' });
    setNotice(left ?? (error.message || t('composer.failed')));
  };

  const onValid = (values: Values) => {
    setNotice(null);
    const body: StoreThreadBody = {
      title: values.title.trim(),
      category: values.category,
      body: values.body.trim(),
      tags: parseTags(values.tags),
      vehicle_id: vehicleId,
    };
    if (editing) update.mutate(body, { onSuccess: (thread) => void finish(thread), onError: (error) => fail(error as ApiError) });
    else create.mutate({ body, idempotencyKey: idempotency.current }, { onSuccess: (thread) => void finish(thread), onError: (error) => fail(error as ApiError) });
  };
  const submit = () => void form.handleSubmit(onValid, () => haptics.warning())();

  const restricted = access.restriction ?? (qaState === 'restricted' ? t('restricted.body') : null);

  return (
    <EditorForm
      routeId={ROUTE}
      sheet
      dirty={dirty}
      revealTop={notice}
      cta={{
        label: editing ? t('composer.save') : t('composer.post'),
        onPress: submit,
        loading: create.isPending || update.isPending || removePhotos.isPending,
        disabled: !online || restricted !== null,
      }}
    >
      {restricted ? <FormNotice tone="info" message={restricted} testID={`${ROUTE}.restricted`} /> : null}
      {!restricted && access.premoderated && !editing ? <FormNotice tone="info" message={t('composer.premoderation')} testID={`${ROUTE}.premoderation`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}

      <View style={styles.group}>
        <Controller
          control={form.control}
          name="title"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              label={t('composer.titleLabel')}
              helper={t('composer.titleHelper')}
              error={messageOf(fieldState.error?.message)}
              maxLength={FORUM_LIMITS.titleMax}
              returnKeyType="next"
              testID={`${ROUTE}.title`}
            />
          )}
        />
        {similarRows.length > 0 ? (
          <View style={styles.similar} role="list" aria-label={t('composer.similarTitle')} testID={`${ROUTE}.similar`}>
            <View style={styles.similarHead}>
              <Text variant="calloutStrong" role="heading" {...({ 'aria-level': 2 } as object)}>
                {t('composer.similarTitle')}
              </Text>
              <Text variant="caption" color="text.secondary">
                {t('composer.similarHint')}
              </Text>
            </View>
            {/* DQ-P5-027: compact rows, at most three, so the suggestions never push Kategorie and Text off the screen. */}
            {similarRows.slice(0, SIMILAR_SHOWN).map((row, index, shown) => (
              <View key={row.id} role="listitem">
                <ListRow
                  title={row.title}
                  subtitle={row.replies_count > 0 ? t('row.replies', { count: row.replies_count }) : t('row.noReplies')}
                  role="link"
                  inset={space[0]}
                  onPress={() => router.push(threadHref(row))}
                  divider={index < shown.length - 1}
                  testID={`${ROUTE}.similar.thread.${row.id}`}
                />
              </View>
            ))}
            {similarRows.length > SIMILAR_SHOWN && similarQuery ? (
              <Button
                label={t('composer.similarAll')}
                variant="tertiary"
                size="s"
                role="link"
                flush="start"
                onPress={() => router.push({ pathname: '/forum', params: { q: similarQuery } } as unknown as Href)}
                style={styles.similarAll}
                testID={`${ROUTE}.similar.all`}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.group}>
        <SectionTitle title={t('composer.category')} />
        <Controller
          control={form.control}
          name="category"
          render={({ fieldState }) => (
            <View>
              <RowGroup>
                <ListRow
                  title={chosen ? chosen.label : t('composer.category')}
                  subtitle={chosen?.group ?? undefined}
                  icon="chats"
                  role="button"
                  onPress={() => (categories.isError ? void categories.refetch() : setPickerOpen(true))}
                  testID={`${ROUTE}.category`}
                />
              </RowGroup>
              {fieldState.error ? (
                <Text variant="caption" color="accent.fg" role="alert" style={styles.error} testID={`${ROUTE}.category.error`}>
                  {messageOf(fieldState.error.message)}
                </Text>
              ) : categories.isError ? (
                <Text variant="caption" color="text.secondary" style={styles.error}>
                  {t('composer.categoriesError')}
                </Text>
              ) : null}
            </View>
          )}
        />
      </View>

      <Controller
        control={form.control}
        name="body"
        render={({ field, fieldState }) => (
          <TextInput
            ref={field.ref}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            label={t('composer.body')}
            helper={t('composer.bodyHelper')}
            error={messageOf(fieldState.error?.message)}
            multiline
            // DQ-P5-027: a thread's text is a body, not a one-line answer: six lines from the start, growing to twelve.
            minRows={6}
            maxRows={12}
            maxLength={FORUM_LIMITS.openingMax + 200}
            testID={`${ROUTE}.body`}
          />
        )}
      />

      <Controller
        control={form.control}
        name="tags"
        render={({ field, fieldState }) => (
          <TextInput
            ref={field.ref}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            label={t('composer.tags')}
            helper={t('composer.tagsHelper', { max: FORUM_LIMITS.tags })}
            error={messageOf(fieldState.error?.message)}
            autoCapitalize="none"
            autoCorrect={false}
            testID={`${ROUTE}.tags`}
          />
        )}
      />

      <View style={styles.group} testID={`${ROUTE}.photos`}>
        <SectionTitle title={t('composer.photos')} trailing={t('composer.photosCount', { count: photoCount, max: FORUM_LIMITS.photos })} />
        {photoCount > 0 ? (
          <View style={styles.photos}>
            {kept.map((media, index) => (
              <View key={media.id} style={styles.tile} aria-label={t('composer.photo', { index: index + 1 })} testID={`${ROUTE}.photo.kept.${index}`}>
                <Photo {...photoFields(media, size.thumb.card * 2)} aspect="1:1" corner="sm" />
                <View style={styles.tileRemove}>
                  <IconButton icon="x" variant="onPhoto" label={t('composer.removePhoto', { index: index + 1 })} onPress={() => removeKept(media)} testID={`${ROUTE}.photo.kept.${index}.remove`} />
                </View>
              </View>
            ))}
            {photos.map((photo, index) => (
              <View key={photo.key} style={styles.tile} aria-label={t('composer.photo', { index: kept.length + index + 1 })} testID={`${ROUTE}.photo.${index}`}>
                <Photo source={photo.uri} aspect="1:1" corner="sm" />
                <View style={styles.tileRemove}>
                  <IconButton
                    icon="x"
                    variant="onPhoto"
                    label={t('composer.removePhoto', { index: kept.length + index + 1 })}
                    onPress={() => setPhotos((current) => current.filter((entry) => entry.key !== photo.key))}
                    testID={`${ROUTE}.photo.${index}.remove`}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <Button
          label={t('composer.addPhotos')}
          icon="image"
          variant="secondary"
          size="m"
          onPress={() => void addPhotos()}
          disabled={photoCount >= FORUM_LIMITS.photos}
          testID={`${ROUTE}.addPhotos`}
        />
      </View>

      {published.length > 0 ? (
        <View style={styles.group} testID={`${ROUTE}.vehicles`}>
          <SectionTitle title={t('composer.vehicle')} />
          <View style={styles.chips} role="radiogroup" aria-label={t('composer.vehicle')}>
            <Chip label={t('composer.vehicleNone')} selected={vehicleId === null} selectionRole="radio" onPress={() => setVehicleId(null)} testID={`${ROUTE}.vehicle.none`} />
            {published.map((vehicle) => (
              <Chip
                key={vehicle.id}
                label={vehicle.title}
                selected={vehicle.id === vehicleId}
                selectionRole="radio"
                onPress={() => {
                  haptics.selection();
                  setVehicleId(vehicle.id);
                }}
                testID={`${ROUTE}.vehicle.${vehicle.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t('composer.category')} initialSnap="full" testID={`${ROUTE}.categories`}>
        <View style={styles.sheetBody}>
          {(categories.data ?? []).map((top) => {
            const entries = top.children.length > 0 ? top.children : [top];
            return (
              <RowGroup key={top.slug} title={top.children.length > 0 ? top.name : undefined} testID={`${ROUTE}.categories.${top.slug}`}>
                <View role="radiogroup" aria-label={top.name}>
                  {entries.map((entry, index) => (
                    <OptionRow
                      key={entry.slug}
                      label={entry.name}
                      role="radio"
                      selected={entry.slug === category}
                      onPress={() => {
                        haptics.selection();
                        form.setValue('category', entry.slug, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
                        setPickerOpen(false);
                      }}
                      divider={index < entries.length - 1}
                      testID={`${ROUTE}.categories.option.${entry.slug}`}
                    />
                  ))}
                </View>
              </RowGroup>
            );
          })}
        </View>
      </Sheet>
      {plateBlur.element}
    </EditorForm>
  );
}
