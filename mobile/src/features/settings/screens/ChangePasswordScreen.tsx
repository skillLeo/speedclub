import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInput as RNTextInput } from 'react-native';

import { ApiError } from '@/api/client';
import type { Me } from '@/api/queries/auth';
import { isReauthCancelled } from '@/api/queries/recentAuth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { RuleList } from '@/features/auth/components/RuleList';
import { applyServerErrors, isCode } from '@/features/auth/forms';
import { passwordChecks } from '@/features/auth/schemas';
import { useSingleFlight } from '@/lib/useSingleFlight';
import { createStyles, size } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { hasPassword } from '../account';
import { useMemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { SecondFactorField } from '../components/SecondFactorField';
import { SwitchRow } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { isSecondFactorLocked, useFailureMessage, useFieldMessage } from '../forms';
import { useChangePassword } from '@/api/queries/settings';
import { changePasswordSchema, type ChangePasswordValues } from '../schemas';

const ROUTE = 'SET-04';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16] },
  field: { gap: t.space[8] },
  switchGroup: { marginTop: t.space[8] },
}));

function PasswordSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.field}>
            <SkeletonText variant="callout" width="35%" />
            <SkeletonBlock height={size.input} corner="sm" />
          </View>
        ))}
        <SkeletonBlock height={size.row.withThumb} corner="md" />
      </View>
    </Skeleton>
  );
}

type InputRef = ComponentRef<typeof RNTextInput>;

type PasswordInputProps = {
  control: Control<ChangePasswordValues>;
  name: 'currentPassword' | 'password' | 'passwordRepeat';
  label: string;
  isNew?: boolean;
  inputRef?: RefObject<InputRef | null>;
  /** The field the return key moves to; without one it submits. */
  next?: RefObject<InputRef | null>;
  onSubmit?: () => void;
  onChange?: () => void;
};

function PasswordInput({ control, name, label, isNew = false, inputRef, next, onSubmit, onChange }: PasswordInputProps) {
  const fieldMessage = useFieldMessage();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          ref={(node) => {
            field.ref(node);
            if (inputRef) inputRef.current = node;
          }}
          value={field.value}
          onChangeText={(value) => {
            field.onChange(value);
            onChange?.();
          }}
          onBlur={field.onBlur}
          label={label}
          error={fieldMessage(fieldState.error)}
          secure
          autoComplete={isNew ? 'new-password' : 'current-password'}
          textContentType={isNew ? 'newPassword' : 'password'}
          returnKeyType={next || name === 'currentPassword' ? 'next' : 'go'}
          onSubmitEditing={() => (next ? next.current?.focus() : onSubmit?.())}
          submitBehavior={next ? 'submit' : undefined}
          testID={`${ROUTE}.${name}`}
        />
      )}
    />
  );
}

/**
 * SET-04 /settings/security/password. The rules of §3.1 as a checklist, never a score; the common-password list is the server's.
 * "Auf anderen Geräten abmelden" is on by default: whoever changes a password usually wants the old one to stop working
 * everywhere. This device stays signed in either way. With two-factor on, the current code comes with it (SEC-P2-07), and a server
 * that asks for one although Me said off shows the field with its message.
 */
