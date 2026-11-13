import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { fetchProviderNonce, type SocialProvider } from '@/api/queries/passwordless';
import { isReauthCancelled } from '@/api/queries/recentAuth';
import {
  useAddPasskey,
  useDeletePasskey,
  useLinkedProviders,
  useLinkProvider,
  usePasskeys,
  useRenamePasskey,
  useUnlinkProvider,
  type LinkedProvider,
  type Passkey,
} from '@/api/queries/security';
import { appleProvider } from '@/features/auth/providers/apple';
import { googleProvider } from '@/features/auth/providers/google';
import { createPasskey, isPasskeyCancelled, passkeysAvailable } from '@/features/auth/providers/passkeys';
import { passkeyNameSchema, PASSKEY_NAME_MAX_LENGTH, type PasskeyNameValues } from '@/features/auth/schemas';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { hapticFor } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  ContextMenuButton,
  Dialog,
  ErrorState,
  Hairline,
  Icon,
  ListRow,
  SampleBadge,
  Sheet,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  TextInput,
  toast,
} from '@/ui';
import { RowGroup } from '@/ui/RowGroup';
import { identifierText } from '@/ui/textBreaks';

import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';
import { passkeyOwnName } from '../passkeyName';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-19';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  section: { gap: t.space[8] },
  // DQ-996: the row's actions sit behind its trailing "···" (44 target), as on every list.
  passkey: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], paddingLeft: ROW_INSET, paddingRight: t.space[4], paddingVertical: t.space[8] },
  passkeyHead: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: t.space[12], minWidth: 0 },
  passkeyText: { flex: 1, gap: t.space[2], minWidth: 0 },
  sample: { gap: t.space[8] },
  sheet: { gap: t.space[16], paddingBottom: t.space[16] },
  skeletonRows: { gap: t.space[12] },
}));

type Confirm = { kind: 'passkey'; passkey: Passkey } | { kind: 'provider'; provider: SocialProvider } | null;

function SignInSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        {[3, 2].map((rows, group) => (
          <View key={group} style={styles.section}>
            <SkeletonText variant="calloutStrong" width="40%" />
            <View style={styles.skeletonRows}>
              {Array.from({ length: rows }, (_, index) => (
                <SkeletonBlock key={index} height={size.row.single} corner="md" />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * "Sie verwenden keine Passkeys" never: an empty list shows how the member's own row will look, badged Beispiel (09 §8.19), and the
 * one action. DQ-997: no other person's device in a security list, only "Dein iPhone".
 */
function PasskeySample() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  return (
    <View style={styles.sample} testID={`${ROUTE}.passkeys.empty`}>
      <RowGroup title={t('signIn.passkeys')} testID={`${ROUTE}.passkeysGroup`}>
        <ListRow
          icon="key"
          title={t('signIn.sampleName')}
          subtitle={t('signIn.sampleMeta')}
          control={<SampleBadge />}
          testID={`${ROUTE}.passkeys.sample`}
        />
      </RowGroup>
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.passkeys.sampleCaption`}>
        {t('signIn.sampleCaption')} {t('signIn.emptyBody')}
      </Text>
    </View>
  );
}

/**
 * One passkey: glyph, name and its line (provider · created · last used), "Umbenennen" and "Entfernen" in the trailing "···" menu
 * (DQ-996). Recent authentication is asked when one is chosen.
 */
function PasskeyRow({
  passkey,
  meta,
  divider,
  disabled,
  onRename,
  onRemove,
}: {
  passkey: Passkey;
  meta: string;
  divider: boolean;
  disabled: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const testID = `${ROUTE}.passkey.${passkey.id}`;
  return (
    <View testID={testID}>
      <View style={styles.passkey}>
        <View style={styles.passkeyHead}>
          <Icon name="key" size={20} color="text.secondary" />
          <View style={styles.passkeyText}>
            <Text variant="body" hyphenate={false}>
              {passkey.name}
            </Text>
            <Text variant="callout" color="text.secondary">
              {meta}
            </Text>
          </View>
        </View>
        <ContextMenuButton
          label={t('signIn.passkeyActions', { name: passkey.name })}
          items={[
            { key: 'rename', label: t('signIn.rename'), icon: 'pencil-simple', disabled, onSelect: onRename },
            { key: 'remove', label: t('signIn.remove'), icon: 'trash', destructive: true, disabled, onSelect: onRemove },
          ]}
          testID={`${testID}.more`}
        />
      </View>
      {divider ? <Hairline inset={ROW_INSET} /> : null}
    </View>
  );
}

/**
 * SET-19 /settings/security/sign-in "Anmeldung & Passkeys" (09 §7 SET-19, §8.1, §8.2): the e-mail code (always on, with the address),
 * the password (set or change in SET-04), Apple and Google (link or unlink, behind their flags), and the passkeys (provider from the
 * AAGUID map, created, last used; add, rename, remove). Every change asks for recent authentication (the reauth sheet), and the server
 * never lets the last way in go (409 last_sign_in_method).
 */
export function SignInMethodsScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const readOnly = useViewAsReadOnly();
  const failure = useFailureMessage();
  const status = useSessionStore((state) => state.status);
  const passkeysOn = useFlag('auth.passkeys');
  const appleOn = useFlag('auth.apple');
  const googleOn = useFlag('auth.google');
  const me = useMe();
  const passkeys = usePasskeys(passkeysOn);
  const providers = useLinkedProviders(appleOn || googleOn);
  const addPasskey = useAddPasskey();
  const rename = useRenamePasskey();
  const remove = useDeletePasskey();
  const link = useLinkProvider();
  const unlink = useUnlinkProvider();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [linking, setLinking] = useState<SocialProvider | null>(null);

  const nameForm = useForm<PasskeyNameValues>({ resolver: zodResolver(passkeyNameSchema), defaultValues: { name: '' } });

  const fail = (error: unknown) => {
    if (isReauthCancelled(error) || isPasskeyCancelled(error)) return;
    const message =
      error instanceof ApiError && error.code === 'last_sign_in_method' ? t('signIn.lastMethod') : failure(error);
    toast(message, { haptic: 'warning', testID: `${ROUTE}.failed` });
  };

  const add = async () => {
    try {
      await addPasskey.mutateAsync({ create: (options) => createPasskey(options.options) });
      hapticFor('passkeyAdded');
      toast(t('signIn.added'), { testID: `${ROUTE}.toast` });
    } catch (error) {
      fail(error);
    }
  };

  const connect = async (provider: SocialProvider) => {
    setLinking(provider);
    try {
      const adapter = provider === 'apple' ? appleProvider : googleProvider;
      const rawNonce = await fetchProviderNonce(provider);
      const credential = await adapter.signIn(rawNonce);
      if (!credential) return;
      const idToken = 'identityToken' in credential ? credential.identityToken : credential.idToken;
      const authorizationCode = 'authorizationCode' in credential ? credential.authorizationCode : null;
      await link.mutateAsync({ provider, idToken, rawNonce, authorizationCode });
      toast(t('signIn.linked', { provider: t(`signIn.provider.${provider}`) }), { haptic: 'success', testID: `${ROUTE}.toast` });
    } catch (error) {
      fail(error);
    } finally {
      setLinking(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const target = confirm;
    try {
      if (target.kind === 'passkey') {
        await remove.mutateAsync(target.passkey.id);
        const own = passkeyOwnName(target.passkey.name);
        toast(own ? t('signIn.removed', { name: own }) : t('signIn.removedGeneric'), { testID: `${ROUTE}.toast` });
      } else {
        await unlink.mutateAsync(target.provider);
        toast(t('signIn.unlinked', { provider: t(`signIn.provider.${target.provider}`) }), { testID: `${ROUTE}.toast` });
      }
      setConfirm(null);
    } catch (error) {
      setConfirm(null);
      fail(error);
    }
  };

  const saveName = nameForm.handleSubmit(async ({ name }) => {
    if (!renaming) return;
    try {
      await rename.mutateAsync({ id: renaming.id, name });
      setRenaming(null);
      toast(t('signIn.renamed'), { testID: `${ROUTE}.toast` });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.name) {
        nameForm.setError('name', { type: 'server', message: error.fieldErrors.name.join(' ') });
      } else {
        setRenaming(null);
        fail(error);
      }
    }
  });

  const used = (passkey: Passkey) => {
    // DQ-999: the date as in a sentence, as the sample row has it.
    const created = t('signIn.created', { date: format.longDate(new Date(passkey.created_at)) });
    const last = passkey.last_used_at ? t('signIn.lastUsed', { time: format.relative(new Date(passkey.last_used_at)) }) : t('signIn.neverUsed');
    return [passkey.provider, created, last].filter(Boolean).join(' · ');
  };

  const providerRow = (provider: SocialProvider, linked: LinkedProvider | undefined, divider: boolean) => {
    const adapter = provider === 'apple' ? appleProvider : googleProvider;
    const name = t(`signIn.provider.${provider}`);
    const control = linked ? (
      <Button
        label={t('signIn.unlink')}
        variant="secondary"
        size="s"
        disabled={readOnly || !online}
        accessibilityLabel={t('signIn.unlinkNamed', { provider: name })}
        onPress={() => setConfirm({ kind: 'provider', provider })}
        testID={`${ROUTE}.${provider}.unlink`}
      />
    ) : adapter.isAvailable() ? (
      <Button
        label={t('signIn.link')}
        variant="secondary"
        size="s"
        loading={linking === provider}
        disabled={readOnly || !online || (linking !== null && linking !== provider)}
        accessibilityLabel={t('signIn.linkNamed', { provider: name })}
        onPress={() => void connect(provider)}
        testID={`${ROUTE}.${provider}.link`}
      />
    ) : undefined;
    return (
      <ListRow
        key={provider}
        icon={provider === 'apple' ? 'apple-logo' : 'sign-in'}
        title={name}
        subtitle={
          linked
            ? linked.is_private_relay
              ? t('signIn.privateRelay')
              : linked.email
                ? identifierText(linked.email)
                : t('signIn.connected')
            : adapter.isAvailable()
              ? t('signIn.notConnected')
              : t('signIn.unavailableHere')
        }
        control={control}
        divider={divider}
        testID={`${ROUTE}.${provider}`}
      />
    );
  };

  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/security/sign-in" />;
  } else if (qaState === 'loading' || status === 'loading' || me.isPending || (passkeysOn && passkeys.isPending && passkeys.fetchStatus !== 'paused')) {
    body = qaState === 'error' ? null : <SignInSkeleton />;
  }
  if (!body && status !== 'guest' && (qaState === 'error' || !me.data || (passkeysOn && passkeys.isError))) {
    const offline = !online || passkeys.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('signIn.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => {
          void me.refetch();
          if (passkeysOn) void passkeys.refetch();
        }}
        retrying={me.isFetching || passkeys.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  }
  if (!body && me.data) {
    const account = me.data;
    const list = qaState === 'empty' ? [] : (passkeys.data ?? []);
    const linked = providers.data ?? [];
    const socials = (['apple', 'google'] as const).filter((provider) =>
      provider === 'apple' ? appleOn || linked.some((row) => row.provider === 'apple') : googleOn || linked.some((row) => row.provider === 'google'),
    );
    body = (
      <View style={styles.body}>
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('signIn.intro')}
        </Text>
        {/* DQ-995 (ADR-426 e): grouped-list headers, as on every settings page. */}
        <View style={styles.section}>
          <RowGroup title={t('signIn.methods')} testID={`${ROUTE}.methods`}>
            <ListRow
              icon="envelope-simple"
              title={t('signIn.emailCode')}
              subtitle={identifierText(account.email)}
              value={t('signIn.alwaysOn')}
              // DQ-987: the address breaks only after "@", "." and "/", never with a hyphen of its own.
              hyphenate={false}
              divider
              testID={`${ROUTE}.emailCode`}
            />
            <ListRow
              icon="lock-simple"
              title={t('signIn.password')}
              subtitle={account.password_set ? t('signIn.passwordSet') : t('signIn.passwordNotSet')}
              role="link"
              chevron
              onPress={() => router.push('/settings/security/password')}
              divider={socials.length > 0}
              testID={`${ROUTE}.password`}
            />
            {socials.map((provider, index) =>
              providerRow(
                provider,
                linked.find((row) => row.provider === provider),
                index < socials.length - 1,
              ),
            )}
          </RowGroup>
        </View>
        {passkeysOn ? (
          <View style={styles.section}>
            {list.length === 0 ? (
              <PasskeySample />
            ) : (
              <RowGroup title={t('signIn.passkeys')} testID={`${ROUTE}.passkeys`}>
                {list.map((passkey, index) => (
                  <PasskeyRow
                    key={passkey.id}
                    passkey={passkey}
                    meta={used(passkey)}
                    divider={index < list.length - 1}
                    disabled={readOnly || !online}
                    onRename={() => {
                      // DQ-999: the generic fallback is no name to offer; the field starts empty.
                      nameForm.reset({ name: passkeyOwnName(passkey.name) ?? '' });
                      setRenaming(passkey);
                    }}
                    onRemove={() => setConfirm({ kind: 'passkey', passkey })}
                  />
                ))}
              </RowGroup>
            )}
            {passkeysAvailable() ? (
              <Button
                label={t('signIn.add')}
                variant="secondary"
                size="m"
                icon="plus"
                loading={addPasskey.isPending}
                disabled={readOnly || !online || !account.email_verified}
                onPress={() => void add()}
                testID={`${ROUTE}.add`}
              />
            ) : (
              <Text variant="callout" color="text.secondary" testID={`${ROUTE}.notHere`}>
                {t('signIn.notOnThisDevice')}
              </Text>
            )}
            {!account.email_verified ? (
              <Text variant="callout" color="text.secondary" testID={`${ROUTE}.verifyFirst`}>
                {t('signIn.verifyFirst')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  const busy = remove.isPending || unlink.isPending;
  const confirmName =
    confirm?.kind === 'passkey' ? confirm.passkey.name : confirm ? t(`signIn.provider.${confirm.provider}`) : '';

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('signIn.title')}
      fallback="/settings"
      offlineLabel={t('signIn.offlineBanner')}
      section="signIn"
      overlays={
        <>
          <Dialog
            visible={confirm !== null}
            onClose={busy ? undefined : () => setConfirm(null)}
            title={
              confirm?.kind === 'provider'
                ? t('signIn.confirmUnlinkTitle', { provider: confirmName })
                : confirm?.kind === 'passkey' && !passkeyOwnName(confirm.passkey.name)
                  ? t('signIn.confirmRemoveTitleGeneric')
                  : t('signIn.confirmRemoveTitle', { name: confirmName })
            }
            body={confirm?.kind === 'provider' ? t('signIn.confirmUnlinkBody') : t('signIn.confirmRemoveBody')}
            testID={`${ROUTE}.dialog`}
            actions={[
              { label: t('common.cancel'), variant: 'secondary', disabled: busy, onPress: () => setConfirm(null), testID: `${ROUTE}.dialog.cancel` },
              {
                label: confirm?.kind === 'provider' ? t('signIn.unlink') : t('signIn.remove'),
                destructive: true,
                loading: busy,
                onPress: () => {
                  hapticFor('destructiveConfirm');
                  void runConfirm();
                },
                testID: `${ROUTE}.dialog.confirm`,
              },
            ]}
          />
          <Sheet
            visible={renaming !== null}
            onClose={rename.isPending ? () => undefined : () => setRenaming(null)}
            title={t('signIn.renameTitle')}
            expandable={false}
            testID={`${ROUTE}.renameSheet`}
            footer={
              <Button
                label={t('signIn.save')}
                size="l"
                fullWidth
                loading={rename.isPending}
                onPress={() => void saveName()}
                testID={`${ROUTE}.renameSheet.save`}
              />
            }
          >
            <View style={styles.sheet}>
              <Controller
                control={nameForm.control}
                name="name"
                render={({ field, fieldState }) => (
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    label={t('signIn.nameLabel')}
                    maxLength={PASSKEY_NAME_MAX_LENGTH}
                    error={fieldState.error ? (fieldState.error.type === 'server' ? fieldState.error.message : t(`signIn.${fieldState.error.message ?? ''}` as never)) : undefined}
                    returnKeyType="done"
                    onSubmitEditing={() => void saveName()}
                    testID={`${ROUTE}.renameSheet.name`}
                  />
                )}
              />
            </View>
          </Sheet>
        </>
      }
    >
      {body}
    </SettingsPage>
  );
}
