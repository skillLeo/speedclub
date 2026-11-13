import '@/features/events/i18n';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import {
  EMAIL_NOT_VERIFIED,
  EVENT_CLOSED,
  EVENT_IN_REVIEW,
  EVENT_RULES,
  EVENT_TYPES,
  EVENTS_CREATE_FLAG,
  EVENTS_FLAG,
  GEOCODE_UNAVAILABLE,
  isUnavailable,
  LIMIT_REACHED,
  ORGANISER_NOT_ELIGIBLE,
  useEvent,
  useGeocode,
  useMyEvents,
  useSaveEvent,
  useSubmitEvent,
  useUploadEventCover,
  type EventCard,
  type EventDetail,
  type EventLocationVisibility,
  type EventRule,
  type EventType,
  type EventVisibility,
  type GeocodeResult,
} from '@/api/queries/events';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { CentredState, EditorForm, EditorLoading, LoadErrorState } from '@/features/garage/components/frames';
import { ChoiceChips, FieldPair, FormGroup } from '@/features/garage/components/fields';
import { photoForm, pickPhotos, preparePhoto, releasePicked } from '@/features/garage/photos';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  Checkbox,
  EmptyState,
  Header,
  ListRow,
  OfflineBanner,
  Photo,
  Progress,
  Screen,
  SegmentedControl,
  Text,
  TextInput,
  toast,
} from '@/ui';

import { useOrganiserRestriction } from '../access';
import { EventCardView } from '../components/EventCardView';
import { RestrictionLine } from '../components/EventParts';
import { EventMap } from '../map/EventMap';
import { CITY_ZOOM } from '../map/mapConfig';
import { eventPath, hasEnded, ZONE } from '../model';
import {
  changeEffects,
  createBody,
  emptyValues,
  endInstant,
  eventSchema,
  fieldText,
  instantOf,
  maskDate,
  maskTime,
  SERVER_FIELDS,
  STEP_FIELDS,
  stepOf,
  STEPS,
  updateBody,
  valuesFrom,
  type EventFormValues,
  type Step,
} from '../schemas';

const ROUTE = 'EVT-03';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const PICKER_HEIGHT = size.avatar.xl * 2 + size.touchMin;
const DESCRIPTION_ROWS = 8;
const RULES_ROWS = 4;

const useStyles = createStyles((t) => ({
  progress: { gap: t.space[8] },
  results: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  search: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[8] },
  grow: { flex: 1 },
  cover: { gap: t.space[12] },
  coverActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  rules: { gap: t.space[4] },
  preview: { gap: t.space[16] },
  summary: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[12],
    padding: t.space[16],
  },
  summaryRow: { gap: t.space[2] },
  draft: { alignSelf: 'flex-start' },
}));

/**
 * EVT-03 Treffen erstellen/bearbeiten `(modals)/event-editor/[id]` (09 §7.10, `new` or the event's slug): a sheet wizard Basis → Ort →
 * Zeit → Details & Regeln → Vorschau. A new event is saved as a draft with an Idempotency-Key, then its cover, then sent ("Zur
 * Prüfung senden" for the first two and every after_rsvp event, else "Veröffentlichen"). A pending event is frozen (409
 * event_in_review, ADR-439) and shows that instead of the form; a change of a published event says who hears of it.
 */
