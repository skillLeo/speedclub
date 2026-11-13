import '@/features/parts/i18n';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  BUSINESS_CODES,
  BUSINESS_KINDS,
  BUSINESS_LIMITS,
  COUNTRIES,
  hasNoBusiness,
  LEGAL_FORMS,
  LEGAL_FORMS_WITHOUT_REGISTER,
  useBusinessesOn,
  useMyBusiness,
  useSaveBusiness,
  useSubmitBusiness,
  useUploadBusinessMedia,
  useWithdrawBusiness,
  type MyBusiness,
} from '@/api/queries/businesses';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { CentredState, EditorForm, EditorLoading, LoadErrorState } from '@/features/garage/components/frames';
import { ChoiceChips, FieldNote, FieldPair, FormGroup, PickerField, SwitchRow } from '@/features/garage/components/fields';
import { OptionSheet } from '@/features/garage/components/OptionSheet';
import { photoForm, pickPhotos, preparePhoto, releasePicked } from '@/features/garage/photos';
import type { PickedPhoto } from '@/state/uploads';
import { photoFields } from '@/features/profile/media';
import { useHideTabBar } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Header,
  OfflineBanner,
  Photo,
  Progress,
  Screen,
  StatusPill,
  Text,
  TextInput,
  toast,
} from '@/ui';


import { DAY_KEYS, dayLabel, type DayKey } from '../model';
import {
  applyBody,
  businessSchema,
  emptyValues,
  fieldText,
  isLockedField,
  maskTime,
  serverFieldMap,
  STEP_FIELDS,
  stepOf,
  STEPS,
  updateBody,
  valuesFrom,
  type BusinessFormValues,
  type Step,
} from '../schemas';

const ROUTE = 'BIZ-02';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const ABOUT_ROWS = 6;
const NOTE_ROWS = 4;

const useStyles = createStyles((t) => ({
  progress: { gap: t.space[8] },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  serviceAdd: { alignItems: 'stretch', flexDirection: 'row', gap: t.space[8] },
  addCell: { justifyContent: 'flex-end' },
  grow: { flex: 1 },
  day: { gap: t.space[8] },
  media: { gap: t.space[12] },
  mediaRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[16] },
  logo: { borderRadius: t.radius.md, height: t.size.avatar.lg, overflow: 'hidden', width: t.size.avatar.lg },
  placeholder: { backgroundColor: t.color.bg.raised },
  cover: { borderRadius: t.radius.md, overflow: 'hidden' },
  status: { gap: t.space[16] },
  statusActions: { alignItems: 'flex-start', gap: t.space[12] },
  locked: { marginTop: t.space[4] },
}));

/**
 * BIZ-02 Bewerbung `/settings/business/apply` (09 §7.11, §8.10): without a business the application wizard (Betrieb → Impressum →
 * Kontakt → Öffnungszeiten → Bilder & Abschluss); with one the status screen (In Prüfung · Abgelehnt with the staff's reason ·
 * Gesperrt), from which `?edit=1` opens the same form to change it. A verified business goes on to BIZ-03.
 */
