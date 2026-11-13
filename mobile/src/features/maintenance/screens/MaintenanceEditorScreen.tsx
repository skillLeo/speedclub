import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import {
  isEditConflict,
  isGoneError,
  isOffline,
  LIMIT_REACHED,
  LOG_PHOTO_LIMIT,
  MAINTENANCE_FLAG,
  useDeleteItem,
  useDeleteLog,
  useDeleteLogPhoto,
  useMaintenanceItems,
  useMaintenanceLog,
  useSaveItem,
  useSaveLog,
  useUploadLogPhoto,
  type MaintenanceItem,
  type MaintenanceLog,
  type MaintenanceType,
} from '@/api/queries/maintenance';
import { useMemberSettings } from '@/api/queries/settings';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { CentredState, EditorForm, EditorLoading, GoneState, LoadErrorState, RestrictedNotice, SignInState, useGarageAccess } from '@/features/garage/components/frames';
import { ChoiceChips, FieldPair, FormGroup, SwitchRow } from '@/features/garage/components/fields';
import { photoForm, pickPhotos, preparePhoto, releasePicked } from '@/features/garage/photos';
import { fieldMessage } from '@/features/garage/schemas';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { newUlid } from '@/lib/ulid';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Chip, Dialog, Header, IconButton, OfflineBanner, Photo, Screen, Text, TextInput, toast } from '@/ui';

import {
  centsText,
  freeTypes,
  germanDay,
  ITEM_FIELDS,
  itemTitle,
  itemValuesFrom,
  LEAD_OPTIONS,
  maskDay,
  maskDueMonth,
  MAX_LEADS,
  plainNumber,
  toUnit,
  type DistanceUnit,
  type ItemField,
  type ItemFormValues,
  type LogFormValues,
} from '../model';
import { queueMaintenance } from '../outbox';
import { berlinDay, ITEM_SERVER_FIELDS, itemCreateBody, itemPatchBody, itemSchema, logCreateBody, logPatchBody, LOG_SERVER_FIELDS, logSchema } from '../schemas';
import { useDistanceUnit } from '../units';

const ROUTE = 'MNT-02';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const HU_DEFAULT_LEADS = [30, 14, 1];
const NOTES_ROWS = 4;

const useStyles = createStyles((t) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  photo: { width: t.size.thumb.card },
  photoRemove: { position: 'absolute', right: 0, top: 0 },
  info: { gap: t.space[8] },
  destructive: { alignItems: 'flex-start' },
}));

export type EditorKind = 'item' | 'log';

/**
 * MNT-02 `(modals)/maintenance-editor/[vehicleId]?kind=item|log&item=…&log=…&type=…` (09 §7.12): a maintenance item (type,
 * interval in months and km, last done, the member's own next date, up to three reminders, notes) or a service log entry (what,
 * date, mileage, private cost, workshop, notes, receipt photos). Online it saves at once with 422s on the fields; offline (or when
 * the answer never comes) the write waits in the outbox with its client id and goes out on reconnect.
 */
