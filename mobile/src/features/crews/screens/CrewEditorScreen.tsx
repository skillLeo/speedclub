import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  BUNDESLAENDER,
  CREW_LIMITS,
  JOIN_MODES,
  isCrewUnavailable,
  useCreateCrew,
  useCrew,
  useCrewsOn,
  useDeleteCrewMedia,
  useUpdateCrew,
  useUploadCrewMedia,
  type Crew,
  type CrewJoinMode,
  type CrewMedia,
  type CrewMediaKind,
} from '@/api/queries/crews';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { OptionRow } from '@/features/discover/components/OptionRow';
import { CentredState, EditorForm, EditorLoading, EditorScreen, LoadErrorState, RestrictedNotice, SignInState } from '@/features/garage/components/frames';
import { ChoiceChips, FormGroup, PickerField, useCharCount } from '@/features/garage/components/fields';
import { photoForm, pickPhotos, preparePhoto, releasePicked } from '@/features/garage/photos';
import { appendPlateBlur, type WithPlateBlur } from '@/features/media/plateBlur/model';
import { usePlateBlurReview } from '@/features/media/plateBlur/PlateBlurReview';
import { photoFields } from '@/features/profile/media';
import { paramOf } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, size } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { useCrewAccess } from '../access';
import { CrewDeleteZone } from '../components/CrewDeleteZone';
import {
  bundeslandLabel,
  createBody,
  CREW_SERVER_FIELDS,
  crewErrorText,
  crewFormFrom,
  crewFormSchema,
  crewPath,
  CREWS_PATH,
  EMPTY_CREW_FORM,
  joinModeLabel,
  tx,
  updateBody,
  type CrewFormInput,
  type CrewFormValues,
} from '../model';

const ROUTE = 'CREW-02';
const DESCRIPTION_ROWS = 5;

const useStyles = createStyles((t) => ({
  media: { gap: t.space[12] },
  mediaRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[16] },
  // The logo shows as the circle it is on CREW-01 (R4DQ-18).
  logo: { borderRadius: t.radius.full, overflow: 'hidden', width: t.size.avatar.xl },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  grow: { flex: 1, gap: t.space[8], minWidth: 0 },
}));

type Picked = WithPlateBlur<{ uri: string; width: number; height: number }>;
type MediaChange = { picked: Picked | null; removed: boolean };
const NO_CHANGE: MediaChange = { picked: null, removed: false };

/**
 * CREW-02 Crew gründen `/crews/new` and Crew bearbeiten `/crews/[slug]/edit` (11 R4-2.3, contract §3 #8–#11, §4): name (3–40, letters,
 * digits, spaces and - _ . & ' !, unique, no reserved word), description (≤ 500), Bundesland, join mode Offen · Auf Anfrage · Nur mit
 * Einladung, logo (square) and cover (16:9) through the photo picker and the plate-blur review (M5.9a) like every upload. A new crew
 * is created with an Idempotency-Key, then its logo and cover follow; a refused name or description (422, also `content_blocked`)
 * lands on its field. The discard guard asks before a changed form leaves.
 */