export function BusinessApplyScreen() {
  const { t } = useTranslation('parts');
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string | string[] }>();
  const editing = paramOf(params.edit) === '1';
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useBusinessesOn();
  const requireAuth = useRequireAuth();
  const back = useBack(editing ? '/business' : '/settings');
  // §9: an editor pushed inside a tab hides the bar, so the sticky CTA sits at the bottom edge above the keyboard.
  useHideTabBar();
  const mine = useMyBusiness();
  const none = hasNoBusiness(mine.error);
  const business = qaState === 'empty' ? undefined : mine.data;
  // "Für Betriebe" of a verified business is its dashboard (09 §7.9: BIZ-02 apply / BIZ-03 dashboard).
  const verified = business?.status === 'verified' && !editing && qaState === 'default';
  useEffect(() => {
    if (verified) router.replace('/business');
  }, [router, verified]);

  let body: ReactNode;
  if (status === 'guest') {
    body = (
      <CentredState>
        <EmptyState
          icon="workshop"
          title={t('apply.guestTitle')}
          body={t('apply.guestBody')}
          action={{ label: t('apply.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/settings/business/apply' }) }}
          testID={`${ROUTE}.guest`}
        />
      </CentredState>
    );
  } else if (!flag && qaState === 'default') {
    body = (
      <CentredState>
        <EmptyState icon="workshop" title={t('off.businessesTitle')} body={t('off.businessesBody')} testID={`${ROUTE}.unavailable`} />
      </CentredState>
    );
  } else if (qaState === 'loading' || status === 'loading' || (!business && !none && mine.isPending && mine.fetchStatus !== 'paused')) {
    body = <EditorLoading routeId={ROUTE} groups={[2, 2, 1]} />;
  } else if (qaState === 'error' || (!business && !none && qaState !== 'empty')) {
    body = (
      <CentredState>
        <LoadErrorState routeId={ROUTE} offline={!online || mine.fetchStatus === 'paused'} onRetry={() => void mine.refetch()} retrying={mine.isFetching} />
      </CentredState>
    );
  } else if (business && !editing) {
    body = <StatusView business={business} onEdit={() => router.setParams({ edit: '1' })} />;
  } else {
    body = (
      <BusinessForm
        business={business ?? null}
        restricted={qaState === 'restricted'}
        onDone={(next) => {
          if (next.status === 'verified') router.replace('/business');
          else router.setParams({ edit: undefined });
        }}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={business && editing ? t('apply.editTitle') : t('apply.title')} onBack={back} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('apply.offline')} testID={`${ROUTE}.offline`} />}
      {body}
    </Screen>
  );
}

