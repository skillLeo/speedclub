import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { avatarUrlOf, useMe, useUpdateProfile, useUploadAvatar } from '@/api/queries/auth';
import { createStyles } from '@/theme';
import { Avatar, Button, Spinner } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { avatarFormData, pickPhoto, type PickedPhoto } from '../avatar';
import { applyServerErrors } from '../forms';
import { openAfterOnboarding, WIZARD_PATH } from '../routing';
import { CITY_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, profileSetupSchema, type ProfileSetupValues } from '../schemas';

const useStyles = createStyles((t) => ({
  avatarRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16], marginBottom: t.space[8] },
  avatarButton: { alignSelf: 'center' },
  avatarBox: { alignItems: 'center', height: t.size.avatar.xl, justifyContent: 'center', width: t.size.avatar.xl },
  // DQ-261: the spinner sits on the picked photo, so it takes the on-photo veil and colour (as PhotoGrid's processing tile), not the
  // theme's text colour, which is dark in Light.
  spinner: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
}));

/** AUTH-09. An empty PATCH finishes the step, which is all that "Überspringen" sends; a success ends in SessionHost. */
export function ProfileSetupScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const upload = useUploadAvatar();
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  // The same pick keeps its key across retries, so a retried upload cannot arrive twice.
  const [pending, setPending] = useState<{ photo: PickedPhoto; key: string } | null>(null);
  const finishing = useRef(false);
  // DQ-260: preparing the photo (decode, re-encode) comes before the upload and takes seconds on a phone. The member sees
  // the photo and the spinner from the pick on, and a second tap cannot start a second upload. The ref closes the gap
  // before the state arrives.
  const [sending, setSending] = useState(false);
  const avatarBusy = useRef(false);

  const { control, handleSubmit, setError, formState } = useForm<ProfileSetupValues>({
    resolver: zodResolver(profileSetupSchema),
    mode: 'onTouched',
    defaultValues: { displayName: me?.display_name ?? '', city: me?.city ?? '' },
  });

  const sendAvatar = async (picked: { photo: PickedPhoto; key: string }) => {
    setAvatarError(null);
    setSending(true);
    try {
      const form = await avatarFormData(picked.photo);
      await upload.mutateAsync({ form, idempotencyKey: picked.key });
      setPending(null);
    } catch (error) {
      setAvatarError(error instanceof ApiError ? error.message : t('profile.avatarFailed'));
    } finally {
      setSending(false);
    }
  };

  const withAvatarLock = async (run: () => Promise<void>) => {
    if (avatarBusy.current) return;
    avatarBusy.current = true;
    try {
      await run();
    } finally {
      avatarBusy.current = false;
    }
  };

  const chooseAvatar = () =>
    withAvatarLock(async () => {
      const photo = await pickPhoto();
      if (!photo) return;
      const next = { photo, key: newIdempotencyKey() };
      setPending(next);
      await sendAvatar(next);
    });

  const busy = sending || upload.isPending;

  const finish = async (body: { display_name?: string | null; city?: string | null }, then: string | null) => {
    // One way out at a time: a skip during a pending "Weiter" would drop the wizard and send a second PATCH. The state
    // arrives a render late, the ref at once.
    if (finishing.current) return;
    finishing.current = true;
    setNotice(null);
    openAfterOnboarding(then);
    try {
      // Done: SessionHost leaves the screen, and the lock stays until then.
      await update.mutateAsync(body);
    } catch (error) {
      finishing.current = false;
      openAfterOnboarding(null);
      setNotice(
        error instanceof ApiError
          ? applyServerErrors(error, setError, { display_name: 'displayName', city: 'city' })
          : t('common.serverError'),
      );
    }
  };

  // Built on press: finish() reads the lock, and a ref belongs to event handlers, not to render.
  const onSubmit = () =>
    handleSubmit(({ displayName, city }) => finish({ display_name: displayName || null, city: city || null }, WIZARD_PATH))();

  const name = me?.display_name ?? me?.username ?? '';

  return (
    <AuthScreen
      routeId="AUTH-09"
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      skeletonFields={2}
      onBack={null}
      dirty={formState.isDirty && !update.isPending && !update.isSuccess}
      cta={{
        label: t('profile.submit'),
        onPress: () => void onSubmit(),
        loading: update.isPending && update.variables?.display_name !== undefined,
        // The photo first: its answer, or its error, belongs on this screen.
        disabled: (update.isPending && update.variables?.display_name === undefined) || busy,
      }}
      secondary={{
        label: t('profile.skip'),
        onPress: () => void finish({}, null),
        loading: update.isPending && update.variables?.display_name === undefined,
        disabled: update.isPending && update.variables?.display_name !== undefined,
        testID: 'AUTH-09.skip',
      }}
    >
      {notice ? <FormNotice message={notice} testID="AUTH-09.notice" /> : null}
      <View style={styles.avatarRow}>
        <View style={styles.avatarBox}>
          <Avatar name={name} uri={busy && pending ? pending.photo.uri : avatarUrlOf(me?.avatar ?? null)} size={96} decorative testID="AUTH-09.avatar" />
          {busy ? (
            <View style={styles.spinner} testID="AUTH-09.avatarBusy">
              <Spinner decorative size={24} color="onPhoto.primary" />
            </View>
          ) : null}
        </View>
        <Button
          label={me?.avatar ? t('profile.changeAvatar') : t('profile.addAvatar')}
          variant="secondary"
          size="m"
          disabled={busy}
          onPress={() => void chooseAvatar()}
          style={styles.avatarButton}
          testID="AUTH-09.pickAvatar"
        />
      </View>
      {avatarError ? (
        <>
          <FormNotice message={avatarError} testID="AUTH-09.avatarError" />
          {pending ? (
            <Button
              label={t('common.retry')}
              variant="tertiary"
              size="m"
              flush="start"
              disabled={busy}
              onPress={() => void withAvatarLock(() => sendAvatar(pending))}
              testID="AUTH-09.avatarRetry"
            />
          ) : null}
        </>
      ) : null}
      <FormField
        control={control}
        name="displayName"
        label={t('profile.displayName')}
        helper={t('profile.displayNameHelper')}
        autoComplete="name"
        textContentType="name"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        testID="AUTH-09.displayName"
      />
      <FormField
        control={control}
        name="city"
        label={t('profile.city')}
        helper={t('profile.cityHelper')}
        textContentType="addressCity"
        maxLength={CITY_MAX_LENGTH}
        testID="AUTH-09.city"
      />
    </AuthScreen>
  );
}
