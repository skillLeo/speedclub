import { act, renderHook } from '@testing-library/react-native';
import type { TFunction } from 'i18next';

import { ApiError, sessionMovedError } from '@/api/client';
import { applyServerErrors, fieldMessage, formatClock, formatWait, useCountdown, useDebouncedValue } from '@/features/auth/forms';
import i18n from '@/i18n';

const t = i18n.getFixedT('de', 'auth') as TFunction<'auth'>;

describe('server errors', () => {
  it('puts a 422 on the fields it names and focuses the first', () => {
    const setError = jest.fn();
    const error = new ApiError({
      kind: 'validation',
      status: 422,
      code: 'validation_failed',
      message: 'Bitte prüfe deine Eingaben.',
      fieldErrors: { password: ['Dieses Passwort ist zu verbreitet.'], accepted_terms: ['Bitte akzeptiere die AGB.'] },
    });
    expect(applyServerErrors(error, setError, { password: 'password', accepted_terms: 'termsAccepted' })).toBeNull();
    expect(setError).toHaveBeenNthCalledWith(1, 'password', { type: 'server', message: 'Dieses Passwort ist zu verbreitet.' }, { shouldFocus: true });
    expect(setError).toHaveBeenNthCalledWith(2, 'termsAccepted', { type: 'server', message: 'Bitte akzeptiere die AGB.' }, { shouldFocus: false });
  });

  it('returns the message when no field can show it', () => {
    const setError = jest.fn();
    const error = new ApiError({ kind: 'server', status: 500, code: 'server_error', message: 'Etwas ist schiefgelaufen.' });
    expect(applyServerErrors(error, setError, { email: 'email' })).toBe('Etwas ist schiefgelaufen.');
    expect(setError).not.toHaveBeenCalled();
  });

  it('leaves a session that moved to SessionHost\'s dialog: one message per event (DQ-256)', () => {
    const setError = jest.fn();
    expect(applyServerErrors(sessionMovedError(), setError, { email: 'email' })).toBeNull();
    expect(setError).not.toHaveBeenCalled();
  });

  it('translates a schema key and shows a server message as it came', () => {
    expect(fieldMessage(t, { type: 'too_small', message: 'validation.passwordLength' })).toBe('Dein Passwort braucht mindestens 10\u00A0Zeichen.');
    expect(fieldMessage(t, { type: 'server', message: 'Vom Server.' })).toBe('Vom Server.');
    expect(fieldMessage(t, undefined)).toBeUndefined();
  });
});

describe('waiting', () => {
  it('says how long in words, never in raw seconds', () => {
    expect(formatWait(t, 1)).toBe('1\u00A0Sekunde');
    expect(formatWait(t, 42)).toBe('42\u00A0Sekunden');
    expect(formatWait(t, 61)).toBe('2\u00A0Minuten');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(0)).toBe('0:00');
  });

  it('counts down once a second and can start again', async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useCountdown(2));
    expect(result.current.remaining).toBe(2);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(1);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(result.current.remaining).toBe(0);
    await act(async () => result.current.restart(30));
    expect(result.current.remaining).toBe(30);
    jest.useRealTimers();
  });

  it('debounces: only the value that stood still arrives', async () => {
    jest.useFakeTimers();
    const { result, rerender } = await renderHook(({ value }: { value: string }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'l' },
    });
    await rerender({ value: 'lu' });
    await act(async () => jest.advanceTimersByTime(200));
    await rerender({ value: 'luk' });
    await act(async () => jest.advanceTimersByTime(200));
    expect(result.current).toBe('l');
    await act(async () => jest.advanceTimersByTime(300));
    expect(result.current).toBe('luk');
    jest.useRealTimers();
  });
});
