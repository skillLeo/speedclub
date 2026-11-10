import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { ApiError } from '@/api/client';
import { endLocalSessionQuietly, type Me } from '@/api/queries/auth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { createStyles, size } from '@/theme';
import { Button, Checkbox, Dialog, Icon, Skeleton, SkeletonBlock, SkeletonText, Text, TextInput, type IconName } from '@/ui';

import { twoFactorEnabledOf } from '../account';
import { useMemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { markAccountDeleted, useAccountDeleted } from '../deletion';
import { siteUrl } from '../markdown/links';
import { asksForSecondFactor, isSecondFactorLocked, useFailureMessage, useFieldMessage } from '../forms';
import { SETTINGS_PATHS } from '../navigation';
import { useDeleteAccount } from '@/api/queries/settings';
import { deleteAccountSchema, type DeleteAccountValues } from '../schemas';

const ROUTE = 'SET-13';

/** WEB-05: the same deletion without the app (Google Play asks for this link), on the public site. */
export function webDeletionUrl(site: string | null = siteUrl()): string | null {
  return site ? `${site.replace(/\/+$/, '')}/konto-loeschen` : null;
}

/** What happens, in the order it happens (§3.1, contract §3). Each entry is `delete.consequences.<key>`. */
export const DELETION_CONSEQUENCES: readonly { key: string; icon: IconName }[] = [
  { key: 'hidden', icon: 'eye-slash' },
  { key: 'stickers', icon: 'qr-code' },
  { key: 'signedOut', icon: 'device-mobile' },
  { key: 'social', icon: 'user' },
  { key: 'messages', icon: 'chat-circle' },
  { key: 'final', icon: 'trash' },
  { key: 'noUndo', icon: 'warning' },
];

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  list: { gap: t.space[16], padding: ROW_INSET },
  item: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  itemText: { flex: 1 },
  fields: { gap: t.space[16] },
  links: { alignItems: 'flex-start' },
  skeletonList: { gap: t.space[16], padding: ROW_INSET },
}));

function DeleteSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={2} />
        <RowGroup>
          <View style={styles.skeletonList}>
            {DELETION_CONSEQUENCES.map((item) => (
              <SkeletonText key={item.key} variant="bodyDense" lines={2} />
            ))}
          </View>
        </RowGroup>
        <SkeletonBlock height={size.input} corner="sm" />
      </View>
    </Skeleton>
  );
}

/** The consequences, plainly. Also on WEB-05 in the same words (contract §3). */
export function DeletionConsequences() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  return (
    <RowGroup title={t('delete.consequencesTitle')} testID={`${ROUTE}.consequences`}>
      <View style={styles.list} role="list">
        {DELETION_CONSEQUENCES.map((item) => (
          <View key={item.key} style={styles.item} role="listitem" testID={`${ROUTE}.consequence.${item.key}`}>
            <Icon name={item.icon} size={20} color="text.secondary" />
            <Text variant="bodyDense" style={styles.itemText}>
              {t(`delete.consequences.${item.key}`)}
            </Text>
          </View>
        ))}
      </View>
    </RowGroup>
  );
}

/**
 * SET-13 /settings/data/delete: the consequences first, then the export, then password (and the second factor when two-factor
 * is on), the checkbox, "Konto löschen" (Destructive L) and a last dialog with the only filled red button. Success ends the
 * session on this device and shows the final screen. Deactivation is immediate; deletion follows after 30 days.
 */