export function CrewEditorScreen({ mode }: { mode: 'create' | 'edit' }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (paramOf(params.slug) ?? '').toLowerCase();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useCrewsOn();
  const status = useSessionStore((state) => state.status);
  const access = useCrewAccess();
  const crew = useCrew(mode === 'edit' ? slug : '');
  const title = mode === 'create' ? t('form.createTitle') : t('form.editTitle');
  const fallback = (mode === 'edit' && slug ? crewPath(slug) : CREWS_PATH) as Href;
  const returnTo = mode === 'create' ? `${CREWS_PATH}/new` : `${crewPath(slug)}/edit`;

  let body: ReactNode;
  if (status === 'guest') {
    body = (
      <CentredState>
        <SignInState routeId={ROUTE} returnTo={returnTo} />
      </CentredState>
    );
  } else if (!flag && qaState === 'default') {
    body = (
      <CentredState>
        <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />
      </CentredState>
    );
  } else if (qaState === 'loading' || status === 'loading' || (mode === 'edit' && crew.isPending && crew.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <EditorLoading routeId={ROUTE} groups={[2, 1, 2]} />;
  } else if (qaState === 'error' || qaState === 'offline' || (mode === 'edit' && !crew.data && !isCrewUnavailable(crew.error))) {
    body = (
      <CentredState>
        <LoadErrorState
          routeId={ROUTE}
          offline={qaState === 'offline' || (qaState !== 'error' && (!online || crew.fetchStatus === 'paused'))}
          title={t('page.errorTitle')}
          onRetry={() => void crew.refetch()}
          retrying={crew.isFetching}
        />
      </CentredState>
    );
  } else if (mode === 'edit' && (!crew.data || !crew.data.viewer?.can.edit)) {
    body = (
      <CentredState>
        <EmptyState
          icon="users"
          title={crew.data ? t('form.notAllowedTitle') : t('page.notFoundTitle')}
          body={crew.data ? t('form.notAllowedBody') : t('page.notFoundBody')}
          action={{ label: t('page.toCrews'), onPress: () => router.navigate(CREWS_PATH as Href), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.notFound`}
        />
      </CentredState>
    );
  } else {
    body = (
      <CrewForm
        crew={mode === 'edit' ? (crew.data ?? null) : null}
        restriction={access.restriction}
        unverified={access.unverified && mode === 'create'}
        onDone={(next) => router.replace(crewPath(next) as Href)}
        onDeleted={() => router.replace(`${CREWS_PATH}/mine` as Href)}
      />
    );
  }

  return (
    <EditorScreen routeId={ROUTE} title={title} fallback={fallback} offlineLabel={t('states.offlineBanner')}>
      {body}
    </EditorScreen>
  );
}

function CrewForm({
  crew,
  restriction,
  unverified,
  onDone,
  onDeleted,
}: {
  crew: Crew | null;
  restriction: string | null;
  unverified: boolean;
  onDone: (slug: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const online = useOnline();
  const charCount = useCharCount();
  const isNew = crew === null;
  const defaults = useMemo<CrewFormInput>(() => (crew ? crewFormFrom(crew) : EMPTY_CREW_FORM), [crew]);
  const form = useForm<CrewFormInput, unknown, CrewFormValues>({ resolver: zodResolver(crewFormSchema), mode: 'onTouched', defaultValues: defaults });
  const values = useWatch({ control: form.control });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [logo, setLogo] = useState<MediaChange>(NO_CHANGE);
  const [cover, setCover] = useState<MediaChange>(NO_CHANGE);
  const plateBlur = usePlateBlurReview(ROUTE);
  const slugRef = useRef<string | null>(crew?.slug ?? null);
  const createKey = useRef(newIdempotencyKey());
  const mediaKeys = useRef<Record<CrewMediaKind, string>>({ logo: newIdempotencyKey(), cover: newIdempotencyKey() });
  const create = useCreateCrew();
  const update = useUpdateCrew();
  const upload = useUploadCrewMedia();
  const removeMedia = useDeleteCrewMedia();
  const locked = restriction !== null;

  const message = (error: { message?: string; type?: string } | undefined) => {
    if (!error?.message) return undefined;
    return error.type === 'server' ? error.message : tx(t, error.message, { min: CREW_LIMITS.nameMin, max: CREW_LIMITS.nameMax, limit: CREW_LIMITS.descriptionMax });
  };

  const pick = async (kind: CrewMediaKind) => {
    const picked = await pickPhotos(1);
    if (!picked || picked.length === 0) return;
    const first = (await plateBlur.review(picked))?.[0];
    if (!first) {
      for (const photo of picked) releasePicked(photo);
      return;
    }
    const set = kind === 'logo' ? setLogo : setCover;
    const before = kind === 'logo' ? logo : cover;
    if (before.picked) releasePicked(before.picked);
    mediaKeys.current[kind] = newIdempotencyKey();
    set({ picked: first, removed: false });
  };
  const remove = (kind: CrewMediaKind) => {
    const set = kind === 'logo' ? setLogo : setCover;
    const before = kind === 'logo' ? logo : cover;
    if (before.picked) releasePicked(before.picked);
    set({ picked: null, removed: (kind === 'logo' ? crew?.logo : crew?.cover) != null });
  };

  /** Logo and cover after the crew exists; a failed photo does not undo the saved crew. */
  const sendMedia = async (slug: string) => {
    for (const [kind, change] of [['logo', logo], ['cover', cover]] as const) {
      try {
        if (change.picked) {
          const prepared = await preparePhoto(change.picked);
          await upload.mutateAsync({ slug, kind, form: appendPlateBlur(await photoForm(prepared), change.picked.plateBlur), idempotencyKey: mediaKeys.current[kind] });
          releasePicked(change.picked);
        } else if (change.removed) {
          await removeMedia.mutateAsync({ slug, kind });
        }
      } catch (error) {
        toast(kind === 'logo' ? t('form.logoFailed') : t('form.coverFailed'), { testID: `${ROUTE}.mediaToast` });
        if (error instanceof ApiError && error.kind === 'session_moved') return;
      }
    }
  };

  const submit = () =>
    form.handleSubmit(
    async (valid) => {
      setNotice(null);
      setBusy(true);
      try {
        let next: Crew;
        if (!slugRef.current) {
          next = await create.mutateAsync({ body: createBody(valid), idempotencyKey: createKey.current });
          slugRef.current = next.slug;
        } else {
          const changes = updateBody(valid, defaults);
          next = Object.keys(changes).length > 0 || !crew ? await update.mutateAsync({ slug: slugRef.current, body: changes }) : crew;
          slugRef.current = next.slug;
        }
        await sendMedia(next.slug);
        haptics.success();
        setSaved(true);
        toast(isNew ? t('form.created', { name: next.name }) : t('form.saved'), { testID: `${ROUTE}.toast` });
        requestAnimationFrame(() => onDone(next.slug));
      } catch (error) {
        haptics.error();
        const left = applyServerErrors(error, form.setError, CREW_SERVER_FIELDS);
        setNotice(left === null ? null : crewErrorText(t, error, 'form.failed'));
      } finally {
        setBusy(false);
      }
    },
    () => haptics.warning(),
  )();

  const dirty = (form.formState.isDirty || logo !== NO_CHANGE || cover !== NO_CHANGE) && !saved;
  const shownLogo = mediaShown(logo, crew?.logo ?? null, size.avatar.xl);
  const shownCover = mediaShown(cover, crew?.cover ?? null, layout.feedColumn);
  const region = values.bundesland ? bundeslandLabel(t, values.bundesland) : '';

  return (
    <EditorForm
      routeId={ROUTE}
      dirty={dirty}
      onDiscard={() => {
        if (logo.picked) releasePicked(logo.picked);
        if (cover.picked) releasePicked(cover.picked);
      }}
      revealTop={notice}
      cta={{ label: isNew ? t('form.create') : t('form.save'), onPress: () => void submit(), loading: busy, disabled: locked || !online }}
    >
      {restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {unverified ? <FormNotice tone="info" message={t('errors.emailNotVerified')} testID={`${ROUTE}.unverified`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      {isNew ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('form.intro')}
        </Text>
      ) : null}
      <FormGroup title={t('form.about')}>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('form.name')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              maxLength={CREW_LIMITS.nameMax}
              autoCapitalize="words"
              autoCorrect={false}
              helper={fieldState.error ? undefined : t('form.nameHelper', { min: CREW_LIMITS.nameMin, max: CREW_LIMITS.nameMax })}
              error={message(fieldState.error)}
              disabled={locked}
              testID={`${ROUTE}.name`}
            />
          )}
        />
        <Controller
          control={form.control}
          name="description"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('form.description')}
              placeholder={t('form.descriptionPlaceholder')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              multiline
              minRows={DESCRIPTION_ROWS}
              maxLength={CREW_LIMITS.descriptionMax}
              helper={fieldState.error ? undefined : charCount(field.value.length, CREW_LIMITS.descriptionMax)}
              error={message(fieldState.error)}
              disabled={locked}
              testID={`${ROUTE}.description`}
            />
          )}
        />
        <Controller
          control={form.control}
          name="bundesland"
          render={({ fieldState }) => (
            <PickerField
              label={t('form.bundesland')}
              value={region}
              placeholder={t('form.bundeslandPlaceholder')}
              helper={t('form.bundeslandHelper')}
              error={message(fieldState.error)}
              onPress={() => setRegionOpen(true)}
              disabled={locked}
              testID={`${ROUTE}.bundesland`}
            />
          )}
        />
      </FormGroup>
      <Controller
        control={form.control}
        name="joinMode"
        render={({ field }) => (
          <FormGroup title={t('form.joinMode')}>
            <ChoiceChips<CrewJoinMode>
              label={t('form.joinMode')}
              options={JOIN_MODES.map((value) => ({ value, label: joinModeLabel(t, value) }))}
              value={field.value}
              onChange={(next) => (next ? field.onChange(next) : undefined)}
              disabled={locked}
              testID={`${ROUTE}.joinMode`}
            />
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.joinModeHelper`}>
              {tx(t, `form.joinModeHelper.${field.value}`)}
            </Text>
          </FormGroup>
        )}
      />
      <FormGroup title={t('form.logo')} testID={`${ROUTE}.logo`}>
        <View style={styles.mediaRow}>
          {shownLogo ? <Photo {...shownLogo} aspect="1:1" corner="full" style={styles.logo} testID={`${ROUTE}.logo.photo`} /> : null}
          <View style={styles.grow}>
            <Text variant="caption" color="text.secondary">
              {t('form.logoHelper')}
            </Text>
            <MediaButtons kind="logo" shown={shownLogo !== null} disabled={locked} onPick={() => void pick('logo')} onRemove={() => remove('logo')} />
          </View>
        </View>
      </FormGroup>
      <FormGroup title={t('form.cover')} testID={`${ROUTE}.cover`}>
        <View style={styles.media}>
          {shownCover ? <Photo {...shownCover} aspect="16:9" corner="md" testID={`${ROUTE}.cover.photo`} /> : null}
          <Text variant="caption" color="text.secondary">
            {t('form.coverHelper')}
          </Text>
          <MediaButtons kind="cover" shown={shownCover !== null} disabled={locked} onPick={() => void pick('cover')} onRemove={() => remove('cover')} />
        </View>
      </FormGroup>
      {/* R4DQ-30: the founder deletes the crew here, at the end of the form, behind the typed-name dialog. */}
      {crew && crew.viewer?.role === 'founder' && crew.viewer.can.delete ? (
        <CrewDeleteZone
          crew={crew}
          routeId={ROUTE}
          onDeleted={() => {
            setSaved(true);
            requestAnimationFrame(onDeleted);
          }}
        />
      ) : null}
      <Sheet visible={regionOpen} onClose={() => setRegionOpen(false)} title={t('form.bundesland')} narrow testID={`${ROUTE}.regionSheet`}>
        <View role="radiogroup" aria-label={t('form.bundesland')}>
          <OptionRow
            label={t('form.noBundesland')}
            role="radio"
            selected={!values.bundesland}
            onPress={() => {
              setRegionOpen(false);
              form.setValue('bundesland', '', { shouldDirty: true });
            }}
            divider
            testID={`${ROUTE}.regionSheet.none`}
          />
          {BUNDESLAENDER.map((code, index) => (
            <OptionRow
              key={code}
              label={bundeslandLabel(t, code)}
              role="radio"
              selected={values.bundesland === code}
              onPress={() => {
                setRegionOpen(false);
                form.setValue('bundesland', code, { shouldDirty: true });
              }}
              divider={index < BUNDESLAENDER.length - 1}
              testID={`${ROUTE}.regionSheet.${code}`}
            />
          ))}
        </View>
      </Sheet>
      {plateBlur.element}
    </EditorForm>
  );
}

function MediaButtons({ kind, shown, disabled, onPick, onRemove }: { kind: CrewMediaKind; shown: boolean; disabled: boolean; onPick: () => void; onRemove: () => void }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  return (
    <View style={styles.mediaActions}>
      <Button label={shown ? t('form.change') : t('form.pick')} icon="image" variant="secondary" size="m" disabled={disabled} onPress={onPick} accessibilityLabel={tx(t, `form.${kind}Pick`)} testID={`${ROUTE}.${kind}.pick`} />
      {shown ? <Button label={t('form.remove')} variant="tertiary" size="m" disabled={disabled} onPress={onRemove} accessibilityLabel={tx(t, `form.${kind}Remove`)} testID={`${ROUTE}.${kind}.remove`} /> : null}
    </View>
  );
}

/** What the form shows: the photo just picked, else the saved one unless it was removed. */
function mediaShown(change: MediaChange, saved: CrewMedia | null, width: number): PhotoFields | null {
  if (change.picked) return { source: change.picked.uri };
  if (change.removed || !saved) return null;
  return photoFields(saved, width);
}
