import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { FieldError, FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from '@/api/client';
import { isInternalPath, useSessionStore } from '@/state/session';

import { noteSignupOrigin } from './signupRef';

/** A message from Zod is a key of this namespace, a message from the server is already translated. */
export function fieldMessage(t: TFunction<'auth'>, error: FieldError | undefined): string | undefined {
  if (!error?.message) return undefined;
  return error.type === 'server' ? error.message : t(error.message as never);
}

/**
 * Puts a 422 on the fields it names and returns what no field can show. `fields` maps a name of the API to the form's.
 * Returns null when every message has found its field, and for a session that moved to another member: SessionHost's dialog
 * says that, and the tab reloads, so a form notice would only repeat it (DQ-256, one message per event).
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: Readonly<Record<string, Path<T>>>,
): string | null {
  if (!(error instanceof ApiError) || error.kind === 'session_moved') return null;
  const entries = Object.entries(error.fieldErrors);
  let shown = false;
  for (const [name, messages] of entries) {
    const field = fields[name];
    const message = messages[0];
    if (!field || !message) continue;
    setError(field, { type: 'server', message: messages.join(' ') }, { shouldFocus: !shown });
    shown = true;
  }
  return shown ? null : error.message;
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

const MINUTE = 60;

/** "42 Sekunden", "3 Minuten": a wait says what to expect, never a raw number of seconds. */
export function formatWait(t: TFunction<'auth'>, seconds: number): string {
  if (seconds < MINUTE) return t('time.seconds', { count: Math.max(1, Math.ceil(seconds)) });
  return t('time.minutes', { count: Math.ceil(seconds / MINUTE) });
}

/** m:ss for a running timer. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / MINUTE)}:${String(whole % MINUTE).padStart(2, '0')}`;
}

/** Seconds left of a timer, ticking once a second. `restart` sets it again. */
export function useCountdown(initialSeconds: number = 0): { remaining: number; restart: (seconds: number) => void } {
  const [remaining, setRemaining] = useState(initialSeconds);
  const running = remaining > 0;

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setRemaining((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const restart = useCallback((seconds: number) => setRemaining(Math.max(0, Math.ceil(seconds))), []);
  return { remaining, restart };
}

/** The input after it stopped changing for `delay`. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return settled;
}

/**
 * Takes a way back from the URL. `returnTo` comes from the app, `next` from the public pages (F4); either can be set by a
 * crafted link, so it goes through isInternalPath. An intent already in the store carries an action as well and stays.
 */
export function useReturnToParam(params: { returnTo?: string | string[]; next?: string | string[] }): void {
  const candidate = [params.returnTo, params.next].flat().find(isInternalPath);
  const fromPublicPage = [params.next].flat().find(isInternalPath);
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !candidate) return;
    applied.current = true;
    // ADR-216: `next` is what a public page's Registrieren and Anmelden hand over; the app's own `returnTo` is no source.
    noteSignupOrigin(fromPublicPage);
    if (!useSessionStore.getState().intent) useSessionStore.setState({ intent: { returnTo: candidate } });
  }, [candidate, fromPublicPage]);
}

/**
 * BH-34: a replace the discard guard must not stop. The guard reads a rendered value, so `leave` first renders the form as
 * not dirty, and the replace follows in an effect: a parent's effect runs after the guard's in that commit.
 */
export function useLeaveForm(): { leaving: boolean; leave: (href: Href) => void } {
  const router = useRouter();
  const [target, setTarget] = useState<Href | null>(null);
  useEffect(() => {
    if (target !== null) router.replace(target);
  }, [router, target]);
  return { leaving: target !== null, leave: setTarget };
}

/** Whether nothing but the address was typed: the screen beside this one takes that along. */
export function onlyEmailDirty(dirtyFields: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(dirtyFields).every((name) => name === 'email');
}

/** expo-router hands a repeated parameter over as an array. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