function DeleteAccountForm({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const remove = useDeleteAccount();
  const [askCode, setAskCode] = useState(twoFactorEnabledOf(me) === true);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** ADR-203 (f): the second factor is locked; the button rests until a field changes. Nobody is signed out. */
  const [locked, setLocked] = useState(false);
  const webDeletion = webDeletionUrl();
  const schema = useMemo(() => deleteAccountSchema(askCode), [askCode]);
  const { control, handleSubmit, setError, formState, resetField } = useForm<DeleteAccountValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { password: '', code: '', understood: false },
  });

  const review = handleSubmit(() => {
    setNotice(null);
    setConfirming(true);
  });

  const run = handleSubmit(async (values) => {
    const code = values.code.replace(/\s/g, '');
    try {
      await remove.mutateAsync({ password: values.password, ...(askCode && code ? { code } : {}) });
      // DeleteAccountScreen takes over: this form and its guard go, then the session, then the final screen.
      markAccountDeleted();
    } catch (error) {
      setConfirming(false);
      if (isSecondFactorLocked(error)) {
        setLocked(true);
        setNotice(t('reauth.locked'));
      } else if (asksForSecondFactor(error) && !askCode) {
        setAskCode(true);
        setNotice(t('delete.codeNeeded'));
      } else if (error instanceof ApiError) {
        resetField('password', { keepDirty: true, keepError: false });
        setNotice(applyServerErrors(error, setError, { password: 'password', code: 'code' }));
      } else {
        setNotice(failure(error));
      }
    }
  });

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('delete.title')}
      fallback="/settings"
      offlineLabel={t('offlineForm')}
      section="delete"
      form={{
        dirty: formState.isDirty && !remove.isPending && !remove.isSuccess,
        cta: { label: t('delete.submit'), onPress: () => void review(), destructive: true, disabled: remove.isPending || locked },
      }}
      overlays={
        <Dialog
          visible={confirming}
          onClose={remove.isPending ? undefined : () => setConfirming(false)}
          title={t('delete.dialogTitle')}
          body={t('delete.dialogBody')}
          testID={`${ROUTE}.dialog`}
          actions={[
            {
              label: t('common.cancel'),
              variant: 'secondary',
              disabled: remove.isPending,
              onPress: () => setConfirming(false),
              testID: `${ROUTE}.dialog.cancel`,
            },
            {
              label: t('delete.dialogConfirm'),
              destructive: true,
              loading: remove.isPending,
              onPress: () => void run(),
              testID: `${ROUTE}.dialog.confirm`,
            },
          ]}
        />
      }
    >
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} />
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('delete.intro')}
        </Text>
        <DeletionConsequences />
        <View style={styles.links}>
          <Text variant="supporting" color="text.secondary">
            {t('delete.exportFirst')}
          </Text>
          {/* ADR-203 (c): an export asked for before the deletion stays buildable and downloadable until it expires. */}
          <Text variant="supporting" color="text.secondary" testID={`${ROUTE}.exportKept`}>
            {t('delete.exportKept')}
          </Text>
          <Button
            label={t('delete.toExport')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={() => router.push(SETTINGS_PATHS.export)}
            testID={`${ROUTE}.toExport`}
          />
          <Text variant="supporting" color="text.secondary">
            {t('delete.retention')}
          </Text>
          <Button
            label={t('delete.toPrivacy')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={() => router.push({ pathname: '/settings/legal/[doc]', params: { doc: 'privacy' } })}
            testID={`${ROUTE}.toPrivacy`}
          />
          {webDeletion ? (
            <>
              <Text variant="supporting" color="text.secondary">
                {t('delete.webHint')}
              </Text>
              <Button
                label={t('delete.toWeb')}
                variant="tertiary"
                size="m"
                role="link"
                flush="start"
                onPress={() => void Linking.openURL(webDeletion)}
                testID={`${ROUTE}.toWeb`}
              />
            </>
          ) : null}
        </View>
        {notice ? (
          <FormNotice message={notice} tone={notice === t('reauth.locked') ? 'info' : 'error'} testID={`${ROUTE}.notice`} />
        ) : null}
        <View style={styles.fields}>
          <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('delete.confirmTitle')}
          </Text>
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={(next) => {
                  field.onChange(next);
                  setLocked(false);
                }}
                onBlur={field.onBlur}
                label={t('delete.password')}
                error={fieldMessage(fieldState.error)}
                secure
                autoComplete="current-password"
                textContentType="password"
                testID={`${ROUTE}.password`}
              />
            )}
          />
          {askCode ? (
            <Controller
              control={control}
              name="code"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  value={field.value}
                  onChangeText={(next) => {
                  field.onChange(next);
                  setLocked(false);
                }}
                  onBlur={field.onBlur}
                  label={t('reauth.code')}
                  helper={t('reauth.codeHelper')}
                  error={fieldMessage(fieldState.error)}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  spellCheck={false}
                  testID={`${ROUTE}.code`}
                />
              )}
            />
          ) : null}
          <Controller
            control={control}
            name="understood"
            render={({ field, fieldState }) => (
              <View>
                <Checkbox
                  checked={field.value}
                  onChange={field.onChange}
                  label={t('delete.understood')}
                  showLabel
                  alignFirstLine
                  error={Boolean(fieldState.error)}
                  testID={`${ROUTE}.understood`}
                />
                {fieldState.error ? (
                  <Text variant="helper" color="accent.fg" role="alert" testID={`${ROUTE}.understood.error`}>
                    {fieldMessage(fieldState.error)}
                  </Text>
                ) : null}
              </View>
            )}
          />
        </View>
      </View>
    </SettingsPage>
  );
}

/** After the deletion: the session ends on this device without the session-expired dialog, and the final screen follows. */
function LeaveAfterDeletion() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    void endLocalSessionQuietly().finally(() => {
      if (alive) router.replace('/settings/data/deleted');
    });
    return () => {
      alive = false;
    };
  }, [router]);
  return null;
}

/**
 * After the deletion nothing here may still read Me. The gate's query used to live in the screen itself: in the commit that
 * mounted LeaveAfterDeletion it re-rendered still signed in, and its effect, which runs after the child's, applied
 * `enabled: true` to the query cache LeaveAfterDeletion had just cleared. TanStack Query then fetched auth/me for an account that
 * was gone, a 401 in the console (F8, M2.8 round 2). So the gate is a component of its own that leaves with the form.
 */
export function DeleteAccountScreen() {
  const deleted = useAccountDeleted();
  return deleted ? <LeaveAfterDeletion /> : <DeleteAccountGate />;
}

function DeleteAccountGate() {
  const { t } = useTranslation('settings');
  const gate = useMemberGate({ routeId: ROUTE, returnTo: '/settings/data/delete', skeleton: <DeleteSkeleton /> });
  if (gate.me) return <DeleteAccountForm me={gate.me} />;
  return (
    <SettingsPage routeId={ROUTE} title={t('delete.title')} fallback="/settings" offlineLabel={t('offlineForm')} section="delete">
      {gate.fallback}
    </SettingsPage>
  );
}
