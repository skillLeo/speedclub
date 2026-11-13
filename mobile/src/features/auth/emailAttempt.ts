/**
 * The e-mail code attempt of AUTH-12/13 (09 §8.1, ADR-429 b). The app makes the attempt id and keeps it with the address on this
 * device, because the mail's "Anmelden" link carries only the token (`/auth/magic#t=…`): the link signs in only where this
 * attempt is kept. Elsewhere WEB-12 says to type the code in the app.
 *
 * Memory for the screens; the device keeps a copy for the magic link (native keychain; web localStorage, which a link opened in a
 * new tab can read). It holds no code and no token, lives 15 minutes (the code lives 10), and goes with a sign-in.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { isWeb } from '@/lib/platform';
import { getStored, removeStored, setStored, type StorageKey } from '@/lib/storage';
import { useSessionStore } from '@/state/session';

const STORAGE_KEY = 'sc.emailAttempt' satisfies StorageKey;
export const ATTEMPT_TTL_MS = 15 * 60 * 1000;

export type EmailAttempt = {
  attemptId: string;
  email: string;
  /** When the next code may be asked for (ms since epoch). */
  resendAt: number;
  createdAt: number;
};

let current: EmailAttempt | null = null;

/** A new attempt id: a UUID, which the server's pattern (22–64 of A–Z a–z 0–9 _ -) accepts. */
export function newAttemptId(): string {
  return Crypto.randomUUID();
}

async function persist(attempt: EmailAttempt | null): Promise<void> {
  try {
    if (isWeb) {
      if (attempt) await setStored(STORAGE_KEY, JSON.stringify(attempt));
      else await removeStored(STORAGE_KEY);
      return;
    }
    if (attempt) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(attempt));
    else await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch (error) {
    // Without storage the code still works; only the magic link needs the copy.
    console.warn('Could not keep the sign-in attempt', error);
  }
}

function isAttempt(value: unknown): value is EmailAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const attempt = value as Record<string, unknown>;
  return (
    typeof attempt.attemptId === 'string' &&
    typeof attempt.email === 'string' &&
    typeof attempt.resendAt === 'number' &&
    typeof attempt.createdAt === 'number'
  );
}

export function holdEmailAttempt(attempt: EmailAttempt): void {
  current = attempt;
  void persist(attempt);
}

/** The attempt the screens work with, while it can still work. */
export function heldEmailAttempt(now: number = Date.now()): EmailAttempt | null {
  if (!current || now - current.createdAt > ATTEMPT_TTL_MS) return null;
  return current;
}

/** The device's copy, for the magic link (another tab, or the app opened by the link). */
export async function storedEmailAttempt(now: number = Date.now()): Promise<EmailAttempt | null> {
  const held = heldEmailAttempt(now);
  if (held) return held;
  try {
    const raw = isWeb ? await getStored(STORAGE_KEY) : await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isAttempt(parsed) || now - parsed.createdAt > ATTEMPT_TTL_MS) return null;
    current = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function forgetEmailAttempt(): void {
  current = null;
  void persist(null);
}

/** "s•••@gmail.com": the address as AUTH-13 shows it under its title. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

// A sign-in has used the attempt: its copy must not sign anybody in later.
useSessionStore.subscribe((state, previous) => {
  if (state.status === 'member' && previous.status !== 'member') forgetEmailAttempt();
});

/** The attempt AUTH-12 starts with the server's answer. */
export function attemptFrom(attemptId: string, email: string, resendAfterSeconds: number, now: number = Date.now()): EmailAttempt {
  return { attemptId, email, resendAt: now + resendAfterSeconds * 1000, createdAt: now };
}

/** Whole seconds until the attempt may ask for a new code. */
export function secondsUntilResend(attempt: EmailAttempt | null, now: number = Date.now()): number {
  return attempt ? Math.max(0, Math.ceil((attempt.resendAt - now) / 1000)) : 0;
}

/** The same attempt after a resend. */
export function resentAttempt(attempt: EmailAttempt, resendAfterSeconds: number, now: number = Date.now()): EmailAttempt {
  return { ...attempt, resendAt: now + resendAfterSeconds * 1000 };
}