export function MaintenanceEditorScreen() {
  const { t } = useTranslation('garage');
  const params = useLocalSearchParams<{ id: string; kind?: string; item?: string; log?: string; type?: string }>();
  const vehicleId = paramOf(params.id) ?? '';
  const kind: EditorKind = paramOf(params.kind) === 'log' ? 'log' : 'item';
  const itemId = paramOf(params.item);
  const logId = kind === 'log' ? paramOf(params.log) : undefined;
  const typeParam = paramOf(params.type) as MaintenanceType | undefined;
  const online = useOnline();
  const qaState = useQaState();
  const access = useGarageAccess();
  const flag = useFlag(MAINTENANCE_FLAG);
  const close = useBack(`/garage/${vehicleId}/maintenance`);
  const items = useMaintenanceItems(vehicleId);
  const log = useMaintenanceLog(vehicleId, logId);
  const item = kind === 'item' && itemId ? items.data?.items.find((entry) => entry.id === itemId) : undefined;

  const title =
    kind === 'log'
      ? logId
        ? t('maintenance.editor.editLog')
        : t('maintenance.editor.newLog')
      : item
        ? t('maintenance.editor.editItem', { title: itemTitle(t, item) })
        : t('maintenance.editor.newItem');

  let body: ReactNode;
  if (access.status === 'guest') {
    body = (
      <CentredState>
        <SignInState routeId={ROUTE} returnTo={`/garage/${vehicleId}/maintenance`} />
      </CentredState>
    );
  } else if (!flag && qaState === 'default') {
    body = (
      <CentredState>
        <GoneState routeId={ROUTE} title={t('maintenance.unavailableTitle')} body={t('maintenance.unavailableBody')} />
      </CentredState>
    );
  } else if (qaState === 'loading' || access.status === 'loading' || (!items.data && items.isPending && items.fetchStatus !== 'paused') || (logId && !log.data && log.isPending && log.fetchStatus !== 'paused')) {
    body = <EditorLoading routeId={ROUTE} groups={[2, 3, 2]} />;
  } else if (qaState === 'error' || !items.data || (logId && !log.data && !isGoneError(log.error))) {
    body = (
      <CentredState>
        <LoadErrorState
          routeId={ROUTE}
          offline={!online || items.fetchStatus === 'paused'}
          onRetry={() => {
            void items.refetch();
            if (logId) void log.refetch();
          }}
          retrying={items.isFetching || log.isFetching}
        />
      </CentredState>
    );
  } else if ((kind === 'item' && itemId && !item) || (logId && !log.data)) {
    body = (
      <CentredState>
        <GoneState routeId={ROUTE} title={t('maintenance.editor.goneTitle')} body={t('maintenance.editor.gone')} />
      </CentredState>
    );
  } else if (kind === 'item') {
    body = <ItemForm vehicleId={vehicleId} item={item ?? null} items={items.data.items} initialType={typeParam} restriction={access.restriction} onDone={close} />;
  } else {
    body = <LogForm vehicleId={vehicleId} log={log.data ?? null} items={items.data.items} initialItem={itemId} restriction={access.restriction} onDone={close} />;
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={title} onBack={close} backIcon="close" backLabel={t('maintenance.editor.close')} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('maintenance.editor.offline')} testID={`${ROUTE}.offline`} />}
      {body}
    </Screen>
  );
}

function useFieldText() {
  const { t } = useTranslation('garage');
  return (error: Parameters<typeof fieldMessage>[1]) => fieldMessage(t, error);
}

type TextFieldProps<T extends ItemFormValues | LogFormValues> = {
  control: Control<T>;
  name: keyof T & string;
  label: string;
  placeholder?: string;
  helper?: string;
  numeric?: boolean;
  mask?: (text: string) => string;
  multiline?: boolean;
  disabled?: boolean;
  testID: string;
};

/** One text field of the form, bound to React Hook Form, with its error under it. */
function Field<T extends ItemFormValues | LogFormValues>({ control, name, label, placeholder, helper, numeric = false, mask, multiline = false, disabled, testID }: TextFieldProps<T>) {
  const message = useFieldText();
  return (
    <Controller
      control={control}
      name={name as never}
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={label}
          value={String(field.value ?? '')}
          onChangeText={(text) => field.onChange(mask ? mask(text) : text)}
          onBlur={field.onBlur}
          placeholder={placeholder}
          helper={helper}
          error={message(fieldState.error)}
          keyboardType={numeric ? 'number-pad' : undefined}
          inputMode={numeric ? 'numeric' : undefined}
          multiline={multiline}
          maxRows={multiline ? NOTES_ROWS : undefined}
          disabled={disabled}
          testID={testID}
        />
      )}
    />
  );
}

