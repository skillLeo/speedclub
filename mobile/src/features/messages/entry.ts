/**
 * The ways into messaging from other screens (contract §7): PROF-02 "Nachricht", VEH-01 "Nachricht" in the owner row (with the
 * vehicle as the conversation's context) and VEH-01 "Fahrzeug senden" (the vehicle as a card). All open MSG-03, which goes straight
 * to an existing thread when nothing has to be sent first.
 */
import { useMe } from '@/api/queries/auth';

export type NewMessageParams = {
  /** The recipient's username: the picker is skipped. */
  to?: string;
  /** A vehicle's slug as the conversation's context ("Fahrzeug von @…"): the first message is text. */
  about?: string;
  /** A vehicle's slug to send as a card. */
  vehicle?: string;
};

export function newMessageHref(params: NewMessageParams) {
  const defined = Object.fromEntries(Object.entries(params).filter(([, value]) => typeof value === 'string' && value !== '')) as Record<string, string>;
  return { pathname: '/new-message', params: defined } as const;
}

/** Why "Nachricht" is off for a member: your own account first, otherwise the other member does not take messages from you. */
export type MessageBlock = 'unverified' | 'restricted' | 'closed';

/** Null when `canMessage`; otherwise the reason, as far as your own account explains it. */
export function useMessageBlock(canMessage: boolean): MessageBlock | null {
  const me = useMe().data;
  if (canMessage) return null;
  if (me && !me.email_verified) return 'unverified';
  if (me?.restrictions.messaging.restricted || me?.restrictions.suspended) return 'restricted';
  return 'closed';
}
