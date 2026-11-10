import { useTranslation } from 'react-i18next';
import type { FieldError } from 'react-hook-form';

import { ApiError } from '@/api/client';

/** A message from Zod is a key of `settings`, a message from the server is already translated. */
export function useFieldMessage() {
  const { t } = useTranslation('settings');
  return (error: FieldError | undefined): string | undefined => {
    if (!error?.message) return undefined;
    return error.type === 'server' ? error.message : t(error.message as never);
  };
}

/** What a failed call says when it names no field: the server's own words, or the plain fallback. */
export function useFailureMessage() {
  const { t } = useTranslation('settings');
  return (error: unknown): string => (error instanceof ApiError && error.message ? error.message : t('common.serverError'));
}

/** Whether the server wants the second factor with the password (two-factor on, contract §1 and §3). */
export function asksForSecondFactor(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'two_factor_required' || (error.kind === 'validation' && Object.keys(error.fieldErrors).includes('code')))
  );
}

/**
 * ADR-203 (f): too many wrong second factors lock them (403 `second_factor_locked`) until a password reset by e-mail code. Not a
 * sign-out: the session stays, the form says so calmly and holds its button until the member types again.
 */
export function isSecondFactorLocked(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'second_factor_locked';
}