function LeadChips({ value, onChange, disabled, error }: { value: number[]; onChange: (next: number[]) => void; disabled?: boolean; error?: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [full, setFull] = useState(false);
  const toggle = (days: number) => {
    if (value.includes(days)) {
      setFull(false);
      onChange(value.filter((entry) => entry !== days));
      return;
    }
    if (value.length >= MAX_LEADS) {
      haptics.warning();
      setFull(true);
      return;
    }
    setFull(false);
    onChange([...value, days].sort((a, b) => b - a));
  };
  return (
    <View style={styles.info}>
      <View style={styles.chips} role="group" aria-label={t('maintenance.editor.leadTitle')}>
        {LEAD_OPTIONS.map((days) => (
          <Chip
            key={days}
            label={days === 0 ? t('maintenance.editor.leadSameDay') : t('maintenance.editor.lead', { count: days })}
            selected={value.includes(days)}
            selectionRole="checkbox"
            onPress={() => toggle(days)}
            disabled={disabled}
            testID={`${ROUTE}.lead.${days}`}
          />
        ))}
      </View>
      <Text variant="caption" color={full || error ? 'accent.fg' : 'text.secondary'} role={full || error ? 'alert' : undefined} testID={`${ROUTE}.leadHelper`}>
        {error ?? (full ? t('maintenance.defaults.leadsMax') : t('maintenance.editor.leadHelper'))}
      </Text>
    </View>
  );
}

/** What a failed save says when no field can: the server's own message for a 409/403, a gone entry, the limit. */
function saveNotice(t: ReturnType<typeof useTranslation<'garage'>>['t'], error: unknown): string {
  if (isEditConflict(error)) return t('maintenance.editor.conflict');
  if (isGoneError(error)) return t('maintenance.editor.gone');
  if (error instanceof ApiError && error.code === LIMIT_REACHED) return t('maintenance.editor.limit');
  if (error instanceof ApiError && error.message) return error.message;
  return t('maintenance.editor.failed');
}

function ItemForm({
  vehicleId,
  item,
  items,
  initialType,
  restriction,
  onDone,
}: {
  vehicleId: string;
  item: MaintenanceItem | null;
  items: readonly MaintenanceItem[];
  initialType: MaintenanceType | undefined;
  restriction: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const online = useOnline();
  const unit = useDistanceUnit();
  const settings = useMemberSettings();
  const save = useSaveItem(vehicleId);
  const remove = useDeleteItem(vehicleId);
  const free = useMemo(() => freeTypes(items), [items]);
  const startType: MaintenanceType = item?.type ?? (initialType && free.includes(initialType) ? initialType : (free[0] ?? 'custom'));
  const huLeads = settings.data?.maintenance.hu_au_lead_days ?? HU_DEFAULT_LEADS;
  const defaults = useMemo(() => itemValuesFrom(item, startType, { huLeadDays: huLeads }, unit), [huLeads, item, startType, unit]);
  const form = useForm<ItemFormValues>({ resolver: zodResolver(itemSchema(berlinDay(now()))) as never, mode: 'onTouched', defaultValues: defaults });
  const type = useWatch({ control: form.control, name: 'type' });
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const id = useRef(newUlid());
  const key = useRef(newIdempotencyKey());
  const fields = ITEM_FIELDS[type];
  const shows = (field: ItemField) => fields.includes(field);
  const locked = restriction !== null;

  const finish = (message: string) => {
    setSaved(true);
    toast(message, { testID: `${ROUTE}.toast` });
    requestAnimationFrame(onDone);
  };

  const onValid = (values: ItemFormValues) => {
    setNotice(null);
    const queue = () => {
      if (item) queueMaintenance(vehicleId, item.id, { kind: 'item.update', payload: { body: itemPatchBody(values, unit, item.version) } });
      else queueMaintenance(vehicleId, id.current, { kind: 'item.create', payload: { body: itemCreateBody(values, unit, id.current) } });
      finish(t('maintenance.outbox.queued'));
    };
    if (!online) {
      queue();
      return;
    }
    save.mutate(
      item ? { mode: 'update', itemId: item.id, body: itemPatchBody(values, unit, item.version) } : { mode: 'create', body: itemCreateBody(values, unit, id.current), idempotencyKey: key.current },
      {
        onSuccess: () => {
          haptics.success();
          finish(t('maintenance.editor.saved'));
        },
        onError: (error) => {
          if (isOffline(error)) {
            queue();
            return;
          }
          haptics.error();
          if (isEditConflict(error) || isGoneError(error)) {
            setNotice(saveNotice(t, error));
            return;
          }
          const left = applyServerErrors(error, form.setError, ITEM_SERVER_FIELDS);
          if (left !== null) setNotice(saveNotice(t, error));
        },
      },
    );
  };
  const submit = () => form.handleSubmit(onValid, () => haptics.warning())();

  const confirmDelete = () => {
    if (!item) return;
    setConfirming(false);
    if (!online) {
      queueMaintenance(vehicleId, item.id, { kind: 'item.delete', payload: {} });
      finish(t('maintenance.outbox.queued'));
      return;
    }
    remove.mutate(item.id, {
      onSuccess: () => finish(t('maintenance.editor.deleted', { title: itemTitle(t, item) })),
      onError: (error) => {
        if (isGoneError(error)) finish(t('maintenance.editor.deleted', { title: itemTitle(t, item) }));
        else if (isOffline(error)) {
          queueMaintenance(vehicleId, item.id, { kind: 'item.delete', payload: {} });
          finish(t('maintenance.outbox.queued'));
        } else setNotice(saveNotice(t, error));
      },
    });
  };

  const selectType = (next: MaintenanceType | '') => {
    if (!next) return;
    form.reset({ ...itemValuesFrom(null, next, { huLeadDays: huLeads }, unit), notes: form.getValues('notes') }, { keepDefaultValues: true });
  };

  return (
    <>
      <EditorForm
        routeId={ROUTE}
        dirty={form.formState.isDirty && !saved}
        revealTop={notice}
        cta={{ label: t('maintenance.editor.save'), onPress: submit, loading: save.isPending, disabled: locked }}
      >
        {restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
        {item ? null : (
          <FormGroup testID={`${ROUTE}.types`}>
            <ChoiceChips<MaintenanceType>
              label={t('maintenance.editor.typeLabel')}
              options={free.map((value) => ({ value, label: t(`maintenance.type.${value}`) }))}
              value={type}
              onChange={selectType}
              testID={`${ROUTE}.type`}
            />
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.typeHelper`}>
              {t(`maintenance.typeHelper.${type}`)}
            </Text>
          </FormGroup>
        )}
        {shows('title') ? (
          <Field control={form.control} name="title" label={t('maintenance.editor.titleLabel')} placeholder={t('maintenance.editor.titlePlaceholder')} testID={`${ROUTE}.title`} />
        ) : null}
        {shows('dueMonth') ? (
          <Field
            control={form.control}
            name="dueMonth"
            label={t('maintenance.editor.dueMonthLabel')}
            placeholder={t('maintenance.editor.monthPlaceholder')}
            numeric
            mask={maskDueMonth}
            testID={`${ROUTE}.dueMonth`}
          />
        ) : null}
        {type === 'tyre_change' ? (
          <FormNotice message={t('maintenance.editor.seasonInfo')} tone="info" testID={`${ROUTE}.seasonInfo`} />
        ) : type === 'insurance' ? (
          <FormNotice message={t('maintenance.editor.insuranceInfo')} tone="info" testID={`${ROUTE}.insuranceInfo`} />
        ) : null}
        {shows('intervalMonths') ? (
          <FormGroup title={t('maintenance.editor.intervalTitle')}>
            {shows('intervalKm') ? (
              <FieldPair>
                <Field control={form.control} name="intervalMonths" label={t('maintenance.editor.intervalMonths')} numeric testID={`${ROUTE}.intervalMonths`} />
                <Field control={form.control} name="intervalKm" label={t('maintenance.editor.intervalKm', { unit })} numeric testID={`${ROUTE}.intervalKm`} />
              </FieldPair>
            ) : (
              <Field control={form.control} name="intervalMonths" label={t('maintenance.editor.intervalMonths')} numeric testID={`${ROUTE}.intervalMonths`} />
            )}
          </FormGroup>
        ) : null}
        {shows('lastDate') ? (
          <FormGroup title={t('maintenance.editor.lastTitle')}>
            {shows('lastKm') ? (
              <FieldPair>
                <Field control={form.control} name="lastDate" label={t('maintenance.editor.date')} placeholder={t('maintenance.editor.datePlaceholder')} numeric mask={maskDay} testID={`${ROUTE}.lastDate`} />
                <Field control={form.control} name="lastKm" label={t('maintenance.editor.km', { unit })} numeric testID={`${ROUTE}.lastKm`} />
              </FieldPair>
            ) : (
              <Field control={form.control} name="lastDate" label={t('maintenance.editor.date')} placeholder={t('maintenance.editor.datePlaceholder')} numeric mask={maskDay} testID={`${ROUTE}.lastDate`} />
            )}
          </FormGroup>
        ) : null}
        {shows('nextDate') ? (
          <FormGroup title={t('maintenance.editor.nextTitle')}>
            <Field
              control={form.control}
              name="nextDate"
              label={t('maintenance.editor.nextDate')}
              placeholder={item?.next_due.date && !item.next_due.pinned ? germanDay(item.next_due.date) : t('maintenance.editor.datePlaceholder')}
              helper={t('maintenance.editor.nextHelper')}
              numeric
              mask={maskDay}
              testID={`${ROUTE}.nextDate`}
            />
            {shows('nextKm') ? (
              <Field
                control={form.control}
                name="nextKm"
                label={t('maintenance.editor.nextKm', { unit })}
                placeholder={item?.next_due.km !== null && item?.next_due.km !== undefined && !item.next_due.pinned ? plainNumber(toUnit(item.next_due.km, unit)) : undefined}
                numeric
                testID={`${ROUTE}.nextKm`}
              />
            ) : null}
          </FormGroup>
        ) : null}
        <FormGroup title={t('maintenance.editor.leadTitle')} testID={`${ROUTE}.leads`}>
          <Controller
            control={form.control}
            name="lead"
            render={({ field, fieldState }) => <LeadChips value={field.value} onChange={field.onChange} error={fieldMessage(t, fieldState.error)} />}
          />
          <Controller
            control={form.control}
            name="enabled"
            render={({ field }) => <SwitchRow label={t('maintenance.editor.enabled')} value={field.value} onChange={field.onChange} testID={`${ROUTE}.enabled`} />}
          />
        </FormGroup>
        <Field control={form.control} name="notes" label={t('maintenance.editor.notesLabel')} placeholder={t('maintenance.editor.notesPlaceholder')} multiline testID={`${ROUTE}.notes`} />
        {item ? (
          <View style={styles.destructive}>
            <Button
              label={t('maintenance.editor.delete')}
              variant="destructive"
              size="m"
              // DQ-1128: the label starts on the field edge, not 12 inside it.
              flush="start"
              disabled={locked}
              loading={remove.isPending}
              onPress={() => setConfirming(true)}
              testID={`${ROUTE}.delete`}
            />
          </View>
        ) : null}
      </EditorForm>
      {item ? (
        <Dialog
          visible={confirming}
          onClose={() => setConfirming(false)}
          title={t('maintenance.editor.deleteTitle', { title: itemTitle(t, item) })}
          body={t('maintenance.editor.deleteBody')}
          actions={[
            { label: t('maintenance.editor.deleteKeep'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${ROUTE}.deleteDialog.keep` },
            { label: t('maintenance.editor.deleteConfirm'), destructive: true, onPress: confirmDelete, testID: `${ROUTE}.deleteDialog.confirm` },
          ]}
          testID={`${ROUTE}.deleteDialog`}
        />
      ) : null}
    </>
  );
}

