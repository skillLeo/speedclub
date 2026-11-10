/**
 * The messaging state that outlives a screen: the outbox and the realtime hub. Both belong to the member signed in (ADR-175,
 * ADR-182, ADR-185). Whatever ends or changes the session (sign-out, expiry, a member change in another tab) disposes the outbox
 * and tears the hub down, before the next member's screens can mount, so nothing typed by one member is ever sent or shown for
 * another. A sign-out does it first of all (`beforeSignOut`), while the old session still exists, so no queued message slips out
 * between the abort and the end.
 */
import { onlineManager } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';

import { beforeSignOut } from '@/api/queries/auth';
import { isWeb } from '@/lib/platform';
import { onConsentAccepted } from '@/state/consent';
import { useSessionStore } from '@/state/session';

import type { MessagingAdapter } from './data';
import { createOutbox, type LocalPhoto, type Outbox, type OutboxEntry } from './outbox';
import { realtimeHub } from './realtime';

let current: Outbox | null = null;

/**
 * The JPEG prepared for a message photo lives in the app's cache until the photo is sent or dropped, then it goes (review 6). On web
 * the photo is a data URI in memory and nothing is on disk.
 */
export function deletePreparedPhoto(photo: LocalPhoto): void {
  if (isWeb || !photo.uri.startsWith('file:')) return;
  const file = new File(photo.uri);
  if (file.exists) file.delete();
}
const changeListeners = new Set<() => void>();

function emitChange(): void {
  changeListeners.forEach((listener) => listener());
}

/** Ends the messaging session: the outbox is forgotten and the socket closed. */
export function endMessagingSession(): void {
  const outbox = current;
  current = null;
  outbox?.dispose();
  realtimeHub.teardown();
  if (outbox) emitChange();
}

function memberIdOf(state: ReturnType<typeof useSessionStore.getState>): string | null {
  return state.status === 'member' && !state.memberChanged ? (state.member?.id ?? null) : null;
}

/** The outbox of `memberId`, made on first use. Null for nobody. Another member's outbox is ended first. */
export function outboxFor(memberId: string | null, adapter: MessagingAdapter): Outbox | null {
  if (!memberId || !adapter.available) return null;
  if (current && current.memberId === memberId && !current.disposed) return current;
  if (current) endMessagingSession();
  const outbox = createOutbox({
    memberId,
    transport: adapter.transport,
    classify: adapter.classify,
    online: onlineManager.isOnline(),
    newId: () => Crypto.randomUUID(),
    onDelivered: (conversationId, message) => adapter.insertDelivered(memberId, conversationId, message),
    onFailed: (conversationId, failure) => adapter.sendRejected(memberId, conversationId, failure),
    releasePhoto: deletePreparedPhoto,
  });
  // No change event here: this runs during a render, and every other screen gets the same outbox from this function.
  current = outbox;
  return outbox;
}

/** Tests only: the outbox in use. */
export function currentOutbox(): Outbox | null {
  return current;
}

// The session store is the one truth about who is signed in. Any change of member, or none, ends messaging.
let lastMember = memberIdOf(useSessionStore.getState());
useSessionStore.subscribe((state) => {
  const member = memberIdOf(state);
  if (member === lastMember) return;
  lastMember = member;
  endMessagingSession();
});

beforeSignOut(async () => {
  endMessagingSession();
});

onlineManager.subscribe((online) => current?.setOnline(online));

// SF-2: a message refused for the missing re-consent goes out once the member accepted.
onConsentAccepted(() => current?.resumeAfterConsent());

function subscribeChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** The member signed in, as messaging sees it: nobody while the session changes hands (ADR-182). */
export function useMessagingMember(): string | null {
  return useSessionStore(memberIdOf);
}

/** The outbox of the member signed in, or null. */
export function useOutbox(adapter: MessagingAdapter): Outbox | null {
  const member = useMessagingMember();
  // Re-render when the outbox is replaced or ended.
  useSyncExternalStore(subscribeChange, () => current, () => current);
  return outboxFor(member, adapter);
}

const NO_ENTRIES: readonly OutboxEntry[] = [];
const noop = () => () => undefined;

/** The entries of one conversation, live. */
export function useOutboxEntries(outbox: Outbox | null, conversationId: string | undefined): readonly OutboxEntry[] {
  return useSyncExternalStore(
    outbox ? (listener) => outbox.subscribe(listener) : noop,
    () => (outbox && conversationId ? outbox.entries(conversationId) : NO_ENTRIES),
    () => NO_ENTRIES,
  );
}

/**
 * Connects the realtime hub for the member signed in while a messaging screen is mounted, when app-config allows it. The hub
 * stays configured across screens; the session change above tears it down.
 */
export function useRealtimeSession(adapter: MessagingAdapter): void {
  const member = useMessagingMember();
  const config = adapter.useRealtimeConfig();
  const { enabled, key, cluster } = config;
  useEffect(() => {
    if (!member || !adapter.available) return;
    realtimeHub.configure({ memberId: member, config: { enabled, key, cluster }, authorize: adapter.authorizeChannel });
  }, [adapter, cluster, enabled, key, member]);
}

/** Whether the socket is connected now, for the poller. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(realtimeHub.status.subscribe, realtimeHub.status.get, () => false);
}
