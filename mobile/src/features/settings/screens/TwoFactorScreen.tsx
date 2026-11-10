import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { ApiError } from '@/api/client';
import { meKey, type Me } from '@/api/queries/auth';
import { CodeInput } from '@/features/auth/components/CodeInput';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { isCode } from '@/features/auth/forms';
import { CODE_LENGTH } from '@/features/auth/schemas';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { isNative } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { Button, Dialog, QRDisplay, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';

import { twoFactorEnabledOf } from '../account';
import { useMemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { ReauthSheet } from '../components/ReauthSheet';
import { RecoveryCodesSheet } from '../components/RecoveryCodesSheet';
import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { useFailureMessage } from '../forms';
import {
  useConfirmTwoFactor,
  useDisableTwoFactor,
  useRegenerateRecoveryCodes,
  useStartTwoFactor,
  type TwoFactorSetup,
} from '@/api/queries/settings';
import { copyText, groupSecret } from '../recoveryCodes';

const ROUTE = 'SET-05';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  block: { gap: t.space[12] },
  status: { gap: t.space[4], padding: t.space[16] },
  actions: { alignItems: 'flex-start', gap: t.space[8] },
  steps: { gap: t.space[8] },
}));

function TwoFactorSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={3} />
        <SkeletonBlock height={size.row.withThumb} corner="md" />
        <SkeletonBlock height={size.button.l} corner="sm" />
      </View>
    </Skeleton>
  );
}

type Sheet = 'start' | 'regenerate' | 'disable' | null;

/**
 * SET-05 /settings/security/two-factor. Off: what it does, then the password, then the QR code with the key to copy and the six
 * digits that confirm it, then the ten recovery codes, once. On: new recovery codes, or off, each with password and code. The
 * key and the codes live only in this screen's state; leaving drops them.
 */