function logValuesFrom(log: MaintenanceLog | null, initialItem: string | undefined, items: readonly MaintenanceItem[], unit: DistanceUnit, locale: 'de' | 'en'): LogFormValues {
  if (!log) {
    const known = items.find((entry) => entry.id === initialItem);
    const today = berlinDay(now());
    return { itemId: known?.id ?? null, type: known?.type ?? 'custom', title: '', date: germanDay(today), km: '', cost: '', workshop: '', notes: '' };
  }
  return {
    itemId: log.item_id,
    type: log.type,
    title: log.title ?? '',
    date: germanDay(log.done_at),
    km: log.mileage_km === null ? '' : plainNumber(toUnit(log.mileage_km, unit)),
    cost: log.cost ? centsText(log.cost.cents, locale) : '',
    workshop: log.workshop ?? '',
    notes: log.notes ?? '',
  };
}

const OTHER = '__other';

function LogForm({
  vehicleId,
  log,
  items,
  initialItem,
  restriction,
  onDone,
}: {
  vehicleId: string;
  log: MaintenanceLog | null;
  items: readonly MaintenanceItem[];
  initialItem: string | undefined;
  restriction: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const online = useOnline();
  const unit = useDistanceUnit();
  const format = useFormat();
  const save = useSaveLog(vehicleId);
  const remove = useDeleteLog(vehicleId);
  const defaults = useMemo(() => logValuesFrom(log, initialItem, items, unit, format.locale), [format.locale, initialItem, items, log, unit]);
  const form = useForm<LogFormValues>({ resolver: zodResolver(logSchema(berlinDay(now()), format.locale)) as never, mode: 'onTouched', defaultValues: defaults });
  const itemId = useWatch({ control: form.control, name: 'itemId' });
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const id = useRef(newUlid());
  const key = useRef(newIdempotencyKey());
  const locked = restriction !== null;

  const finish = (message: string) => {
    setSaved(true);
    toast(message, { testID: `${ROUTE}.toast` });
    requestAnimationFrame(onDone);
  };

  const onValid = (values: LogFormValues) => {
    setNotice(null);
    const queue = () => {
      if (log) queueMaintenance(vehicleId, log.id, { kind: 'log.update', payload: { body: logPatchBody(values, unit, format.locale, log.version) } });
      else queueMaintenance(vehicleId, id.current, { kind: 'log.create', payload: { body: logCreateBody(values, unit, format.locale, id.current) } });
      finish(t('maintenance.outbox.queued'));
    };
    if (!online) {
      queue();
      return;
    }
    save.mutate(
      log
        ? { mode: 'update', logId: log.id, body: logPatchBody(values, unit, format.locale, log.version) }
        : { mode: 'create', body: logCreateBody(values, unit, format.locale, id.current), idempotencyKey: key.current },
      {
        onSuccess: () => {
          haptics.success();
          finish(t('maintenance.editor.saved'));
        },
        onError: (error) => {
          if (isOffline(error)) {
            queue();
            return;
          }
          haptics.error();
          if (isEditConflict(error) || isGoneError(error)) {
            setNotice(saveNotice(t, error));
            return;
          }
          const left = applyServerErrors(error, form.setError, LOG_SERVER_FIELDS);
          if (left !== null) setNotice(saveNotice(t, error));
        },
      },
    );
  };
  const submit = () => form.handleSubmit(onValid, () => haptics.warning())();

  const confirmDelete = () => {
    if (!log) return;
    setConfirming(false);
    if (!online) {
      queueMaintenance(vehicleId, log.id, { kind: 'log.delete', payload: {} });
      finish(t('maintenance.outbox.queued'));
      return;
    }
    remove.mutate(log.id, {
      onSuccess: () => finish(t('maintenance.log.deleted')),
      onError: (error) => {
        if (isGoneError(error)) finish(t('maintenance.log.deleted'));
        else setNotice(saveNotice(t, error));
      },
    });
  };

  const options = [
    ...items.map((entry) => ({ value: entry.id, label: itemTitle(t, entry) })),
    { value: OTHER, label: t('maintenance.editor.logOwn') },
  ];

  return (
    <>
      <EditorForm
        routeId={ROUTE}
        dirty={form.formState.isDirty && !saved}
        revealTop={notice}
        cta={{ label: t('maintenance.editor.save'), onPress: submit, loading: save.isPending, disabled: locked }}
      >
        {restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
        <FormGroup testID={`${ROUTE}.what`}>
          <ChoiceChips<string>
            label={t('maintenance.editor.logWhat')}
            options={options}
            value={itemId ?? OTHER}
            onChange={(next) => {
              const chosen = items.find((entry) => entry.id === next);
              form.setValue('itemId', chosen ? chosen.id : null, { shouldDirty: true });
              form.setValue('type', chosen ? chosen.type : 'custom', { shouldDirty: true });
            }}
            testID={`${ROUTE}.item`}
          />
        </FormGroup>
        {itemId === null ? (
          <Field control={form.control} name="title" label={t('maintenance.editor.titleLabel')} placeholder={t('maintenance.editor.titlePlaceholder')} testID={`${ROUTE}.logTitle`} />
        ) : null}
        <FieldPair>
          <Field control={form.control} name="date" label={t('maintenance.editor.date')} placeholder={t('maintenance.editor.datePlaceholder')} numeric mask={maskDay} testID={`${ROUTE}.date`} />
          <Field control={form.control} name="km" label={t('maintenance.editor.km', { unit })} numeric testID={`${ROUTE}.km`} />
        </FieldPair>
        <Field
          control={form.control}
          name="cost"
          label={t('maintenance.editor.logCost')}
          placeholder={t('maintenance.editor.costPlaceholder')}
          helper={t('maintenance.editor.logCostHelper')}
          testID={`${ROUTE}.cost`}
        />
        <Field
          control={form.control}
          name="workshop"
          label={t('maintenance.editor.logWorkshop')}
          placeholder={t('maintenance.editor.logWorkshopPlaceholder')}
          testID={`${ROUTE}.workshop`}
        />
        <Field
          control={form.control}
          name="notes"
          label={t('maintenance.editor.notesLabel')}
          placeholder={t('maintenance.editor.logNotesPlaceholder')}
          multiline
          testID={`${ROUTE}.notes`}
        />
        <LogPhotos vehicleId={vehicleId} log={log} disabled={locked} />
        {log ? (
          <View style={styles.destructive}>
            <Button
              label={t('maintenance.editor.deleteLog')}
              variant="destructive"
              size="m"
              // DQ-1128: the label starts on the field edge, not 12 inside it.
              flush="start"
              disabled={locked}
              loading={remove.isPending}
              onPress={() => setConfirming(true)}
              testID={`${ROUTE}.delete`}
            />
          </View>
        ) : null}
      </EditorForm>
      {log ? (
        <Dialog
          visible={confirming}
          onClose={() => setConfirming(false)}
          title={t('maintenance.editor.deleteLogTitle')}
          body={t('maintenance.editor.deleteLogBody')}
          actions={[
            { label: t('maintenance.editor.deleteKeep'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${ROUTE}.deleteDialog.keep` },
            { label: t('maintenance.editor.deleteConfirm'), destructive: true, onPress: confirmDelete, testID: `${ROUTE}.deleteDialog.confirm` },
          ]}
          testID={`${ROUTE}.deleteDialog`}
        />
      ) : null}
    </>
  );
}

/**
 * Receipts and booklet photos of a saved entry (private disk, signed URLs): up to six, uploaded at once with an Idempotency-Key.
 * A new entry gets them after its first save; offline the button explains instead of queueing files.
 */
function LogPhotos({ vehicleId, log, disabled }: { vehicleId: string; log: MaintenanceLog | null; disabled: boolean }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const online = useOnline();
  const upload = useUploadLogPhoto(vehicleId);
  const removePhoto = useDeleteLogPhoto(vehicleId);
  const [busy, setBusy] = useState(false);
  const photos = log?.photos ?? [];
  const remaining = LOG_PHOTO_LIMIT - photos.length;

  const add = async () => {
    if (!log || remaining <= 0) return;
    setBusy(true);
    try {
      const picked = await pickPhotos(remaining);
      for (const photo of picked ?? []) {
        try {
          const form = await photoForm(await preparePhoto(photo));
          await upload.mutateAsync({ logId: log.id, form, idempotencyKey: newIdempotencyKey() });
        } finally {
          releasePicked(photo);
        }
      }
    } catch {
      toast(t('maintenance.editor.photoFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
    } finally {
      setBusy(false);
    }
  };

  const helper = !log ? t('maintenance.editor.photoLater') : !online ? t('maintenance.editor.photoOffline') : t('maintenance.editor.photosHelper');
  return (
    <FormGroup title={t('maintenance.editor.photos')} testID={`${ROUTE}.photos`}>
      {photos.length > 0 ? (
        <View style={styles.photos}>
          {photos.map((photo, index) => {
            const variant = [...photo.variants].sort((a, b) => a.width - b.width)[0];
            return (
              <View key={photo.id} style={styles.photo}>
                <Photo source={variant?.url ?? null} blurhash={photo.blurhash} aspect="1:1" corner="sm" label={t('maintenance.editor.photoAlt', { index: index + 1 })} testID={`${ROUTE}.photo.${photo.id}`} />
                <View style={styles.photoRemove}>
                  <IconButton
                    icon="x"
                    variant="onPhoto"
                    label={t('maintenance.editor.removePhoto', { index: index + 1 })}
                    disabled={disabled || !online}
                    onPress={() => log && removePhoto.mutate({ logId: log.id, mediaId: photo.id })}
                    testID={`${ROUTE}.photo.${photo.id}.remove`}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      <Text variant="caption" color="text.secondary">
        {helper}
      </Text>
      {log && remaining > 0 ? (
        <View style={styles.destructive}>
          <Button
            label={t('maintenance.editor.addPhoto')}
            icon="camera"
            variant="secondary"
            size="m"
            disabled={disabled || !online}
            loading={busy}
            onPress={() => void add()}
            testID={`${ROUTE}.addPhoto`}
          />
        </View>
      ) : null}
    </FormGroup>
  );
}
