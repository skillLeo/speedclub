import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDeleteVehicle, useUpdateVehicle, type GarageVehicle } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { now } from '@/lib/clock';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Dialog, toast } from '@/ui';

import { FormGroup } from '../components/fields';
import { EditorForm, EditorLoading, EditorScreen, RestrictedNotice } from '../components/frames';
import { useBasicsCatalogueLoading, VehicleBasicsFields } from '../components/VehicleBasicsFields';
import { isGone, saveErrorMessage } from '../errors';
import { basicsPatch, basicsValues, type BasicsValues } from '../model';
import { basicsSchema, maxModelYear } from '../schemas';
import { useOwnVehicle, useSessionHeld } from '../useOwnVehicle';
import { BASICS_FIELDS } from './wizard/WizardVehicleScreen';

const ROUTE = 'GAR-05';
const BASICS_SKELETON_FIELDS = 4;
const BASICS_SKELETON_EXTRAS = 3;

const useStyles = createStyles((t) => ({
  danger: { alignItems: 'flex-start', marginTop: t.space[8] },
}));

/** GAR-05 /garage/[id]/basics: make, model, year, nickname, colour, description; "Fahrzeug löschen" at the end (FS-6 pattern). */
export function EditBasicsScreen() {
  const { t } = useTranslation('garage');
  const own = useOwnVehicle(ROUTE, { path: 'basics', skeleton: [BASICS_SKELETON_FIELDS, BASICS_SKELETON_EXTRAS] });
  const catalogueLoading = useBasicsCatalogueLoading(own.vehicle?.model_id);
  return (
    <EditorScreen routeId={ROUTE} title={t('basics.title')} fallback={own.id ? `/garage/${own.id}` : '/garage'} offlineLabel={t('offline.editor')}>
      {own.state ??
        (own.vehicle ? (
          catalogueLoading ? (
            <EditorLoading routeId={ROUTE} groups={[BASICS_SKELETON_FIELDS, BASICS_SKELETON_EXTRAS]} />
          ) : (
            <BasicsForm key={own.vehicle.id} vehicle={own.vehicle} restriction={own.restriction} />
          )
        ) : null)}
    </EditorScreen>
  );
}

function BasicsForm({ vehicle, restriction }: { vehicle: GarageVehicle; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const update = useUpdateVehicle(vehicle.id);
  const remove = useDeleteVehicle();
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const maxYear = maxModelYear(now());
  const schema = useMemo(() => basicsSchema(maxYear), [maxYear]);
  const { control, handleSubmit, setValue, setError, formState } = useForm<BasicsValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: basicsValues(vehicle),
  });
  const { isDirty, dirtyFields } = formState;
  const locked = restriction !== null;
  // Behind a session that ended (BH-30) the fields keep the member's text in its own colour: nothing saves, nothing is lost.
  const held = useSessionHeld();
  const fieldsLocked = locked && !held;

  useEffect(() => {
    if (saved) {
      if (router.canGoBack()) router.back();
      else router.replace(`/garage/${vehicle.id}`);
    }
  }, [router, saved, vehicle.id]);
  useEffect(() => {
    if (deleted) router.dismissTo('/garage');
  }, [deleted, router]);

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    try {
      await update.mutateAsync(basicsPatch(values, dirtyFields));
      toast(t('editor.saved'), { haptic: 'success', testID: `${ROUTE}.saved` });
      setSaved(true);
    } catch (error) {
      setNotice(applyServerErrors(error, setError, BASICS_FIELDS) === null ? null : saveErrorMessage(t, error));
    }
  });

  const confirmDelete = () => {
    const done = () => {
      setConfirming(false);
      toast(t('basics.deleted', { vehicle: vehicle.full_title }), { testID: `${ROUTE}.deleted` });
      setDeleted(true);
    };
    remove.mutate(vehicle, {
      onSuccess: done,
      onError: (error) => {
        // Already gone: an earlier tap landed and its answer was lost. What the member asked for has happened, and
        // useDeleteVehicle has taken it out of the cache as on success.
        if (isGone(error)) {
          done();
          return;
        }
        setConfirming(false);
        setNotice(saveErrorMessage(t, error));
      },
    });
  };

  return (
    <EditorForm
      routeId={ROUTE}
      dirty={isDirty && !update.isPending && !saved && !deleted}
      cta={{ label: t('editor.save'), onPress: () => void submit(), loading: update.isPending, disabled: locked || !online || !isDirty }}
      revealTop={restriction ?? notice}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      <FormGroup title={t('basics.groupVehicle')}>
        <VehicleBasicsFields
          control={control}
          setValue={setValue}
          maxYear={maxYear}
          extras={{ nickname: true, color: true, description: true }}
          disabled={fieldsLocked}
          routeId={ROUTE}
        />
      </FormGroup>
      <View style={styles.danger}>
        <Button
          label={t('basics.delete')}
          variant="destructive"
          size="m"
          icon="trash"
          // DQ-159: the glyph starts on the fields' edge, the padding reaches into the gutter.
          flush="start"
          disabled={!online}
          onPress={() => setConfirming(true)}
          testID={`${ROUTE}.delete`}
        />
      </View>
      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('basics.deleteTitle', { vehicle: vehicle.full_title })}
        body={vehicle.status === 'published' ? t('basics.deleteBodyPublished') : t('basics.deleteBodyDraft')}
        testID={`${ROUTE}.deleteDialog`}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${ROUTE}.deleteDialog.cancel` },
          { label: t('basics.deleteConfirm'), destructive: true, loading: remove.isPending, onPress: confirmDelete, testID: `${ROUTE}.deleteDialog.confirm` },
        ]}
      />
    </EditorForm>
  );
}
