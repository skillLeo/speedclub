import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useBrands, useModCategories, type ModCategory } from '@/api/queries/catalog';
import type { GarageVehicle } from '@/api/queries/garage';
import { useCreateMod, useDeleteMod, useDeleteModPhoto, useOwnerMod, useUpdateMod, type ModPayload, type OwnerMod } from '@/api/queries/mods';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { paramOf } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { keepFiguresTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import type { PickedPhoto, UploadItem } from '@/state/uploads';
import { createStyles } from '@/theme';
import { Button, Dialog, Text, TextInput, toast } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { ValueText } from '@/ui/ValueText';
import { ModAssist } from '@/features/ai/ModAssist';

import { FittingSegmented, FormGroup, PickerField, SwitchRow, useCharCount } from '../components/fields';
import { OptionSheet } from '../components/OptionSheet';
import { CentredState, EditorForm, EditorLoading, EditorScreen, GoneState, LoadErrorState, RestrictedNotice, HEADER_TEXT_ACTION } from '../components/frames';
import { ModFieldRow } from '../components/ModFieldInputs';
import { PhotoGrid } from '../components/PhotoGrid';
import { DeletePhotoDialog, UploadSheet } from '../components/PhotoSheets';
import { useCreateOnce } from '../createOnce';
import { isGone, saveErrorMessage } from '../errors';
import { LEGAL_STATUS_FLAG, LEGAL_STATUSES, type LegalStatus } from '../legalStatus';
import { automaticTitle, formFields, maskMonth, storedText, MOD_STATUSES, modLayout, modPayload, modValuesFrom, NOTES_MAX_LENGTH, PART_NUMBER_MAX_LENGTH, previewLine, renderedFieldKeys, TITLE_MAX_LENGTH, WHEELS, type LayoutRow, type ModFormValues } from '../modForm';
import { MOD_PHOTO_LIMIT, pickPhotos } from '../photos';
import { currentMonth, fieldMessage, modSchema } from '../schemas';
import { uploadQueue, usePhotoUploads } from '../uploads';
import { useOwnVehicle, useSessionHeld } from '../useOwnVehicle';

const ROUTE = 'GAR-10';
const NOTES_ROWS = 5;
const NEW = 'new';

const useStyles = createStyles((t) => ({
  preview: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[4], padding: t.space[16] },
  danger: { alignItems: 'flex-start', marginTop: t.space[8] },
}));

/** GAR-10 /garage/[id]/mods/[modId] (new?category=): FS-6 for Räder & Reifen, the category's schema for every other. */
export function ModEditorScreen() {
  const { t } = useTranslation('garage');
  const params = useLocalSearchParams<{ id: string; modId: string; category?: string }>();
  const own = useOwnVehicle(ROUTE, { path: 'mods', skeleton: [1, 4, 3] });
  const modId = paramOf(params.modId) ?? NEW;
  const isNew = modId === NEW;
  const categories = useModCategories();
  const mod = useOwnerMod(isNew ? undefined : modId);
  const categoryKey = isNew ? paramOf(params.category) : mod.data?.category.key;
  const category = categories.data?.find((entry) => entry.key === categoryKey);
  const fallback = own.id ? `/garage/${own.id}/mods` : '/garage';

  let body = own.state;
  if (!body && !isNew && mod.error && isGone(mod.error)) {
    body = (
      <CentredState>
        <GoneState routeId={ROUTE} title={t('mods.goneTitle')} body={t('mods.goneBody')} />
      </CentredState>
    );
  } else if (!body && ((!isNew && !mod.data && mod.isError) || (!categories.data && categories.isError))) {
    body = (
      <CentredState>
        <LoadErrorState
          routeId={ROUTE}
          offline={false}
          onRetry={() => {
            void mod.refetch();
            void categories.refetch();
          }}
          retrying={mod.isFetching || categories.isFetching}
        />
      </CentredState>
    );
  } else if (!body && categories.data && categoryKey && !category) {
    body = (
      <CentredState>
        <GoneState routeId={ROUTE} title={t('mods.unknownCategoryTitle')} body={t('mods.unknownCategoryBody')} />
      </CentredState>
    );
  }
  if (!body && own.vehicle && category && (isNew || mod.data)) {
    return <ModForm key={mod.data?.id ?? NEW} vehicle={own.vehicle} category={category} mod={mod.data} restriction={own.restriction} fallback={fallback} />;
  }
  return (
    <EditorScreen routeId={ROUTE} title={category?.name ?? t('mods.editorTitle')} fallback={fallback} offlineLabel={t('offline.editor')}>
      {body ?? <EditorLoading routeId={ROUTE} groups={[1, 4, 3]} />}
    </EditorScreen>
  );
}