/** The application after it was sent: where it stands, the staff's reason when there is one, and what the member can do. */
function StatusView({ business, onEdit }: { business: MyBusiness; onEdit: () => void }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const withdraw = useWithdrawBusiness();
  const [confirming, setConfirming] = useState(false);
  const reason = typeof business.status_reason === 'string' && business.status_reason.trim() ? business.status_reason.trim() : null;
  const submitted = business.submitted_at ? format.date(new Date(business.submitted_at)) : null;
  const owner = business.viewer_role === 'owner';

  if (business.status === 'verified') {
    return (
      <CentredState>
        <EmptyState
          icon="workshop"
          title={t('apply.verifiedTitle', { name: business.name })}
          body={t('apply.verifiedBody')}
          action={{ label: t('apply.toDashboard'), onPress: () => router.replace('/business') }}
          testID={`${ROUTE}.verified`}
        />
      </CentredState>
    );
  }
  return (
    <CentredState>
      <View style={styles.status} testID={`${ROUTE}.status`}>
        <StatusPill label={t(`status.${business.status}`)} testID={`${ROUTE}.status.pill`} />
        <Text variant="title2" role="heading" aria-level={1}>
          {t(`apply.statusTitle.${business.status}`, { name: business.name })}
        </Text>
        <Text variant="body" color="text.secondary">
          {t(`apply.statusBody.${business.status}`)}
        </Text>
        {submitted && business.status === 'applied' ? (
          <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.submitted`}>
            {t('apply.submittedAt', { date: submitted })}
          </Text>
        ) : null}
        {reason ? <FormNotice message={t('apply.reason', { reason })} testID={`${ROUTE}.reason`} /> : null}
        {owner && business.status !== 'suspended' ? (
          <View style={styles.statusActions}>
            <Button
              label={business.status === 'rejected' ? t('apply.fixAndResend') : t('apply.change')}
              variant={business.status === 'rejected' ? 'primary' : 'secondary'}
              size="m"
              onPress={onEdit}
              testID={`${ROUTE}.edit`}
            />
            <Button label={t('apply.withdraw')} variant="destructive" size="m" flush="start" onPress={() => setConfirming(true)} testID={`${ROUTE}.withdraw`} />
          </View>
        ) : (
          <Button label={t('apply.toDashboard')} variant="secondary" size="m" onPress={() => router.replace('/business')} testID={`${ROUTE}.dashboard`} />
        )}
      </View>
      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('apply.withdrawTitle')}
        body={t('apply.withdrawBody')}
        testID={`${ROUTE}.withdrawDialog`}
        actions={[
          { label: t('actions.cancel'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${ROUTE}.withdrawDialog.cancel` },
          {
            label: t('apply.withdrawConfirm'),
            destructive: true,
            loading: withdraw.isPending,
            onPress: () =>
              withdraw.mutate(undefined, {
                onSuccess: () => {
                  setConfirming(false);
                  haptics.warning();
                  toast(t('apply.withdrawn'), { testID: `${ROUTE}.toast` });
                },
                onError: (error) => {
                  setConfirming(false);
                  toast(error instanceof ApiError ? error.message : t('apply.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
                },
              }),
            testID: `${ROUTE}.withdrawDialog.confirm`,
          },
        ]}
      />
    </CentredState>
  );
}

/** The server's reason for a refused save, in our words where we have them. */
function saveNotice(t: (key: string, options?: Record<string, unknown>) => string, error: unknown): string {
  if (!(error instanceof ApiError)) return t('apply.failed');
  if (error.code === BUSINESS_CODES.exists) return t('apply.exists');
  if (error.code === BUSINESS_CODES.emailNotVerified) return t('apply.emailNotVerified');
  if (error.kind === 'restricted') return error.message || t('apply.restricted');
  if (error.kind === 'rate_limited') return t('apply.tooMany');
  return error.message || t('apply.failed');
}

type PickedMedia = { logo: PickedPhoto | null; cover: PickedPhoto | null };

function BusinessForm({ business, restricted, onDone }: { business: MyBusiness | null; restricted: boolean; onDone: (business: MyBusiness) => void }) {
  const { t } = useTranslation('parts');
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const styles = useStyles();
  const online = useOnline();
  const creating = business === null;
  const locked = business?.identity_locked === true;
  const defaults = useMemo(() => (business ? valuesFrom(business) : emptyValues()), [business]);
  const form = useForm<BusinessFormValues>({ resolver: zodResolver(businessSchema(creating)) as never, mode: 'onTouched', defaultValues: defaults });
  const [step, setStep] = useState<Step>('business');
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<PickedMedia>({ logo: null, cover: null });
  const createKey = useRef(newIdempotencyKey());
  const mediaKeys = useRef({ logo: newIdempotencyKey(), cover: newIdempotencyKey() });
  const save = useSaveBusiness();
  const submit = useSubmitBusiness();
  const upload = useUploadBusinessMedia();
  const index = STEPS.indexOf(step);

  const goTo = (next: Step) => {
    setNotice(null);
    setStep(next);
  };
  const next = async () => {
    const ok = await form.trigger(STEP_FIELDS[step] as Path<BusinessFormValues>[], { shouldFocus: true });
    if (!ok) {
      haptics.warning();
      return;
    }
    haptics.selection();
    goTo(STEPS[index + 1] ?? 'finish');
  };

  const fail = (error: unknown) => {
    haptics.error();
    const fields = error instanceof ApiError ? serverFieldMap(error.fieldErrors) : {};
    const left = applyServerErrors(error, form.setError, fields);
    const first = Object.values(fields)[0];
    if (first) setStep(stepOf(first));
    setNotice(left === null ? null : saveNotice(translate, error));
  };

  const uploadMedia = async () => {
    for (const kind of ['logo', 'cover'] as const) {
      const picked = media[kind];
      if (!picked) continue;
      try {
        const prepared = await preparePhoto(picked);
        await upload.mutateAsync({ kind, form: await photoForm(prepared), idempotencyKey: mediaKeys.current[kind] });
        releasePicked(picked);
        setMedia((current) => ({ ...current, [kind]: null }));
      } catch {
        toast(t(`apply.${kind}Failed`), { testID: `${ROUTE}.mediaToast` });
      }
    }
  };

  const persist = async () => {
    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      haptics.warning();
      const firstError = Object.keys(form.formState.errors)[0];
      if (firstError) setStep(stepOf(firstError));
      return;
    }
    setNotice(null);
    setBusy(true);
    const values = form.getValues();
    try {
      let result: MyBusiness;
      if (creating) {
        result = await save.mutateAsync({ mode: 'apply', body: applyBody(values), idempotencyKey: createKey.current });
      } else {
        const body = updateBody(values, defaults, locked);
        result = Object.keys(body).length > 0 ? await save.mutateAsync({ mode: 'update', body }) : business;
      }
      await uploadMedia();
      if (!creating && result.status === 'rejected') result = await submit.mutateAsync();
      haptics.success();
      setSaved(true);
      toast(creating ? t('apply.sent') : result.status === 'applied' && business?.status === 'rejected' ? t('apply.resent') : t('apply.saved'), {
        testID: `${ROUTE}.toast`,
      });
      onDone(result);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (kind: 'logo' | 'cover') => {
    const picked = (await pickPhotos(1))?.[0];
    if (!picked) return;
    const before = media[kind];
    if (before) releasePicked(before);
    mediaKeys.current[kind] = newIdempotencyKey();
    setMedia((current) => ({ ...current, [kind]: picked }));
  };

  const last = step === 'finish';
  const ctaLabel = creating ? t('apply.send') : business?.status === 'rejected' ? t('apply.saveAndResend') : t('apply.saveChanges');
  const cta = last
    ? { label: ctaLabel, onPress: () => void persist(), loading: busy, disabled: restricted || !online }
    : { label: t('apply.next'), onPress: () => void next(), disabled: false };
  const secondary = index > 0 ? { label: t('apply.back'), onPress: () => goTo(STEPS[index - 1] ?? 'business'), disabled: busy, testID: `${ROUTE}.back` } : undefined;
  const stepLabel = t('apply.stepLabel', { step: index + 1, total: STEPS.length, name: t(`apply.steps.${step}`) });

  return (
    <EditorForm
      routeId={ROUTE}
      sheet
      dirty={(form.formState.isDirty || media.logo !== null || media.cover !== null) && !saved}
      onDiscard={() => {
        if (media.logo) releasePicked(media.logo);
        if (media.cover) releasePicked(media.cover);
      }}
      revealTop={notice ?? step}
      cta={{ ...cta, secondary }}
    >
      <View style={styles.progress}>
        <Progress variant="wizard" step={index + 1} total={STEPS.length} label={stepLabel} testID={`${ROUTE}.progress`} />
        <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.step`}>
          {stepLabel}
        </Text>
      </View>
      {restricted ? <FormNotice message={t('apply.restricted')} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      {locked ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.lockedNote`}>
          {t('apply.lockedNote')}
        </Text>
      ) : null}
      {step === 'business' ? <BusinessStep control={form.control} locked={locked} /> : null}
      {step === 'impressum' ? <ImpressumStep control={form.control} locked={locked} /> : null}
      {step === 'contact' ? <ContactStep control={form.control} locked={locked} /> : null}
      {step === 'hours' ? <HoursStep control={form.control} /> : null}
      {step === 'finish' ? (
        <FinishStep control={form.control} creating={creating} business={business} media={media} onPick={(kind) => void pick(kind)} />
      ) : null}
    </EditorForm>
  );
}