function TwoFactorContent({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const client = useQueryClient();
  const failure = useFailureMessage();
  const start = useStartTwoFactor();
  const confirm = useConfirmTwoFactor();
  const regenerate = useRegenerateRecoveryCodes();
  const disable = useDisableTwoFactor();
  const reported = twoFactorEnabledOf(me);
  const [enabled, setEnabled] = useState(reported === true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirmingOff, setConfirmingOff] = useState<{ password: string; code: string } | null>(null);

  const refreshMe = () => void client.invalidateQueries({ queryKey: meKey });

  const confirmCode = async (value: string) => {
    if (confirm.isPending || value.length !== CODE_LENGTH) {
      if (value.length !== CODE_LENGTH) setCodeError(t('validation.codeInvalid'));
      return;
    }
    setNotice(null);
    try {
      const recovery = await confirm.mutateAsync(value);
      setSetup(null);
      setCode('');
      setEnabled(true);
      setCodes(recovery);
      refreshMe();
    } catch (error) {
      if (isCode(error, 'invalid_code') || (error instanceof ApiError && 'code' in error.fieldErrors)) {
        setCode('');
        setCodeError(t('twoFactor.invalidCode'));
      } else {
        setNotice(failure(error));
      }
    }
  };

  const copyKey = async () => {
    if (!setup) return;
    try {
      await copyText(setup.secret);
      toast(t('twoFactor.keyCopied'), { testID: `${ROUTE}.keyCopied` });
    } catch {
      toast(t('twoFactor.copyFailed'), { haptic: 'warning', testID: `${ROUTE}.copyFailed` });
    }
  };

  const turnOff = async () => {
    if (!confirmingOff) return;
    try {
      await disable.mutateAsync(confirmingOff);
      setConfirmingOff(null);
      setEnabled(false);
      refreshMe();
      toast(t('twoFactor.turnedOff'), { testID: `${ROUTE}.turnedOff` });
    } catch (error) {
      setConfirmingOff(null);
      setNotice(error instanceof ApiError ? error.message : failure(error));
    }
  };

  let body: ReactNode;
  if (setup) {
    body = (
      <View style={styles.body} testID={`${ROUTE}.setup`}>
        <View style={styles.steps}>
          <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('twoFactor.scanTitle')}
          </Text>
          <Text variant="body" color="text.secondary">
            {t('twoFactor.scanBody')}
          </Text>
        </View>
        <QRDisplay svg={setup.qrSvg} label={t('twoFactor.qrLabel')} code={groupSecret(setup.secret)} testID={`${ROUTE}.qr`} />
        <View style={styles.actions}>
          <Button label={t('twoFactor.copyKey')} variant="secondary" size="m" icon="copy" onPress={() => void copyKey()} testID={`${ROUTE}.copyKey`} />
          {isNative ? (
            <Button
              label={t('twoFactor.openApp')}
              variant="tertiary"
              size="m"
              flush="start"
              onPress={() => void Linking.openURL(setup.otpauthUrl).catch(() => toast(t('twoFactor.noApp'), { testID: `${ROUTE}.noApp` }))}
              testID={`${ROUTE}.openApp`}
            />
          ) : null}
        </View>
        <View style={styles.block}>
          <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('twoFactor.confirmTitle')}
          </Text>
          {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setCodeError(undefined);
            }}
            onComplete={(value) => void confirmCode(value)}
            label={t('twoFactor.codeLabel')}
            error={codeError}
            disabled={confirm.isPending}
            testID={`${ROUTE}.code`}
          />
        </View>
      </View>
    );
  } else {
    body = (
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} />
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('twoFactor.intro')}
        </Text>
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
        <RowGroup>
          <View style={styles.status} testID={`${ROUTE}.status`}>
            <Text variant="bodyStrong">{t(enabled ? 'twoFactor.statusOn' : 'twoFactor.statusOff')}</Text>
            <Text variant="supporting" color="text.secondary">
              {t(enabled ? 'twoFactor.statusOnBody' : 'twoFactor.statusOffBody')}
            </Text>
          </View>
        </RowGroup>
        {enabled ? (
          <View style={styles.actions}>
            <Button
            disabled={readOnly}
              label={t('twoFactor.newCodes')}
              variant="secondary"
              size="m"
              onPress={() => setSheet('regenerate')}
              testID={`${ROUTE}.newCodes`}
            />
            <Button
            disabled={readOnly}
              label={t('twoFactor.turnOff')}
              variant="destructive"
              size="m"
              onPress={() => setSheet('disable')}
              testID={`${ROUTE}.turnOff`}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('twoFactor.title')}
      fallback="/settings"
      offlineLabel={t('offlineForm')}
      section="twoFactor"
      form={{
        // A key shown and not yet confirmed: leaving would leave the set-up half done.
        dirty: setup !== null && !confirm.isPending,
        cta: setup
          ? { label: t('twoFactor.confirm'), onPress: () => void confirmCode(code), loading: confirm.isPending }
          : enabled
            ? undefined
            : { label: t('twoFactor.setUp'), onPress: () => setSheet('start') },
      }}
      overlays={
        <>
          <ReauthSheet
            visible={sheet === 'start'}
            onClose={() => setSheet(null)}
            title={t('twoFactor.startTitle')}
            body={t('twoFactor.startBody')}
            confirmLabel={t('twoFactor.continue')}
            onConfirm={async ({ password }) => {
              const next = await start.mutateAsync(password);
              setNotice(null);
              setSetup(next);
              setSheet(null);
            }}
            testID={`${ROUTE}.startSheet`}
          />
          <ReauthSheet
            visible={sheet === 'regenerate'}
            onClose={() => setSheet(null)}
            title={t('twoFactor.newCodesTitle')}
            body={t('twoFactor.newCodesBody')}
            confirmLabel={t('twoFactor.newCodesConfirm')}
            needsCode
            onConfirm={async ({ password, code: second }) => {
              const next = await regenerate.mutateAsync({ password, code: second ?? '' });
              setSheet(null);
              setCodes(next);
            }}
            testID={`${ROUTE}.newCodesSheet`}
          />
          <ReauthSheet
            visible={sheet === 'disable'}
            onClose={() => setSheet(null)}
            title={t('twoFactor.turnOffTitle')}
            body={t('twoFactor.turnOffBody')}
            confirmLabel={t('twoFactor.continue')}
            needsCode
            onConfirm={async ({ password, code: second }) => {
              setSheet(null);
              setConfirmingOff({ password, code: second ?? '' });
            }}
            testID={`${ROUTE}.turnOffSheet`}
          />
          <Dialog
            visible={confirmingOff !== null}
            onClose={disable.isPending ? undefined : () => setConfirmingOff(null)}
            title={t('twoFactor.turnOffDialogTitle')}
            body={t('twoFactor.turnOffDialogBody')}
            testID={`${ROUTE}.turnOffDialog`}
            actions={[
              {
                label: t('common.cancel'),
                variant: 'secondary',
                disabled: disable.isPending,
                onPress: () => setConfirmingOff(null),
                testID: `${ROUTE}.turnOffDialog.cancel`,
              },
              {
                label: t('twoFactor.turnOffConfirm'),
                destructive: true,
                loading: disable.isPending,
                onPress: () => void turnOff(),
                testID: `${ROUTE}.turnOffDialog.confirm`,
              },
            ]}
          />
          <RecoveryCodesSheet codes={codes} onDone={() => setCodes(null)} testID={`${ROUTE}.codes`} />
        </>
      }
    >
      {body}
    </SettingsPage>
  );
}

export function TwoFactorScreen() {
  const { t } = useTranslation('settings');
  const gate = useMemberGate({ routeId: ROUTE, returnTo: '/settings/security/two-factor', skeleton: <TwoFactorSkeleton /> });
  if (gate.me) return <TwoFactorContent me={gate.me} />;
  return (
    <SettingsPage routeId={ROUTE} title={t('twoFactor.title')} fallback="/settings" offlineLabel={t('offlineForm')} section="twoFactor">
      {gate.fallback}
    </SettingsPage>
  );
}