export function EventEditorScreen() {
  const { t } = useTranslation('events');
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramOf(params.id) ?? 'new';
  const isNew = id === 'new';
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useFlag(EVENTS_FLAG);
  const createFlag = useFlag(EVENTS_CREATE_FLAG);
  const requireAuth = useRequireAuth();
  const restriction = useOrganiserRestriction();
  const close = useBack(isNew ? '/events' : `/events/${id}`);
  const existing = useEvent(isNew ? '' : id);
  const event = existing.data;

  let body: ReactNode;
  if (status === 'guest') {
    body = (
      <CentredState>
        <EmptyState
          icon="meet"
          title={t('editor.guestTitle')}
          body={t('editor.guestBody')}
          action={{
            label: t('editor.signIn'),
            onPress: () => requireAuth(undefined, { returnTo: `/event-editor/${id}` }),
          }}
          testID={`${ROUTE}.guest`}
        />
      </CentredState>
    );
  } else if ((!flag || (isNew && !createFlag)) && qaState === 'default') {
    body = (
      <CentredState>
        <EmptyState
          icon="meet"
          title={t('list.unavailableTitle')}
          body={t('editor.createOff')}
          testID={`${ROUTE}.unavailable`}
        />
      </CentredState>
    );
  } else if (
    qaState === 'loading' ||
    status === 'loading' ||
    (!isNew && !event && existing.isPending && existing.fetchStatus !== 'paused')
  ) {
    body = <EditorLoading routeId={ROUTE} groups={[2, 2, 1]} />;
  } else if (qaState === 'error' || (!isNew && !event && !isUnavailable(existing.error))) {
    body = (
      <CentredState>
        <LoadErrorState
          routeId={ROUTE}
          offline={!online || existing.fetchStatus === 'paused'}
          onRetry={() => void existing.refetch()}
          retrying={existing.isFetching}
        />
      </CentredState>
    );
  } else if (!isNew && (!event || (!event.can.edit && event.status !== 'pending_review'))) {
    const closed = event && (event.status === 'cancelled' || hasEnded(event, now()));
    body = (
      <CentredState>
        <EmptyState
          icon="meet"
          title={closed ? t('detail.ended') : t('editor.goneTitle')}
          body={closed ? t('editor.closed') : t('editor.goneBody')}
          action={{ label: t('detail.toEvents'), onPress: close, variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.notFound`}
        />
      </CentredState>
    );
  } else if (event?.status === 'pending_review') {
    body = (
      <CentredState>
        <EmptyState
          icon="clock"
          title={t('review.frozenTitle')}
          body={t('review.frozen')}
          action={{ label: t('review.toEvent'), onPress: close, variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.frozen`}
        />
      </CentredState>
    );
  } else {
    body = (
      <EventForm
        event={event ?? null}
        restriction={restriction}
        onDone={(slug) => {
          close();
          if (isNew) requestAnimationFrame(() => router.push(eventPath(slug)));
        }}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        title={isNew ? t('editor.createTitle') : t('editor.editTitle')}
        onBack={close}
        backIcon="close"
        backLabel={t('editor.close')}
        testID={`${ROUTE}.header`}
      />
      {online ? null : <OfflineBanner label={t('editor.offline')} testID={`${ROUTE}.offline`} />}
      {body}
    </Screen>
  );
}

type PickedCover = { uri: string; width: number; height: number };

/** The server's reason for a refused save, in our words where we have them. */
function saveNotice(t: (key: string, options?: Record<string, unknown>) => string, error: unknown): string {
  if (!(error instanceof ApiError)) return t('editor.failed');
  if (error.code === EVENT_IN_REVIEW) return t('editor.inReview');
  if (error.code === EVENT_CLOSED) return t('editor.closed');
  if (error.code === LIMIT_REACHED) return t('editor.limit');
  if (error.code === EMAIL_NOT_VERIFIED) return t('editor.notVerified');
  if (error.code === ORGANISER_NOT_ELIGIBLE) return error.message || t('editor.notEligible');
  if (error.kind === 'rate_limited') return t('editor.tooManyChanges');
  return error.message || t('editor.failed');
}

function EventForm({
  event,
  restriction,
  onDone,
}: {
  event: EventDetail | null;
  restriction: string | null;
  onDone: (slug: string) => void;
}) {
  const { t } = useTranslation('events');
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const styles = useStyles();
  const online = useOnline();
  const isNew = event === null;
  const defaults = useMemo(() => (event ? valuesFrom(event) : emptyValues()), [event]);
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema(now(), isNew)) as never,
    mode: 'onTouched',
    defaultValues: defaults,
  });
  const [step, setStep] = useState<Step>('basics');
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cover, setCover] = useState<PickedCover | null>(null);
  const [busy, setBusy] = useState(false);
  const slug = useRef<string | null>(event?.slug ?? null);
  const savedValues = useRef<EventFormValues>(defaults);
  const createKey = useRef(newIdempotencyKey());
  const coverKey = useRef(newIdempotencyKey());
  const save = useSaveEvent();
  const submit = useSubmitEvent();
  const upload = useUploadEventCover();
  const organised = useMyEvents('organised', isNew);
  const values = useWatch({ control: form.control }) as EventFormValues;
  const index = STEPS.indexOf(step);
  const locked = restriction !== null;
  const editableDraft = !event || event.status === 'draft' || event.status === 'rejected';
  const locationLocked = !editableDraft;

  // 09 §8.7: the first two events and every after_rsvp event are reviewed first. The server decides; this only names the button.
  const published = (organised.data?.pages ?? [])
    .flatMap((page: { data: EventCard[] }) => page.data)
    .filter((entry) => entry.status === 'published' || entry.status === 'cancelled').length;
  const reviewFirst =
    values.locationVisibility === 'after_rsvp' ||
    published < 2 ||
    (event !== null && event.status === 'rejected');

  const goTo = (next: Step) => {
    setNotice(null);
    setStep(next);
  };
  const next = async () => {
    const ok = await form.trigger(STEP_FIELDS[step] as Path<EventFormValues>[], { shouldFocus: true });
    if (!ok) {
      haptics.warning();
      return;
    }
    haptics.selection();
    goTo(STEPS[index + 1] ?? 'preview');
  };

  const fail = (error: unknown) => {
    haptics.error();
    const left = applyServerErrors(error, form.setError, SERVER_FIELDS);
    if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
      const first = Object.keys(error.fieldErrors)
        .map((field) => SERVER_FIELDS[field])
        .find(Boolean);
      if (first) setStep(stepOf(first));
    }
    setNotice(left === null ? null : saveNotice(translate, error));
  };

  const finish = (slugValue: string, message: string) => {
    haptics.success();
    setSaved(true);
    toast(message, { testID: `${ROUTE}.toast` });
    requestAnimationFrame(() => onDone(slugValue));
  };

  /** Draft (or change) → cover → optionally send. Each step keeps what the one before it achieved. */
  const persist = async (send: boolean) => {
    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      haptics.warning();
      const firstError = Object.keys(form.formState.errors)[0];
      if (firstError) setStep(stepOf(firstError));
      return;
    }
    setNotice(null);
    setBusy(true);
    const current = form.getValues();
    try {
      let saved_: EventDetail;
      let before = event?.status ?? 'draft';
      let effects = { notifies: false, reviewFields: false };
      if (!slug.current) {
        saved_ = await save.mutateAsync({
          mode: 'create',
          body: createBody(current),
          idempotencyKey: createKey.current,
        });
        slug.current = saved_.slug;
      } else {
        const body = updateBody(current, savedValues.current, locationLocked);
        effects = changeEffects(body);
        saved_ =
          Object.keys(body).length > 0 || !event
            ? await save.mutateAsync({ mode: 'update', slug: slug.current, body })
            : event;
        before = event?.status ?? before;
      }
      savedValues.current = current;
      if (cover) {
        try {
          const prepared = await preparePhoto(cover);
          await upload.mutateAsync({
            slug: saved_.slug,
            form: await photoForm(prepared),
            idempotencyKey: coverKey.current,
          });
          releasePicked(cover);
          setCover(null);
        } catch {
          toast(t('editor.coverFailed'), { testID: `${ROUTE}.coverToast` });
        }
      }
      if (send && (saved_.status === 'draft' || saved_.status === 'rejected')) {
        const sent = await submit.mutateAsync(saved_.slug);
        finish(sent.slug, sent.status === 'pending_review' ? t('editor.sentReview') : t('editor.published'));
        return;
      }
      if (isNew) finish(saved_.slug, t('editor.created'));
      else
        finish(
          saved_.slug,
          before === 'published' && saved_.status === 'pending_review'
            ? t('editor.savedReview')
            : effects.notifies
              ? t('editor.savedNotified')
              : t('editor.saved'),
        );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const pickCover = async () => {
    const picked = await pickPhotos(1);
    const first = picked?.[0];
    if (!first) return;
    if (cover) releasePicked(cover);
    setCover(first);
    coverKey.current = newIdempotencyKey();
  };

  const preview = step === 'preview';
  const submitLabel = !editableDraft
    ? t('editor.saveChanges')
    : reviewFirst
      ? t('editor.submitReview')
      : t('editor.publish');
  const cta = preview
    ? {
        label: submitLabel,
        onPress: () => void persist(editableDraft),
        loading: busy,
        disabled: locked || !online,
      }
    : { label: t('editor.next'), onPress: () => void next(), disabled: false };
  const secondary =
    index > 0
      ? {
          label: t('editor.back'),
          onPress: () => goTo(STEPS[index - 1] ?? 'basics'),
          disabled: busy,
          testID: `${ROUTE}.back`,
        }
      : undefined;
  const changeHints = !isNew && event?.status === 'published';

  return (
    <EditorForm
      routeId={ROUTE}
      sheet
      dirty={(form.formState.isDirty || cover !== null) && !saved}
      onDiscard={() => (cover ? releasePicked(cover) : undefined)}
      revealTop={notice ?? step}
      cta={{ ...cta, secondary }}
    >
      <View style={styles.progress}>
        <Progress
          variant="wizard"
          step={index + 1}
          total={STEPS.length}
          label={t('editor.stepLabel', {
            step: index + 1,
            total: STEPS.length,
            name: t(`editor.steps.${step}`),
          })}
          testID={`${ROUTE}.progress`}
        />
        <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.step`}>
          {t('editor.stepLabel', { step: index + 1, total: STEPS.length, name: t(`editor.steps.${step}`) })}
        </Text>
      </View>
      {restriction ? <RestrictionLine message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      {step === 'basics' ? (
        <BasicsStep
          control={form.control}
          cover={cover}
          existingCover={event?.cover ?? null}
          onPickCover={() => void pickCover()}
          onRemoveCover={() => setCover(null)}
        />
      ) : null}
      {step === 'place' ? (
        <PlaceStep
          control={form.control}
          locationLocked={locationLocked}
          onPlace={(place) => {
            const options = { shouldDirty: true, shouldValidate: true } as const;
            form.setValue('venue', place.venue_name ?? form.getValues('venue'), options);
            form.setValue('street', place.street ?? '', options);
            form.setValue('postcode', place.postcode ?? '', options);
            form.setValue('city', place.city ?? '', options);
            form.setValue('lat', place.lat, options);
            form.setValue('lng', place.lng, options);
          }}
          onPin={(point) => {
            form.setValue('lat', Number(point.lat.toFixed(6)), { shouldDirty: true, shouldValidate: true });
            form.setValue('lng', Number(point.lng.toFixed(6)), { shouldDirty: true });
          }}
        />
      ) : null}
      {step === 'time' ? <TimeStep control={form.control} /> : null}
      {step === 'details' ? <DetailsStep control={form.control} isNew={isNew} /> : null}
      {preview ? (
        <PreviewStep
          values={values}
          cover={cover}
          event={event}
          reviewFirst={reviewFirst}
          changeHints={changeHints}
        />
      ) : null}
      {preview && editableDraft ? (
        <Button
          label={t('editor.saveDraft')}
          variant="tertiary"
          size="m"
          flush="start"
          disabled={busy || locked || !online}
          onPress={() => void persist(false)}
          style={styles.draft}
          testID={`${ROUTE}.saveDraft`}
        />
      ) : null}
    </EditorForm>
  );
}

type FieldProps = {
  control: Control<EventFormValues>;
  name:
    | 'title'
    | 'venue'
    | 'street'
    | 'postcode'
    | 'city'
    | 'startDate'
    | 'startTime'
    | 'endDate'
    | 'endTime'
    | 'description'
    | 'capacity'
    | 'organiserRules';
  label: string;
  placeholder?: string;
  helper?: string;
  numeric?: boolean;
  mask?: (text: string) => string;
  multiline?: number;
  disabled?: boolean;
  testID: string;
};

function Field({
  control,
  name,
  label,
  placeholder,
  helper,
  numeric = false,
  mask,
  multiline,
  disabled,
  testID,
}: FieldProps) {
  const { t } = useTranslation('events');
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={label}
          value={String(field.value ?? '')}
          onChangeText={(text) => field.onChange(mask ? mask(text) : text)}
          onBlur={field.onBlur}
          placeholder={placeholder}
          helper={helper}
          error={fieldText(t, fieldState.error)}
          keyboardType={numeric ? 'number-pad' : undefined}
          inputMode={numeric ? 'numeric' : undefined}
          multiline={multiline !== undefined}
          maxRows={multiline}
          disabled={disabled}
          testID={testID}
        />
      )}
    />
  );
}

function BasicsStep({
  control,
  cover,
  existingCover,
  onPickCover,
  onRemoveCover,
}: {
  control: Control<EventFormValues>;
  cover: PickedCover | null;
  existingCover: EventDetail['cover'];
  onPickCover: () => void;
  onRemoveCover: () => void;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const shown = cover
    ? { source: cover.uri }
    : existingCover
      ? { source: existingCover.variants.at(-1)?.url ?? null, blurhash: existingCover.blurhash }
      : null;
  return (
    <>
      <Field
        control={control}
        name="title"
        label={t('editor.titleLabel')}
        placeholder={t('editor.titlePlaceholder')}
        testID={`${ROUTE}.title`}
      />
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <FormGroup title={t('editor.typeLabel')}>
            <ChoiceChips<EventType>
              label={t('editor.typeLabel')}
              options={EVENT_TYPES.map((value) => ({ value, label: t(`type.${value}`) }))}
              value={field.value}
              onChange={(value) => (value ? field.onChange(value) : undefined)}
              testID={`${ROUTE}.type`}
            />
          </FormGroup>
        )}
      />
      <FormGroup title={t('editor.coverLabel')} testID={`${ROUTE}.cover`}>
        <View style={styles.cover}>
          {shown?.source ? (
            <Photo {...shown} aspect="16:9" corner="md" testID={`${ROUTE}.cover.photo`} />
          ) : null}
          <Text variant="caption" color="text.secondary">
            {t('editor.coverHelper')}
          </Text>
          <View style={styles.coverActions}>
            <Button
              label={shown?.source ? t('editor.coverChange') : t('editor.coverPick')}
              icon="image"
              variant="secondary"
              size="m"
              onPress={onPickCover}
              testID={`${ROUTE}.cover.pick`}
            />
            {cover ? (
              <Button
                label={t('editor.coverRemove')}
                variant="tertiary"
                size="m"
                onPress={onRemoveCover}
                testID={`${ROUTE}.cover.remove`}
              />
            ) : null}
          </View>
        </View>
      </FormGroup>
      <Controller
        control={control}
        name="visibility"
        render={({ field }) => (
          <FormGroup title={t('editor.visibilityLabel')}>
            <ChoiceChips<EventVisibility>
              label={t('editor.visibilityLabel')}
              options={(['public', 'followers', 'unlisted'] as const).map((value) => ({
                value,
                label: t(`editor.visibility.${value}`),
              }))}
              value={field.value}
              onChange={(value) => (value ? field.onChange(value) : undefined)}
              testID={`${ROUTE}.visibility`}
            />
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.visibilityHelper`}>
              {t(`editor.visibilityHelper.${field.value}`)}
            </Text>
          </FormGroup>
        )}
      />
    </>
  );
}

