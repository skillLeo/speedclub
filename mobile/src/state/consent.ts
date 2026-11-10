/**
 * What the device knows about re-consent (ADR-236 f, ADR-245) between starts, and the moment a member accepted.
 *
 * Clearance (code review phase-3-final MF-2): once `GET`/`POST me/consents` answered `required: []` for a member and app-config's
 * re-consent version pair, the device keeps `{ member, terms, privacy }` (no name, no address, no token). An offline start, where the
 * consent state cannot be read, then shows nothing over the app when the cached app-config names that same pair for the member signed
 * in; any other pair, another member or no record keeps the blocking sheet (fail closed). It never weakens the gate: offline nothing is
 * written, and the server refuses every write without the consent anyway (ADR-245). A refusal with 403 `consent_required`, a member
 * change and a sign-out forget the record. A view-as or preview tab neither reads nor writes it (api/ephemeralTab.ts).
 *
 * Accepted (code review phase-3-final SF-2): `notifyConsentAccepted` tells whoever held work back for the consent, the message outbox,
 * that writes go through again.
 */
import { create } from 'zustand';

import { keepsNothingOnDisk } from '@/api/ephemeralTab';
import { getStored, removeStored, setStored } from '@/lib/storage';

export type ReconsentPair = { terms: string | null; privacy: string | null };

export type ConsentClearance = { member: string } & ReconsentPair;

const KEY = 'sc.consentCleared';

type ClearanceState = {
  /** The device's record has been read (or there is none to read in this tab). Until then an offline start cannot know. */
  loaded: boolean;
  record: ConsentClearance | null;
};

export const useConsentClearance = create<ClearanceState>(() => ({ loaded: false, record: null }));

/** Each write bumps it, so a slow first read never overwrites what this run already learned. */
let generation = 0;
let hydrating: Promise<void> | null = null;

function versionOrNull(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined;
}

export function parseClearance(raw: string | null): ConsentClearance | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { member, terms, privacy } = parsed as Record<string, unknown>;
    const t = versionOrNull(terms);
    const p = versionOrNull(privacy);
    if (typeof member !== 'string' || member === '' || t === undefined || p === undefined) return null;
    return { member, terms: t, privacy: p };
  } catch {
    return null;
  }
}

/** Reads the device's record once per run. */
export function hydrateConsentClearance(): Promise<void> {
  if (useConsentClearance.getState().loaded) return Promise.resolve();
  if (keepsNothingOnDisk()) {
    useConsentClearance.setState({ loaded: true, record: null });
    return Promise.resolve();
  }
  if (!hydrating) {
    const started = generation;
    hydrating = getStored(KEY).then((raw) => {
      hydrating = null;
      if (generation !== started) return;
      useConsentClearance.setState({ loaded: true, record: parseClearance(raw) });
    });
  }
  return hydrating;
}

/** Whether the record clears this member for this pair. A member without an id is never cleared. */
export function clearsConsent(record: ConsentClearance | null, member: string | null, pair: ReconsentPair): boolean {
  return record !== null && !!member && record.member === member && record.terms === pair.terms && record.privacy === pair.privacy;
}

/** The server answered `required: []` for this member and pair. */
export function rememberConsentClearance(member: string, pair: ReconsentPair): void {
  if (!member || keepsNothingOnDisk()) return;
  const { record } = useConsentClearance.getState();
  if (clearsConsent(record, member, pair)) return;
  generation += 1;
  const next: ConsentClearance = { member, terms: pair.terms, privacy: pair.privacy };
  useConsentClearance.setState({ loaded: true, record: next });
  void setStored(KEY, JSON.stringify(next));
}

/** The server refused for the consent, the member changed, or the session ended: the device knows nothing any more. */
export async function forgetConsentClearance(): Promise<void> {
  if (keepsNothingOnDisk()) return;
  generation += 1;
  const { loaded, record } = useConsentClearance.getState();
  if (record !== null || !loaded) useConsentClearance.setState({ loaded: true, record: null });
  await removeStored(KEY);
}

const acceptedListeners = new Set<() => void>();

/** Hears each successful accept (`POST me/consents` answering `required: []`). */
export function onConsentAccepted(listener: () => void): () => void {
  acceptedListeners.add(listener);
  return () => {
    acceptedListeners.delete(listener);
  };
}

export function notifyConsentAccepted(): void {
  acceptedListeners.forEach((listener) => listener());
}

/** Tests only. */
export function resetConsentClearanceForTests(): void {
  generation += 1;
  hydrating = null;
  useConsentClearance.setState({ loaded: false, record: null });
}