type StepProps = { control: Control<BusinessFormValues>; locked?: boolean };

/** A text field of the form: label, the server's or our message, the locked hint of a verified business. */
function Field({
  control,
  name,
  label,
  helper,
  locked = false,
  multiline,
  maxRows,
  maxLength,
  inputProps,
}: {
  control: Control<BusinessFormValues>;
  name: 'name' | 'about' | 'legalName' | 'representative' | 'registerCourt' | 'registerNumber' | 'vatId' | 'street' | 'postcode' | 'city' | 'email' | 'phone' | 'website' | 'documentNote';
  label: string;
  helper?: string;
  locked?: boolean;
  multiline?: boolean;
  maxRows?: number;
  maxLength?: number;
  inputProps?: Partial<Parameters<typeof TextInput>[0]>;
}) {
  const { t } = useTranslation('parts');
  const disabled = isLockedField(name, locked);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={label}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          helper={disabled ? t('apply.lockedField') : helper}
          error={fieldText(t, fieldState.error)}
          disabled={disabled}
          multiline={multiline}
          maxRows={maxRows}
          maxLength={maxLength}
          testID={`${ROUTE}.${name}`}
          {...inputProps}
        />
      )}
    />
  );
}

function BusinessStep({ control, locked = false }: StepProps) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const [service, setService] = useState('');
  return (
    <>
      <FormGroup title={t('apply.groups.profile')} testID={`${ROUTE}.group.profile`}>
        <Field control={control} name="name" label={t('apply.fields.name')} helper={t('apply.fields.nameHelper')} locked={locked} maxLength={120} />
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <ChoiceChips
              label={t('apply.fields.kind')}
              options={BUSINESS_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
              value={field.value}
              onChange={(next) => (next ? field.onChange(next) : undefined)}
              testID={`${ROUTE}.kind`}
            />
          )}
        />
      </FormGroup>
      <FormGroup title={t('apply.groups.services')} testID={`${ROUTE}.group.services`}>
        <Controller
          control={control}
          name="services"
          render={({ field, fieldState }) => {
            const add = () => {
              const value = service.trim();
              if (!value || field.value.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;
              field.onChange([...field.value, value]);
              setService('');
            };
            return (
              <>
                <View style={styles.serviceAdd}>
                  <View style={styles.grow}>
                    <TextInput
                      label={t('apply.fields.service')}
                      value={service}
                      onChangeText={setService}
                      onSubmitEditing={add}
                      placeholder={t('apply.fields.servicePlaceholder')}
                      maxLength={40}
                      returnKeyType="done"
                      testID={`${ROUTE}.service`}
                    />
                  </View>
                  {/* Its own column to the row's bottom edge: the button sits level with the field, under its label. */}
                  <View style={styles.addCell}>
                    <Button label={t('apply.fields.addService')} variant="secondary" size="m" disabled={!service.trim()} onPress={add} testID={`${ROUTE}.service.add`} />
                  </View>
                </View>
                {/* The note under the row, so "Hinzufügen" lines up with the field and not with its helper. */}
                <FieldNote helper={t('apply.fields.serviceHelper', { max: BUSINESS_LIMITS.servicesMax })} error={fieldText(t, fieldState.error)} testID={`${ROUTE}.service.note`} />
                {field.value.length > 0 ? (
                  <View role="list" style={styles.services} testID={`${ROUTE}.services`}>
                    {field.value.map((entry) => (
                      <View key={entry} role="listitem">
                        <Chip
                          label={entry}
                          onRemove={() => field.onChange(field.value.filter((value) => value !== entry))}
                          removeLabel={t('apply.fields.removeService', { service: entry })}
                          testID={`${ROUTE}.services.${entry}`}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            );
          }}
        />
      </FormGroup>
      <FormGroup testID={`${ROUTE}.group.about`}>
        <Field control={control} name="about" label={t('apply.fields.about')} helper={t('apply.fields.aboutHelper')} multiline maxRows={ABOUT_ROWS} maxLength={2000} />
      </FormGroup>
    </>
  );
}

function ImpressumStep({ control, locked = false }: StepProps) {
  const { t } = useTranslation('parts');
  const [sheet, setSheet] = useState(false);
  const legalForm = useWatch({ control, name: 'legalForm' });
  const needsRegister = !LEGAL_FORMS_WITHOUT_REGISTER.has(legalForm);
  return (
    <>
      <Text variant="callout" color="text.secondary">
        {t('apply.impressumIntro')}
      </Text>
      <FormGroup title={t('apply.groups.company')} testID={`${ROUTE}.group.company`}>
        <Field control={control} name="legalName" label={t('apply.fields.legalName')} helper={t('apply.fields.legalNameHelper')} locked={locked} maxLength={160} />
        <Controller
          control={control}
          name="legalForm"
          render={({ field, fieldState }) => (
            <>
              <PickerField
                label={t('apply.fields.legalForm')}
                value={t(`legalForms.${field.value}`)}
                placeholder={t('apply.fields.choose')}
                onPress={() => setSheet(true)}
                helper={isLockedField('legalForm', locked) ? t('apply.lockedField') : undefined}
                error={fieldText(t, fieldState.error)}
                disabled={isLockedField('legalForm', locked)}
                testID={`${ROUTE}.legalForm`}
              />
              <OptionSheet
                visible={sheet}
                onClose={() => setSheet(false)}
                title={t('apply.fields.legalForm')}
                options={LEGAL_FORMS.map((value) => ({ value, label: t(`legalForms.${value}`) }))}
                value={field.value}
                onSelect={(option) => {
                  field.onChange(option.value);
                  setSheet(false);
                }}
                testID={`${ROUTE}.legalFormSheet`}
              />
            </>
          )}
        />
        <Field control={control} name="representative" label={t('apply.fields.representative')} helper={t('apply.fields.representativeHelper')} locked={locked} maxLength={160} />
      </FormGroup>
      {needsRegister ? (
        <FormGroup title={t('apply.groups.register')} testID={`${ROUTE}.group.register`}>
          <Field control={control} name="registerCourt" label={t('apply.fields.registerCourt')} helper={t('apply.fields.registerCourtHelper')} locked={locked} maxLength={120} />
          <Field
            control={control}
            name="registerNumber"
            label={t('apply.fields.registerNumber')}
            locked={locked}
            maxLength={60}
            inputProps={{ autoCapitalize: 'characters', autoCorrect: false }}
          />
        </FormGroup>
      ) : null}
      <FormGroup testID={`${ROUTE}.group.vat`}>
        <Field
          control={control}
          name="vatId"
          label={t('apply.fields.vatId')}
          helper={t('apply.fields.vatIdHelper')}
          maxLength={20}
          inputProps={{ autoCapitalize: 'characters', autoCorrect: false }}
        />
      </FormGroup>
    </>
  );
}

function ContactStep({ control, locked = false }: StepProps) {
  const { t } = useTranslation('parts');
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <FormGroup title={t('apply.groups.address')} testID={`${ROUTE}.group.address`}>
        <Field control={control} name="street" label={t('apply.fields.street')} locked={locked} maxLength={160} inputProps={{ autoComplete: 'street-address' }} />
        <FieldPair>
          {[
            <Field
              key="postcode"
              control={control}
              name="postcode"
              label={t('apply.fields.postcode')}
              locked={locked}
              maxLength={10}
              inputProps={{ autoComplete: 'postal-code', inputMode: 'numeric' }}
            />,
            <Field key="city" control={control} name="city" label={t('apply.fields.city')} locked={locked} maxLength={80} />,
          ]}
        </FieldPair>
        <Controller
          control={control}
          name="country"
          render={({ field }) => (
            <>
              <PickerField
                label={t('apply.fields.country')}
                value={t(`countries.${field.value}`)}
                placeholder={t('apply.fields.choose')}
                onPress={() => setSheet(true)}
                disabled={isLockedField('country', locked)}
                helper={isLockedField('country', locked) ? t('apply.lockedField') : undefined}
                testID={`${ROUTE}.country`}
              />
              <OptionSheet
                visible={sheet}
                onClose={() => setSheet(false)}
                title={t('apply.fields.country')}
                options={COUNTRIES.map((value) => ({ value, label: t(`countries.${value}`) }))}
                value={field.value}
                onSelect={(option) => {
                  field.onChange(option.value);
                  setSheet(false);
                }}
                testID={`${ROUTE}.countrySheet`}
              />
            </>
          )}
        />
      </FormGroup>
      <FormGroup title={t('apply.groups.contact')} testID={`${ROUTE}.group.contact`}>
        <Field
          control={control}
          name="email"
          label={t('apply.fields.email')}
          helper={t('apply.fields.emailHelper')}
          maxLength={160}
          inputProps={{ keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email', autoCorrect: false }}
        />
        <Field
          control={control}
          name="phone"
          label={t('apply.fields.phone')}
          helper={t('apply.optional')}
          maxLength={40}
          inputProps={{ keyboardType: 'phone-pad', autoComplete: 'tel' }}
        />
        <Field
          control={control}
          name="website"
          label={t('apply.fields.website')}
          helper={t('apply.optional')}
          maxLength={300}
          inputProps={{ keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false }}
        />
      </FormGroup>
    </>
  );
}

function TimeField({ control, name, label, disabled }: { control: Control<BusinessFormValues>; name: `hours.${DayKey}.${'opens' | 'closes' | 'opens2' | 'closes2'}`; label: string; disabled?: boolean }) {
  const { t } = useTranslation('parts');
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={label}
          value={field.value}
          onChangeText={(text) => field.onChange(maskTime(text))}
          onBlur={field.onBlur}
          placeholder={t('apply.hours.placeholder')}
          error={fieldText(t, fieldState.error)}
          disabled={disabled}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={5}
          testID={`${ROUTE}.${name}`}
        />
      )}
    />
  );
}

function DayEditor({ control, day }: { control: Control<BusinessFormValues>; day: DayKey }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const value = useWatch({ control, name: `hours.${day}` });
  const name = dayLabel(day, t);
  return (
    <View style={styles.day} testID={`${ROUTE}.hours.${day}`}>
      <Controller
        control={control}
        name={`hours.${day}.open`}
        render={({ field }) => (
          <SwitchRow label={name} helper={field.value ? undefined : t('business.hours.closed')} value={field.value} onChange={field.onChange} testID={`${ROUTE}.hours.${day}.open`} />
        )}
      />
      {value.open ? (
        <>
          <FieldPair>
            {[
              <TimeField key="opens" control={control} name={`hours.${day}.opens`} label={t('apply.hours.opens')} />,
              <TimeField key="closes" control={control} name={`hours.${day}.closes`} label={t('apply.hours.closes')} />,
            ]}
          </FieldPair>
          <Controller
            control={control}
            name={`hours.${day}.split`}
            render={({ field }) => (
              <Checkbox
                checked={field.value}
                onChange={field.onChange}
                label={t('apply.hours.split', { day: name })}
                showLabel
                testID={`${ROUTE}.hours.${day}.split`}
              />
            )}
          />
          {value.split ? (
            <FieldPair>
              {[
                <TimeField key="opens2" control={control} name={`hours.${day}.opens2`} label={t('apply.hours.opensAgain')} />,
                <TimeField key="closes2" control={control} name={`hours.${day}.closes2`} label={t('apply.hours.closes')} />,
              ]}
            </FieldPair>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function HoursStep({ control }: StepProps) {
  const { t } = useTranslation('parts');
  return (
    <>
      <Text variant="callout" color="text.secondary">
        {t('apply.hours.intro')}
      </Text>
      <FormGroup title={t('business.hours.title')} testID={`${ROUTE}.group.hours`}>
        {DAY_KEYS.map((day) => (
          <DayEditor key={day} control={control} day={day} />
        ))}
      </FormGroup>
    </>
  );
}

function FinishStep({
  control,
  creating,
  business,
  media,
  onPick,
}: {
  control: Control<BusinessFormValues>;
  creating: boolean;
  business: MyBusiness | null;
  media: PickedMedia;
  onPick: (kind: 'logo' | 'cover') => void;
}) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const logo = media.logo ? { source: media.logo.uri } : business?.logo ? photoFields(business.logo, size.avatar.lg) : null;
  const cover = media.cover ? { source: media.cover.uri } : business?.cover ? photoFields(business.cover, 640) : null;
  return (
    <>
      <FormGroup title={t('apply.groups.images')} testID={`${ROUTE}.group.images`}>
        <View style={styles.mediaRow}>
          {logo ? <Photo {...logo} aspect="1:1" corner="md" style={styles.logo} testID={`${ROUTE}.logoPreview`} /> : <View style={[styles.logo, styles.placeholder]} />}
          <View style={styles.grow}>
            <Button label={logo ? t('apply.changeLogo') : t('apply.addLogo')} icon="image" variant="secondary" size="m" onPress={() => onPick('logo')} testID={`${ROUTE}.logo`} />
          </View>
        </View>
        <Text variant="caption" color="text.secondary">
          {t('apply.logoHelper')}
        </Text>
        <View style={styles.media}>
          {cover ? <Photo {...cover} aspect="16:9" corner="md" style={styles.cover} testID={`${ROUTE}.coverPreview`} /> : null}
          <Button label={cover ? t('apply.changeCover') : t('apply.addCover')} icon="image" variant="secondary" size="m" onPress={() => onPick('cover')} testID={`${ROUTE}.cover`} />
          <Text variant="caption" color="text.secondary">
            {t('apply.coverHelper')}
          </Text>
        </View>
      </FormGroup>
      <FormGroup title={t('apply.groups.documents')} testID={`${ROUTE}.group.documents`}>
        <Text variant="callout" color="text.secondary">
          {t('apply.documentsIntro')}
        </Text>
        <Field control={control} name="documentNote" label={t('apply.fields.documentNote')} helper={t('apply.fields.documentNoteHelper')} multiline maxRows={NOTE_ROWS} maxLength={1000} />
      </FormGroup>
      {creating ? (
        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <View>
              <Checkbox
                checked={field.value}
                onChange={field.onChange}
                label={t('apply.fields.acceptTerms')}
                showLabel
                alignFirstLine
                error={Boolean(fieldState.error)}
                testID={`${ROUTE}.acceptTerms`}
              />
              {fieldState.error ? <FormNotice message={fieldText(t, fieldState.error) ?? ''} testID={`${ROUTE}.acceptTerms.error`} /> : null}
            </View>
          )}
        />
      ) : null}
      <Text variant="caption" color="text.tertiary">
        {creating ? t('apply.reviewNote') : t('apply.reviewNoteEdit')}
      </Text>
    </>
  );
}
