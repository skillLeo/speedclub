import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Checkbox, Sheet, Text, toast } from '@/ui';
import { SlotText } from '@/ui/SlotText';
import { PRODUCT_NAMES } from '@/ui/textBreaks';

import { copyText, RECOVERY_FILE_NAME, recoveryCodesText, saveTextFile } from '../recoveryCodes';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  codes: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    columnGap: t.space[24],
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: t.space[16],
    rowGap: t.space[8],
  },
  // Two columns while they fit, one under the other at a large font.
  code: { flexBasis: '40%', flexGrow: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
}));

export type RecoveryCodesSheetProps = {
  /** Null closes the sheet. The codes live only in the parent's state and go when it clears them. */
  codes: readonly string[] | null;
  /** After "Ich habe sie gesichert" and Fertig. */
  onDone: () => void;
  testID: string;
};

/**
 * SET-05: the ten codes, shown once. Copy and download, then the confirm: the sheet cannot be dismissed before the member says
 * the codes are saved, because they will never be shown again.
 */
export function RecoveryCodesSheet({ codes, onDone, testID }: RecoveryCodesSheetProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const visible = codes !== null;

  const finish = () => {
    setSaved(false);
    onDone();
  };
  const text = () => recoveryCodesText(codes ?? [], t('twoFactor.codesFileHeading'), t('twoFactor.codesFileUsage'));
  const copy = async () => {
    try {
      await copyText(text());
      toast(t('twoFactor.codesCopied'), { testID: `${testID}.copied` });
    } catch {
      toast(t('twoFactor.copyFailed'), { haptic: 'warning', testID: `${testID}.copyFailed` });
    }
  };
  const download = async () => {
    setSaving(true);
    try {
      await saveTextFile(text(), RECOVERY_FILE_NAME, t('twoFactor.codesTitle'));
    } catch {
      toast(t('twoFactor.downloadFailed'), { haptic: 'warning', testID: `${testID}.downloadFailed` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => undefined}
      title={t('twoFactor.codesTitle')}
      dismissable={false}
      initialSnap="full"
      testID={testID}
      footer={
        <Button label={t('twoFactor.codesDone')} size="l" fullWidth disabled={!saved} onPress={finish} testID={`${testID}.done`} />
      }
    >
      <View style={styles.body}>
        <SlotText variant="body" color="text.secondary" text={t('twoFactor.codesBody')} keep={PRODUCT_NAMES} />
        <View style={styles.codes} testID={`${testID}.list`}>
          {(codes ?? []).map((code) => (
            <Text key={code} variant="body" numeric selectable style={styles.code}>
              {code}
            </Text>
          ))}
        </View>
        <View style={styles.actions}>
          <Button label={t('twoFactor.copyCodes')} variant="secondary" size="m" icon="copy" onPress={() => void copy()} testID={`${testID}.copy`} />
          <Button
            label={t('twoFactor.downloadCodes')}
            variant="secondary"
            size="m"
            icon="download-simple"
            loading={saving}
            onPress={() => void download()}
            testID={`${testID}.download`}
          />
        </View>
        <Checkbox checked={saved} onChange={setSaved} label={t('twoFactor.codesSaved')} showLabel alignFirstLine testID={`${testID}.saved`} />
      </View>
    </Sheet>
  );
}
