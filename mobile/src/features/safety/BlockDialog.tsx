import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useBlockMember } from '@/api/queries/social';
import { forgetConversationsWith, useMessagingMember } from '@/features/messages/cachedInbox';
import { Dialog, toast } from '@/ui';

export type BlockDialogProps = {
  /** The member to block, without the @. Null closes the dialog. */
  username: string | null;
  onClose: () => void;
  /** After the server confirmed: leave the page of the blocked member. The toast is shown here. */
  onBlocked: (username: string) => void;
  /**
   * `blockAndReport` (MSG-04 "Blockieren & melden", contract §5): the same block, worded as the first of two steps; the caller opens
   * the report sheet for the same target in `onBlocked`, before it leaves the page.
   */
  variant?: 'block' | 'blockAndReport';
  /** `<ROUTE-ID>.blockDialog`, with `.cancel` and `.confirm`. */
  testID: string;
};

/**
 * The block dialog of SAFE (02_PRODUCT_SPEC §3.5): "@name blockieren?" and what it does, both ways, then a destructive
 * confirm. It waits for the server, so it never says "blockiert" for a block that did not happen; a failure stays in the
 * dialog as a toast and the member can try again. Nothing here says whether the other member has blocked the viewer. The
 * haptic is §10's warning for a destructive confirm, which Dialog plays on the press; no success haptic follows (DQ-272).
 */
export function BlockDialog({ username, onClose, onBlocked, variant = 'block', testID }: BlockDialogProps) {
  const { t } = useTranslation('safety');
  const block = useBlockMember();
  const client = useQueryClient();
  const member = useMessagingMember();
  const handle = `@${username ?? ''}`;
  const andReport = variant === 'blockAndReport';

  const confirm = () => {
    if (!username) return;
    block.mutate(username, {
      onSuccess: () => {
        // The server closed the pair's chats: their cached rows go too, so no list or the quick switcher shows them again.
        if (member) forgetConversationsWith(client, member, username);
        onBlocked(username);
        toast(t('block.done', { name: handle }), { testID: `${testID}.toast` });
      },
      onError: (error) => toast(error.message || t('block.failed'), { haptic: 'warning', testID: `${testID}.error` }),
    });
  };

  return (
    <Dialog
      visible={username !== null}
      onClose={block.isPending ? undefined : onClose}
      title={t(andReport ? 'block.reportTitle' : 'block.title', { name: handle })}
      body={t(andReport ? 'block.reportBody' : 'block.body', { name: handle })}
      testID={testID}
      actions={[
        { label: t('block.cancel'), variant: 'secondary', disabled: block.isPending, onPress: onClose, testID: `${testID}.cancel` },
        {
          label: t(andReport ? 'block.reportConfirm' : 'block.confirm'),
          destructive: true,
          loading: block.isPending,
          onPress: confirm,
          testID: `${testID}.confirm`,
        },
      ]}
    />
  );
}