function PlaceStep({
  control,
  locationLocked,
  onPlace,
  onPin,
}: {
  control: Control<EventFormValues>;
  locationLocked: boolean;
  onPlace: (place: GeocodeResult) => void;
  onPin: (point: { lat: number; lng: number }) => void;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const geocode = useGeocode();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const lat = useWatch({ control, name: 'lat' });
  const lng = useWatch({ control, name: 'lng' });
  const picked = lat !== null && lng !== null ? { lat, lng } : null;
  const search = () => {
    const q = query.trim();
    if (q.length < 3) return;
    setChosen(null);
    geocode.mutate(q);
  };
  const down = geocode.error instanceof ApiError && geocode.error.code === GEOCODE_UNAVAILABLE;
  return (
    <>
      <View style={styles.search}>
        <TextInput
          label={t('editor.placeSearchLabel')}
          placeholder={t('editor.placeSearchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          returnKeyType="search"
          autoCorrect={false}
          containerStyle={styles.grow}
          testID={`${ROUTE}.placeQuery`}
        />
        <Button
          label={t('editor.placeSearch')}
          variant="secondary"
          size="l"
          loading={geocode.isPending}
          onPress={search}
          testID={`${ROUTE}.placeSearch`}
        />
      </View>
      {geocode.data && geocode.data.length > 0 ? (
        <FormGroup title={t('editor.placeResults')}>
          <View style={styles.results}>
            {geocode.data.map((place, row) => (
              <ListRow
                key={`${place.lat},${place.lng},${row}`}
                icon="map-pin"
                title={place.venue_name ?? place.street ?? place.city ?? place.label}
                subtitle={place.label}
                role="button"
                chevron={false}
                selected={chosen === row}
                onPress={() => {
                  haptics.selection();
                  setChosen(row);
                  onPlace(place);
                }}
                divider={row < (geocode.data?.length ?? 0) - 1}
                testID={`${ROUTE}.place.${row}`}
              />
            ))}
          </View>
          <Text variant="caption" color="text.tertiary">
            {t('editor.placeAttribution')}
          </Text>
        </FormGroup>
      ) : null}
      {geocode.data && geocode.data.length === 0 ? (
        <FormNotice message={t('editor.placeNoResults')} tone="info" testID={`${ROUTE}.placeEmpty`} />
      ) : null}
      {geocode.isError ? (
        <FormNotice
          message={
            down
              ? t('editor.placeDown')
              : geocode.error instanceof ApiError
                ? geocode.error.message
                : t('editor.placeDown')
          }
          tone="info"
          testID={`${ROUTE}.placeError`}
        />
      ) : null}
      <Controller
        control={control}
        name="lat"
        render={({ fieldState }) => (
          <FormGroup testID={`${ROUTE}.pin`}>
            <EventMap
              mode="picker"
              height={PICKER_HEIGHT}
              center={picked}
              zoom={CITY_ZOOM + 3}
              picked={picked}
              label={t('map.pickerLabel')}
              onPick={onPin}
              corner="md"
              testID={`${ROUTE}.map`}
            />
            <Text
              variant="caption"
              color={fieldState.error ? 'accent.fg' : 'text.secondary'}
              role={fieldState.error ? 'alert' : undefined}
              testID={`${ROUTE}.pinHelper`}
            >
              {fieldState.error
                ? fieldText(t, fieldState.error)
                : picked
                  ? t('editor.pinSet')
                  : t('editor.pinHelper')}
            </Text>
          </FormGroup>
        )}
      />
      <Field
        control={control}
        name="venue"
        label={t('editor.venueLabel')}
        placeholder={t('editor.venuePlaceholder')}
        testID={`${ROUTE}.venue`}
      />
      <Field control={control} name="street" label={t('editor.streetLabel')} testID={`${ROUTE}.street`} />
      <FieldPair>
        <Field
          control={control}
          name="postcode"
          label={t('editor.postcodeLabel')}
          numeric
          testID={`${ROUTE}.postcode`}
        />
        <Field control={control} name="city" label={t('editor.cityLabel')} testID={`${ROUTE}.city`} />
      </FieldPair>
      <Controller
        control={control}
        name="locationVisibility"
        render={({ field }) => (
          <FormGroup title={t('editor.locationVisibilityLabel')} testID={`${ROUTE}.locationVisibility`}>
            <SegmentedControl<EventLocationVisibility>
              options={[
                {
                  value: 'public',
                  label: t('editor.locationVisibility.public'),
                  testID: `${ROUTE}.locationVisibility.public`,
                },
                {
                  value: 'after_rsvp',
                  label: t('editor.locationVisibility.after_rsvp'),
                  testID: `${ROUTE}.locationVisibility.after_rsvp`,
                },
              ]}
              value={field.value}
              onChange={(value) => {
                haptics.selection();
                field.onChange(value);
              }}
              label={t('editor.locationVisibilityLabel')}
              role="radiogroup"
              disabled={locationLocked}
            />
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.locationVisibilityHelper`}>
              {locationLocked
                ? t('editor.locationVisibilityLocked')
                : t(`editor.locationVisibilityHelper.${field.value}`)}
            </Text>
          </FormGroup>
        )}
      />
    </>
  );
}

function TimeStep({ control }: { control: Control<EventFormValues> }) {
  const { t } = useTranslation('events');
  return (
    <>
      <FieldPair>
        <Field
          control={control}
          name="startDate"
          label={t('editor.startDateLabel')}
          placeholder={t('editor.datePlaceholder')}
          numeric
          mask={maskDate}
          testID={`${ROUTE}.startDate`}
        />
        <Field
          control={control}
          name="startTime"
          label={t('editor.startTimeLabel')}
          placeholder={t('editor.timePlaceholder')}
          numeric
          mask={maskTime}
          testID={`${ROUTE}.startTime`}
        />
      </FieldPair>
      <FieldPair>
        <Field
          control={control}
          name="endDate"
          label={t('editor.endDateLabel')}
          placeholder={t('editor.datePlaceholder')}
          helper={t('editor.endDateHelper')}
          numeric
          mask={maskDate}
          testID={`${ROUTE}.endDate`}
        />
        <Field
          control={control}
          name="endTime"
          label={t('editor.endTimeLabel')}
          placeholder={t('editor.timePlaceholder')}
          numeric
          mask={maskTime}
          testID={`${ROUTE}.endTime`}
        />
      </FieldPair>
      <Text variant="caption" color="text.secondary" testID={`${ROUTE}.zone`}>
        {t('time.zone')}
      </Text>
    </>
  );
}

function DetailsStep({ control, isNew }: { control: Control<EventFormValues>; isNew: boolean }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  return (
    <>
      <Field
        control={control}
        name="description"
        label={t('editor.descriptionLabel')}
        placeholder={t('editor.descriptionPlaceholder')}
        multiline={DESCRIPTION_ROWS}
        testID={`${ROUTE}.description`}
      />
      <Field
        control={control}
        name="capacity"
        label={t('editor.capacityLabel')}
        helper={t('editor.capacityHelper')}
        numeric
        testID={`${ROUTE}.capacity`}
      />
      <Controller
        control={control}
        name="rules"
        render={({ field, fieldState }) => (
          <FormGroup title={t('editor.rulesTitle')} testID={`${ROUTE}.rules`}>
            <Text variant="caption" color="text.secondary">
              {t('editor.rulesHelper')}
            </Text>
            <View style={styles.rules} role="group" aria-label={t('editor.rulesTitle')}>
              {EVENT_RULES.map((rule: EventRule) => (
                <Checkbox
                  key={rule}
                  checked={field.value.includes(rule)}
                  onChange={(checked) =>
                    field.onChange(
                      checked
                        ? EVENT_RULES.filter((entry) => entry === rule || field.value.includes(entry))
                        : field.value.filter((entry) => entry !== rule),
                    )
                  }
                  label={t(`editor.rule.${rule}`)}
                  showLabel
                  alignFirstLine
                  error={rule === 'legal_only' && Boolean(fieldState.error)}
                  testID={`${ROUTE}.rule.${rule}`}
                />
              ))}
            </View>
            {fieldState.error ? (
              <Text variant="caption" color="accent.fg" role="alert" testID={`${ROUTE}.rules.error`}>
                {fieldText(t, fieldState.error)}
              </Text>
            ) : null}
          </FormGroup>
        )}
      />
      <Field
        control={control}
        name="organiserRules"
        label={t('editor.organiserRulesLabel')}
        placeholder={t('editor.organiserRulesPlaceholder')}
        multiline={RULES_ROWS}
        testID={`${ROUTE}.organiserRules`}
      />
      {isNew ? (
        <Controller
          control={control}
          name="acceptRules"
          render={({ field, fieldState }) => (
            <View>
              <Checkbox
                checked={field.value}
                onChange={field.onChange}
                label={t('editor.acceptRules')}
                showLabel
                alignFirstLine
                error={Boolean(fieldState.error)}
                testID={`${ROUTE}.acceptRules`}
              />
              {fieldState.error ? (
                <Text variant="caption" color="accent.fg" role="alert" testID={`${ROUTE}.acceptRules.error`}>
                  {fieldText(t, fieldState.error)}
                </Text>
              ) : null}
            </View>
          )}
        />
      ) : null}
    </>
  );
}

function PreviewStep({
  values,
  cover,
  event,
  reviewFirst,
  changeHints,
}: {
  values: EventFormValues;
  cover: PickedCover | null;
  event: EventDetail | null;
  reviewFirst: boolean;
  changeHints: boolean;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const start = instantOf(values.startDate, values.startTime);
  const end = endInstant(values);
  const card: EventCard = {
    id: event?.id ?? 'preview',
    slug: event?.slug ?? 'preview',
    title: values.title.trim() || t('editor.titlePlaceholder'),
    type: values.type,
    status: event?.status ?? 'draft',
    visibility: values.visibility,
    starts_at: start?.toISOString() ?? null,
    ends_at: end?.toISOString() ?? null,
    timezone: ZONE,
    location: {
      visibility: values.locationVisibility,
      exact: true,
      venue_name: values.venue || null,
      street: values.street || null,
      postcode: values.postcode || null,
      city: values.city || null,
      country: 'DE',
      lat: values.lat,
      lng: values.lng,
      area: { lat: null, lng: null },
    },
    cover: cover ? null : (event?.cover ?? null),
    organiser: event?.organiser ?? {
      username: '',
      display_name: null,
      city: null,
      avatar: null,
      is_sample: false,
      is_editorial: false,
      main_vehicle_cover: null,
      verified: false,
    },
    counts: event?.counts ?? null,
    capacity: null,
    spots_left: null,
    distance_km: null,
    attendee_preview: [],
    my_rsvp: null,
    is_sample: false,
  };
  return (
    <View style={styles.preview} testID={`${ROUTE}.preview`}>
      <Text variant="title2" role="heading" aria-level={2}>
        {t('editor.previewTitle')}
      </Text>
      <EventCardView event={card} routeId={ROUTE} inert withCover={Boolean(card.cover)} />
      {cover ? (
        <Photo source={cover.uri} aspect="16:9" corner="md" testID={`${ROUTE}.preview.cover`} />
      ) : null}
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text variant="caption" color="text.secondary">
            {t('editor.summaryWhere')}
          </Text>
          <Text variant="body">
            {[values.venue, values.street, [values.postcode, values.city].filter(Boolean).join(' ')]
              .filter((part) => part.trim() !== '')
              .join(', ')}
          </Text>
          <Text variant="caption" color="text.secondary">
            {t(`editor.locationVisibilityHelper.${values.locationVisibility}`)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text variant="caption" color="text.secondary">
            {t('editor.summaryVisibility')}
          </Text>
          <Text variant="body">{t(`editor.visibility.${values.visibility}`)}</Text>
        </View>
      </View>
      {changeHints ? (
        <>
          <FormNotice message={t('editor.changeNotice')} tone="info" testID={`${ROUTE}.changeNotice`} />
          <FormNotice message={t('editor.reviewAgainNotice')} tone="info" testID={`${ROUTE}.reviewAgain`} />
        </>
      ) : (
        <FormNotice
          message={reviewFirst ? t('editor.previewReview') : t('editor.previewPublish')}
          tone="info"
          testID={`${ROUTE}.reviewInfo`}
        />
      )}
    </View>
  );
}
