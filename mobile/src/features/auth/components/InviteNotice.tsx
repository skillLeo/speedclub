import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useInviteLookup } from '@/api/queries/invites';
import '@/features/gift/qaGift';

import { forgetInviteCode, heldInviteCode } from '../inviteCode';
import { FormNotice } from './FormNotice';

/**
 * M5.9d (contract §5): on the sign-up steps (AUTH-12, AUTH-04) while a `/join/{code}` code is held. "Du wurdest von @… eingeladen"
 * only when the API names the inviter's public handle; otherwise that the code comes along. A code the API calls unknown or used is
 * dropped, so it never blocks the sign-up, and the member is told.
 */
export function InviteNotice({ routeId }: { routeId: string }) {
  const { t } = useTranslation('auth');
  // The code as the screen opened: it stays on screen (and in its lookup) after an unknown one is dropped.
  const [code] = useState(heldInviteCode);
  const lookup = useInviteLookup(code);
  const invalid = lookup.data?.status === 'invalid';

  useEffect(() => {
    if (invalid) forgetInviteCode();
  }, [invalid]);

  if (invalid) return <FormNotice tone="info" message={t('invite.invalid')} testID={`${routeId}.invite`} />;
  if (!code) return null;
  const inviter = lookup.data?.status === 'valid' ? lookup.data.inviter : null;
  return (
    <FormNotice
      tone="info"
      message={inviter ? t('invite.by', { username: inviter.username }) : t('invite.held', { code })}
      testID={`${routeId}.invite`}
    />
  );
}