function ChangePasswordForm({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const { t: authT } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const failure = useFailureMessage();
  const change = useChangePassword();
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [askCode, setAskCode] = useState(me.two_factor_enabled);
  /** The second factor is locked (ADR-203 f): the button rests until a field changes. */
  const [locked, setLocked] = useState(false);
  const newRef = useRef<InputRef>(null);
  const repeatRef = useRef<InputRef>(null);
  /**
   * Client round 6 (L1): a passwordless member sets a first password here. There is no current one to ask for; the call sends
   * `current_password: ''` and withRecentAuth asks for recent authentication when the server wants it.
   */
  const passwordSet = hasPassword(me);
  const schema = useMemo(() => changePasswordSchema(me.email, askCode, passwordSet), [askCode, me.email, passwordSet]);
  const { control, handleSubmit, setError, setFocus, formState } = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', password: '', passwordRepeat: '', code: '', revokeOtherSessions: true },
  });
  const unlock = () => setLocked(false);
  const password = useWatch({ control, name: 'password' });
  const checks = passwordChecks(password, me.email);

  useEffect(() => {
    if (!done) return;
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [done, router]);

  const onSubmit = useSingleFlight(handleSubmit(async (values) => {
    setNotice(null);
    const secondFactor = (values.code ?? '').replace(/\s/g, '');
    try {
      await change.mutateAsync({
        currentPassword: passwordSet ? values.currentPassword : '',
        password: values.password,
        revokeOtherSessions: values.revokeOtherSessions,
        ...(secondFactor ? { code: secondFactor } : {}),
      });
      const doneKey = passwordSet ? 'password.changed' : 'password.setDone';
      toast(t(values.revokeOtherSessions ? `${doneKey}OthersOut` : doneKey), { haptic: 'success', testID: `${ROUTE}.changed` });
      setDone(true);
    } catch (error) {
      // The member closed the REAUTH sheet: nothing was sent, so nothing is said.
      if (isReauthCancelled(error)) return;
      if (isSecondFactorLocked(error)) {
        setLocked(true);
        setNotice(t('reauth.locked'));
        return;
      }
      if (isCode(error, 'two_factor_code_required')) setAskCode(true);
      setNotice(
        error instanceof ApiError
          ? applyServerErrors(error, setError, {
              current_password: 'currentPassword',
              password: 'password',
              password_confirmation: 'passwordRepeat',
              code: 'code',
            })
          : failure(error),
      );
    }
  }));

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t(passwordSet ? 'password.title' : 'password.setTitle')}
      fallback="/settings"
      offlineLabel={t('offlineForm')}
      section="password"
      form={{
        dirty: formState.isDirty && !change.isPending && !done,
        cta: { label: t(passwordSet ? 'password.submit' : 'password.setSubmit'), onPress: () => void onSubmit(), loading: change.isPending, disabled: locked },
      }}
    >
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} />
        {notice ? <FormNotice message={notice} tone={locked ? 'info' : 'error'} testID={`${ROUTE}.notice`} /> : null}
        {/* DQ-570: the code belongs to the current password, as on SET-03: right under it, before the new one. */}
        {passwordSet ? (
          <PasswordInput
            control={control}
            name="currentPassword"
            label={t('password.current')}
            next={askCode ? undefined : newRef}
            onSubmit={askCode ? () => setFocus('code') : undefined}
            onChange={unlock}
          />
        ) : (
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.noPassword`}>
            {t('reauth.noPassword')}
          </Text>
        )}
        {askCode ? (
          <SecondFactorField control={control} name="code" onChange={unlock} onSubmit={() => newRef.current?.focus()} testID={`${ROUTE}.secondFactor`} />
        ) : null}
        <View style={styles.field}>
          <PasswordInput control={control} name="password" label={t('password.new')} isNew inputRef={newRef} next={repeatRef} />
          <RuleList
            testID={`${ROUTE}.rules`}
            rules={[
              { key: 'length', label: authT('rules.length'), met: checks.length },
              { key: 'notEmail', label: authT('rules.notEmail'), met: checks.notEmail },
              { key: 'common', label: authT('rules.common'), met: null },
            ]}
          />
        </View>
        <PasswordInput
          control={control}
          name="passwordRepeat"
          label={t('password.repeat')}
          isNew
          inputRef={repeatRef}
          onSubmit={() => void onSubmit()}
        />
        <RowGroup style={styles.switchGroup}>
          <Controller
            control={control}
            name="revokeOtherSessions"
            render={({ field }) => (
              <SwitchRow
                title={t('password.revokeOthers')}
                helper={t('password.revokeOthersHelper')}
                value={field.value}
                onValueChange={field.onChange}
                testID={`${ROUTE}.revokeOthers`}
              />
            )}
          />
        </RowGroup>
      </View>
    </SettingsPage>
  );
}

export function ChangePasswordScreen() {
  const { t } = useTranslation('settings');
  const gate = useMemberGate({ routeId: ROUTE, returnTo: '/settings/security/password', skeleton: <PasswordSkeleton /> });
  if (gate.me) return <ChangePasswordForm me={gate.me} />;
  return (
    <SettingsPage routeId={ROUTE} title={t('password.title')} fallback="/settings" offlineLabel={t('offlineForm')} section="password">
      {gate.fallback}
    </SettingsPage>
  );
}
