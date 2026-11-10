import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useReissueQr } from '@/api/queries/qr';
import { keepNameTogether } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { Dialog, toast } from '@/ui';

export type ReissueDialogProps = {
  visible: boolean;
  onClose: () => void;
  vehicleId: string;
};

/**
 * "QR-Code ersetzen" (FS-9, §3.4): the dialog says that the old sticker stops working, the destructive action comes last and
 * filled. One idempotency key per intent, so a retry after a lost answer cannot replace the code twice.
 */
export function ReissueDialog({ visible, onClose, vehicleId }: ReissueDialogProps) {
  const { t } = useTranslation('qr');
  const reissue = useReissueQr(vehicleId);
  // Made at the first confirm and kept for its retries; a new opening of the dialog is a new intent.
  const key = useRef<string | null>(null);

  const close = () => {
    if (reissue.isPending) return;
    key.current = null;
    reissue.reset();
    onClose();
  };

  const confirm = () => {
    const idempotencyKey = key.current ?? newIdempotencyKey();
    key.current = idempotencyKey;
    reissue.mutate(idempotencyKey, {
      onSuccess: () => {
        key.current = null;
        onClose();
        haptics.success();
        toast(t('reissue.done'), { testID: 'QR-02.reissueToast' });
      },
      onError: (error) => {
        // Staff took the code down meanwhile: the page shows the blocked state, there is nothing to retry.
        if (error instanceof ApiError && error.code === 'qr_revoked_by_staff') {
          key.current = null;
          onClose();
          return;
        }
        // The server's words may write "QR-Code" with a plain hyphen (DQ-162): keep it on one line.
        toast(error instanceof ApiError ? keepNameTogether(error.message) : t('reissue.failed'), { testID: 'QR-02.reissueError' });
      },
    });
  };

  return (
    <Dialog
      visible={visible}
      onClose={close}
      title={t('reissue.title')}
      body={t('reissue.body')}
      actions={[
        { label: t('reissue.cancel'), variant: 'secondary', onPress: close, disabled: reissue.isPending, testID: 'QR-02.reissueCancel' },
        { label: t('reissue.confirm'), destructive: true, onPress: confirm, loading: reissue.isPending, testID: 'QR-02.reissueConfirm' },
      ]}
      testID="QR-02.reissueDialog"
    />
  );
}