type ModFormProps = { vehicle: GarageVehicle; category: ModCategory; mod: OwnerMod | undefined; restriction: string | null; fallback: string };

/** The form renders its own frame: FS-6's header "Speichern" belongs to it. */
function ModForm({ vehicle, category, mod, restriction, fallback }: ModFormProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const format = useFormat();
  const charCount = useCharCount();
  const brands = useBrands(category.key);
  const fields = useMemo(() => formFields(category.fields ?? [], mod), [category.fields, mod]);
  const create = useCreateMod(vehicle);
  const createOnce = useCreateOnce((payload: ModPayload & { category: string }, idempotencyKey: string) => create.mutateAsync({ payload, idempotencyKey }));
  // A new mod that exists on the server while the form is still open: its replay landed and the change on top of it failed.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const update = useUpdateMod(vehicle);
  const remove = useDeleteMod(vehicle);
  const removePhoto = useDeleteModPhoto(vehicle, mod?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [picks, setPicks] = useState<PickedPhoto[]>([]);
  const [upload, setUpload] = useState<UploadItem | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<OwnerMod['photos'][number] | null>(null);
  const [legalSheet, setLegalSheet] = useState(false);
  const legalEnabled = useFlag(LEGAL_STATUS_FLAG);
  const month = currentMonth(now());
  const schema = useMemo(() => modSchema(fields, format.locale, month), [fields, format.locale, month]);
  // Fresh data reaches the fields the member has not touched: PATCH sends `fields`, notes and cost whole (BH-10).
  const fresh = useMemo(() => modValuesFrom(mod, fields, format.locale), [fields, format.locale, mod]);
  const { control, handleSubmit, setError, setFocus, setValue, formState } = useForm<ModFormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: fresh,
    values: fresh,
    // keepDirty: without it the reset calls the form clean for a moment, and a tap on Speichern in that moment does nothing.
    resetOptions: { keepDirtyValues: true, keepDirty: true },
  });
  const { isDirty, dirtyFields } = formState;
  // Only what shapes the form is watched here. A keystroke re-renders its own field and the line that shows it, not the
  // whole form (FS-6 types on low-end phones too).
  const staggered = useWatch({ control, name: 'fields.staggered' }) === true;
  const status = useWatch({ control, name: 'status' });
  const layout = modLayout(category.key, fields, staggered);
  const locked = restriction !== null;
  // Behind a session that ended (BH-30) the fields keep the member's text in its own colour: nothing saves, nothing is lost.
  const held = useSessionHeld();
  const fieldsLocked = locked && !held;
  // GAR-10.group.more: a field this layout does not draw (part number and title on Räder & Reifen, the title of Sonstiges) once
  // it held a save back. It stays in view, with its error, until the form goes, and the first one takes the focus.
  const [reveal, setReveal] = useState<{ fields: readonly HiddenField[]; focus: HiddenField | null }>({ fields: [], focus: null });
  const revealed = reveal.fields;
  // A notice that is not about a field the member can see right there: the form scrolls up to it.
  const [topNotice, setTopNotice] = useState(false);
  const pending = create.isPending || update.isPending;
  const photos = mod?.photos ?? [];
  // ADR-181 revisit: a mod photo that failed on the server shows like on GAR-07, with delete as its only action.
  const failedPhotos = mod?.failed_photos ?? [];
  const target = mod ? { kind: 'mod' as const, vehicleId: vehicle.id, modId: mod.id } : null;
  const uploads = usePhotoUploads(target, photos, MOD_PHOTO_LIMIT);
  const localItems: UploadItem[] = picks.map((source, index) => ({
    id: `local.${index}.${source.uri}`,
    target: { kind: 'vehicle', vehicleId: vehicle.id },
    source,
    preparedUri: null,
    status: 'queued',
    progress: 0,
    error: t('mods.photoAfterSave'),
    retryable: false,
    attempts: 0,
    idempotencyKey: '',
    mediaId: null,
    createdAt: 0,
  }));
  const shownUploads = mod ? uploads.uploads : localItems;
  const remaining = mod ? uploads.remaining : Math.max(0, MOD_PHOTO_LIMIT - picks.length);
  const isWheels = category.key === WHEELS;
  const isOther = fields.some((field) => field.key === 'title');

  useEffect(() => {
    if (!done) return;
    if (router.canGoBack()) router.back();
    else router.replace(`/garage/${vehicle.id}/mods`);
  }, [done, router, vehicle.id]);

  const fieldMap = useMemo(
    () => ({
      ...Object.fromEntries(fields.map((field) => [`fields.${field.key}`, `fields.${field.key}` as const])),
      installed_on: 'installedOn',
      cost_cents: 'cost',
      cost_public: 'costPublic',
      legal_status: 'legalStatus',
      notes: 'notes',
      title: 'title',
      part_number: 'partNumber',
      status: 'status',
    }) as Record<string, 'installedOn' | 'cost' | 'costPublic' | 'legalStatus' | 'notes' | 'title' | 'partNumber' | 'status' | `fields.${string}`>,
    [fields],
  );

  useEffect(() => {
    // After the render that drew it: focusing scrolls the field into view, on web and above the keyboard on native.
    if (reveal.focus) setFocus(reveal.focus);
  }, [reveal, setFocus]);

  /**
   * A save held back by fields the layout does not draw: they join GAR-10.group.more with their errors, and when nothing on
   * screen is invalid, the first takes the focus. The notice names it and says where to fix it.
   */
  const revealHidden = (errors: FieldErrors<ModFormValues>): string | null => {
    const rendered = renderedFieldKeys(layout);
    const hidden: HiddenField[] = Object.keys(errors.fields ?? {})
      .filter((key) => !rendered.has(key))
      .map((key) => `fields.${key}` as const);
    if (errors.partNumber && isWheels) hidden.push('partNumber');
    if (errors.title && (isWheels || isOther)) hidden.push('title');
    const first = hidden[0];
    if (!first) return null;
    const failing = Object.keys(errors).flatMap((key) => (key === 'fields' ? Object.keys(errors.fields ?? {}).map((name) => `fields.${name}`) : [key]));
    // A field already in view is focused by the form itself; a new one once it is drawn.
    const fresh = hidden.filter((key) => !revealed.includes(key));
    if (fresh.length > 0) {
      const focus = failing.every((key) => hidden.includes(key as HiddenField)) ? first : null;
      setReveal((current) => ({ fields: [...current.fields, ...fresh], focus }));
    }
    return t('mods.hiddenInvalid', { field: hiddenLabel(first) });
  };

  const hiddenLabel = (key: HiddenField): string => {
    if (key === 'partNumber') return t('mods.partNumber');
    if (key === 'title') return t('mods.titleField');
    const name = key.slice('fields.'.length);
    return fields.find((entry) => entry.key === name)?.label ?? name;
  };

  const addPhotos = async () => {
    if (mod) {
      await uploads.add();
      return;
    }
    try {
      const picked = await pickPhotos(remaining);
      if (picked) setPicks((current) => [...current, ...picked].slice(0, MOD_PHOTO_LIMIT));
    } catch {
      toast(t('upload.pickFailed'));
    }
  };

  /** A new mod. A lost first answer is replayed, and what changed since goes on top of what it stored (createOnce). */
  const saveNew = async (form: ModFormValues, payload: ModPayload, onCreated: () => void) => {
    let modId = createdId;
    let stale = modId !== null;
    if (modId === null) {
      const first = await createOnce({ ...payload, category: category.key });
      modId = first.result.id;
      stale = first.stale;
      setCreatedId(modId);
      onCreated();
      if (picks.length > 0) uploadQueue().store.getState().enqueue({ kind: 'mod', vehicleId: vehicle.id, modId }, picks);
    }
    if (stale) {
      // The stored title may be the lost attempt's: on top of it the form's says what stays, empty meaning automatic.
      await update.mutateAsync({ modId, payload: modPayload(form, fields, format.locale, { titleTouched: true, staggered: form.fields.staggered === true, legalStatus: legalEnabled }) });
    }
  };

  const submit = handleSubmit(
    async (form) => {
      setNotice(null);
      const payload = modPayload(form, fields, format.locale, { titleTouched: Boolean(dirtyFields.title), staggered: form.fields.staggered === true, legalStatus: legalEnabled });
      let creating = !mod && createdId === null;
      try {
        if (mod) {
          const answer = await update.mutateAsync({ modId: mod.id, payload });
          toast(answer.history_recorded ? t('mods.savedWithHistory') : t('mods.saved'), { haptic: 'success', testID: `${ROUTE}.saved` });
        } else {
          await saveNew(form, payload, () => {
            creating = false;
          });
          toast(vehicle.status === 'published' ? t('mods.savedWithHistory') : t('mods.saved'), { haptic: 'success', testID: `${ROUTE}.saved` });
        }
        setDone(true);
      } catch (error) {
        const message = applyServerErrors(error, setError, fieldMap) === null ? null : saveErrorMessage(t, error, { creating });
        setNotice(message);
        setTopNotice(message !== null);
      }
    },
    (errors: FieldErrors<ModFormValues>) => {
      setNotice(revealHidden(errors));
      setTopNotice(false);
    },
  );

  const confirmDelete = () => {
    if (!mod) return;
    remove.mutate(mod.id, {
      onSuccess: () => {
        setConfirming(false);
        toast(t('mods.deleted'), { testID: `${ROUTE}.deleted` });
        setDone(true);
      },
      onError: (error) => {
        setConfirming(false);
        setNotice(saveErrorMessage(t, error));
        setTopNotice(true);
      },
    });
  };

  const saveAction = (
    <Button
      label={t('editor.save')}
      variant="tertiary"
      size="s"
      style={HEADER_TEXT_ACTION}
      loading={pending}
      disabled={locked || !online || (!isDirty && Boolean(mod))}
      onPress={() => void submit()}
      testID={`${ROUTE}.headerSave`}
    />
  );

  return (
    <EditorScreen routeId={ROUTE} title={category.name} fallback={fallback} trailing={saveAction} offlineLabel={t('offline.editor')}>
    <EditorForm
      routeId={ROUTE}
      dirty={(isDirty || picks.length > 0) && !pending && !done}
      cta={{ label: t('editor.save'), onPress: () => void submit(), loading: pending, disabled: locked || !online || (!isDirty && Boolean(mod)) }}
      revealTop={restriction ?? (topNotice ? notice : null)}
      revealEnd={reveal.focus ? reveal : null}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      <ModPreview control={control} categoryKey={category.key} fields={fields} />
      {/* M3.7 "Aus Text übernehmen": each suggested value goes into its field on its own; the member saves as always. */}
      <ModAssist
        categoryKey={category.key}
        fields={fields}
        locale={format.locale}
        disabled={fieldsLocked}
        onAccept={(field, value) =>
          setValue(`fields.${field.key}`, storedText(value, format.locale) ?? '', { shouldDirty: true, shouldValidate: true })
        }
        testID={`${ROUTE}.ai`}
      />
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          // DQ-155: a radio list once "Entfernt" no longer fits its third of the track.
          <FittingSegmented
            label={t('mods.status')}
            options={[
              { value: MOD_STATUSES[0], label: t('mods.statuses.installed') },
              { value: MOD_STATUSES[1], label: t('mods.statuses.planned') },
              { value: MOD_STATUSES[2], label: t('mods.statuses.removed') },
            ]}
            value={field.value}
            onChange={field.onChange}
            disabled={fieldsLocked}
            testID={`${ROUTE}.status`}
          />
        )}
      />
      {layout.map((group) => (
        <FormGroup key={group.key} title={t(`mods.groups.${group.key}`)} testID={`${ROUTE}.group.${group.key}`}>
          {group.rows.map((row) => (
            <ModFieldRow
              key={row.kind === 'pair' ? row.fields[0].key : row.field.key}
              row={row}
              control={control}
              brands={brands.data ?? []}
              disabled={fieldsLocked}
              routeId={ROUTE}
            />
          ))}
          {!isWheels && group.key === 'details' ? (
            <>
              <PartNumberField control={control} disabled={fieldsLocked} />
              {isOther ? null : <TitleField control={control} disabled={fieldsLocked} />}
            </>
          ) : null}
        </FormGroup>
      ))}
      <FormGroup title={t('mods.groups.install')} testID={`${ROUTE}.group.install`}>
        {status === 'planned' ? null : (
          <Controller
            control={control}
            name="installedOn"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                label={t('mods.installedOn')}
                value={field.value}
                onChangeText={(text) => field.onChange(maskMonth(text))}
                onBlur={field.onBlur}
                placeholder={t('mods.installedOnPlaceholder')}
                error={fieldMessage(t, fieldState.error)}
                disabled={fieldsLocked}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={7}
                testID={`${ROUTE}.installedOn`}
              />
            )}
          />
        )}
        <Controller
          control={control}
          name="cost"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('mods.cost')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('mods.costPlaceholder')}
              suffix="€"
              error={fieldMessage(t, fieldState.error)}
              disabled={fieldsLocked}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={12}
              testID={`${ROUTE}.cost`}
            />
          )}
        />
        <Controller
          control={control}
          name="costPublic"
          render={({ field }) => (
            <SwitchRow label={t('mods.costPublic')} helper={t('mods.costPublicHelper')} value={field.value} onChange={field.onChange} disabled={fieldsLocked} testID={`${ROUTE}.costPublic`} />
          )}
        />
        {legalEnabled ? (
          <Controller
            control={control}
            name="legalStatus"
            render={({ field, fieldState }) => (
              <>
                {/* FS-6 [SIG]: the owner's statement, so the 08_LEGAL §7 disclaimer is its helper. */}
                <PickerField
                  label={t('mods.legalStatus')}
                  value={field.value ? t(`mods.legalStatuses.${field.value}`) : null}
                  placeholder={t('specs.choose')}
                  onPress={() => setLegalSheet(true)}
                  helper={t('mods.legalStatusHelper')}
                  error={fieldMessage(t, fieldState.error)}
                  disabled={fieldsLocked}
                  testID={`${ROUTE}.legalStatus`}
                />
                <OptionSheet
                  visible={legalSheet}
                  onClose={() => setLegalSheet(false)}
                  title={t('mods.legalStatus')}
                  options={LEGAL_STATUSES.map((value) => ({ value, label: t(`mods.legalStatuses.${value}`), detail: t(`mods.legalStatusDetails.${value}`) }))}
                  value={field.value || null}
                  onSelect={(option) => {
                    field.onChange(option.value as LegalStatus);
                    setLegalSheet(false);
                  }}
                  clearLabel={field.value ? t('specs.noAnswer') : undefined}
                  onClear={
                    field.value
                      ? () => {
                          field.onChange('');
                          setLegalSheet(false);
                        }
                      : undefined
                  }
                  testID={`${ROUTE}.legalStatusSheet`}
                />
              </>
            )}
          />
        ) : null}
      </FormGroup>
      <FormGroup title={t('mods.groups.photos')} testID={`${ROUTE}.group.photos`}>
        <PhotoGrid
          photos={photos}
          uploads={shownUploads}
          canAdd={remaining > 0}
          adding={uploads.picking}
          onAdd={() => void addPhotos()}
          onPressPhoto={(photo) => setPhotoToDelete(photo)}
          onPressUpload={setUpload}
          failed={failedPhotos}
          onPressFailed={(photo) => setPhotoToDelete(photo)}
          showCover={false}
          disabled={!online}
          addDisabled={locked}
          fallbackAlt={mod?.title ?? category.name}
          testID={`${ROUTE}.photos`}
        />
        <Text variant="helper" color="text.secondary">
          {mod ? t('mods.photoCount', { count: photos.length + shownUploads.length, max: MOD_PHOTO_LIMIT }) : t('mods.photoAfterSave')}
        </Text>
      </FormGroup>
      <FormGroup title={t('mods.groups.notes')} testID={`${ROUTE}.group.notes`}>
        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('mods.notes')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('mods.notesPlaceholder')}
              helper={`${t('mods.notesPrivate')} ${charCount(field.value.length, NOTES_MAX_LENGTH)}`}
              error={fieldMessage(t, fieldState.error)}
              disabled={fieldsLocked}
              multiline
              maxRows={NOTES_ROWS}
              maxLength={NOTES_MAX_LENGTH}
              testID={`${ROUTE}.notes`}
            />
          )}
        />
      </FormGroup>
      {revealed.length > 0 ? (
        <FormGroup title={t('mods.groups.more')} testID={`${ROUTE}.group.more`}>
          {revealed.map((key) => {
            if (key === 'partNumber') return <PartNumberField key={key} control={control} disabled={fieldsLocked} />;
            if (key === 'title') return <TitleField key={key} control={control} disabled={fieldsLocked} />;
            const field = fields.find((entry) => `fields.${entry.key}` === key);
            const row: LayoutRow | null = field ? (field.type === 'boolean' ? { kind: 'switch', field } : { kind: 'single', field }) : null;
            return row ? <ModFieldRow key={key} row={row} control={control} brands={brands.data ?? []} disabled={fieldsLocked} routeId={ROUTE} /> : null;
          })}
        </FormGroup>
      ) : null}
      {mod ? (
        <View style={styles.danger}>
          <Button label={t('mods.delete')} variant="destructive" size="m" icon="trash" flush="start" disabled={!online} onPress={() => setConfirming(true)} testID={`${ROUTE}.delete`} />
        </View>
      ) : null}
      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('mods.deleteTitle')}
        body={vehicle.status === 'published' ? t('mods.deleteBodyPublished') : t('mods.deleteBody')}
        testID={`${ROUTE}.deleteDialog`}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${ROUTE}.deleteDialog.cancel` },
          { label: t('mods.deleteConfirm'), destructive: true, loading: remove.isPending, onPress: confirmDelete, testID: `${ROUTE}.deleteDialog.confirm` },
        ]}
      />
      <DeletePhotoDialog
        photo={photoToDelete}
        onCancel={() => setPhotoToDelete(null)}
        onConfirm={(photo) =>
          removePhoto.mutate(photo.id, {
            onSuccess: () => setPhotoToDelete(null),
            onError: (error) => {
              setPhotoToDelete(null);
              toast(saveErrorMessage(t, error));
            },
          })
        }
        deleting={removePhoto.isPending}
        lastOfPublished={false}
        testID={`${ROUTE}.deletePhoto`}
      />
      <UploadSheet
        item={upload}
        onClose={() => setUpload(null)}
        onRetry={uploads.retry}
        onCancel={(id) => (id.startsWith('local.') ? setPicks((current) => current.filter((_, index) => !id.startsWith(`local.${index}.`))) : uploads.cancel(id))}
        testID={`${ROUTE}.uploadSheet`}
      />
    </EditorForm>
    </EditorScreen>
  );
}

type WatchProps = { control: Control<ModFormValues> };

/** A form field GAR-10's layout may leave out (GAR-10.group.more). */
type HiddenField = 'partNumber' | 'title' | `fields.${string}`;

function PartNumberField({ control, disabled }: WatchProps & { disabled: boolean }) {
  const { t } = useTranslation('garage');
  return (
    <Controller
      control={control}
      name="partNumber"
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={t('mods.partNumber')}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          helper={t('basics.optional')}
          error={fieldMessage(t, fieldState.error)}
          disabled={disabled}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={PART_NUMBER_MAX_LENGTH}
          testID={`${ROUTE}.partNumber`}
        />
      )}
    />
  );
}

/** FS-6's live line. It watches the fields itself, so typing re-renders the line and the field, not the form. */
function ModPreview({ control, categoryKey, fields }: WatchProps & { categoryKey: string; fields: readonly NonNullable<ModCategory['fields']>[number][] }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const largeFont = useStacksAtFontScale();
  const values = useWatch({ control, name: 'fields' });
  const preview = previewLine(categoryKey, fields, values ?? {}, format.locale);
  return (
    <View style={styles.preview} role="status" aria-label={preview ? `${t('mods.preview')}: ${preview}` : t('mods.previewEmpty')} testID={`${ROUTE}.preview`}>
      {preview ? (
        // DQ-167: "9,5J ET22" stays together and the words between the figures wrap, as on GAR-11 (a member's brand can be long).
        <ValueText variant="bodyStrong" hyphenate={false} values={keepFiguresTogether(preview, !largeFont)} wholeValues={false} testID={`${ROUTE}.preview.text`} />
      ) : (
        <Text variant="bodyStrong" color="text.tertiary" hyphenate={false} testID={`${ROUTE}.preview.text`}>
          {t('mods.previewEmpty')}
        </Text>
      )}
    </View>
  );
}

/** The title, whose placeholder is the automatic title from brand and model as they are typed. */
function TitleField({ control, disabled }: WatchProps & { disabled: boolean }) {
  const { t } = useTranslation('garage');
  const values = useWatch({ control, name: 'fields' });
  return (
    <Controller
      control={control}
      name="title"
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={t('mods.titleField')}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          placeholder={automaticTitle(values ?? {}) || t('mods.titlePlaceholder')}
          helper={t('mods.titleHelper')}
          error={fieldMessage(t, fieldState.error)}
          disabled={disabled}
          maxLength={TITLE_MAX_LENGTH}
          testID={`${ROUTE}.title`}
        />
      )}
    />
  );
}
