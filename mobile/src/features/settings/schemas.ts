/**
 * The client side of the M2.5 forms (02_PRODUCT_SPEC §3.1, m2.5-contract). The server decides; these rules only say early what
 * it would say anyway. Every message is a key of the `settings` namespace.
 */
import { z } from 'zod';

import { CODE_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/schemas';
import { normalizeEmail } from '@/lib/emailAddress';

import { SUPPORT_CATEGORIES, type SupportCategory } from '@/api/queries/settings';

export const SUBJECT_MAX_LENGTH = 120;
export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 5000;
/** A recovery code as the server prints it, with or without its dashes; the server alone knows the alphabet. */
const RECOVERY_CODE = /^[A-Za-z0-9-]{8,32}$/;

/** Same pattern as AUTH-04: the local part ASCII, the domain in any script (auth/schemas). */
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*\.)+(?:\p{L}[\p{L}\p{M}]+|xn--[A-Za-z0-9-]+)$/u;

const password = z.string().min(1, 'validation.passwordRequired');
const code = z.string().regex(new RegExp(`^\\d{${CODE_LENGTH}}$`), 'validation.codeInvalid');

const newPassword = z
  .string()
  .min(1, 'validation.passwordRequired')
  .min(PASSWORD_MIN_LENGTH, 'validation.passwordLength')
  .max(PASSWORD_MAX_LENGTH, 'validation.passwordTooLong');

/** The second factor beside a password: six digits from the app or a recovery code, required only with two-factor on. */
function checkSecondFactor(value: string, needsCode: boolean, context: z.RefinementCtx): void {
  if (!needsCode) return;
  const code = value.replace(/\s/g, '');
  if (!code) context.addIssue({ code: 'custom', path: ['code'], message: 'validation.codeRequired' });
  else if (!/^\d{6}$/.test(code) && !RECOVERY_CODE.test(code)) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'validation.codeOrRecoveryInvalid' });
  }
}

/** SET-03. A new address that is the current one is no change. `needsCode`: two-factor is on (SEC-P2-07). */
export function changeEmailSchema(currentEmail: string, needsCode: boolean = false) {
  return z
    .object({
      email: z.string().trim().min(1, 'validation.emailRequired').pipe(z.email({ pattern: EMAIL_PATTERN, error: 'validation.emailInvalid' })),
      password,
      /** Only with two-factor on; the form starts it empty. */
      code: z.string().optional(),
    })
    .superRefine((data, context) => {
      if (currentEmail && normalizeEmail(data.email) === normalizeEmail(currentEmail)) {
        context.addIssue({ code: 'custom', path: ['email'], message: 'validation.emailUnchanged' });
      }
      checkSecondFactor(data.code ?? '', needsCode, context);
    });
}
export type ChangeEmailValues = z.infer<ReturnType<typeof changeEmailSchema>>;

export const codeSchema = z.object({ code });
export type CodeValues = z.infer<typeof codeSchema>;

/** SET-04: §3.1 password policy; the common-password list is the server's. `needsCode`: two-factor is on (SEC-P2-07). */
export function changePasswordSchema(email: string, needsCode: boolean = false) {
  return z
    .object({
      currentPassword: password,
      password: newPassword,
      passwordRepeat: z.string().min(1, 'validation.passwordRepeatRequired'),
      /** Only with two-factor on; the form starts it empty. */
      code: z.string().optional(),
      revokeOtherSessions: z.boolean(),
    })
    .superRefine((data, context) => {
      checkSecondFactor(data.code ?? '', needsCode, context);
      if (email && data.password.toLowerCase() === email.trim().toLowerCase()) {
        context.addIssue({ code: 'custom', path: ['password'], message: 'validation.passwordSameAsEmail' });
      }
      if (data.password && data.password === data.currentPassword) {
        context.addIssue({ code: 'custom', path: ['password'], message: 'validation.passwordUnchanged' });
      }
      if (data.password !== data.passwordRepeat) {
        context.addIssue({ code: 'custom', path: ['passwordRepeat'], message: 'validation.passwordsDiffer' });
      }
    });
}
export type ChangePasswordValues = z.infer<ReturnType<typeof changePasswordSchema>>;

/**
 * Re-authentication before export, deletion and the two-factor changes. `needsCode`: two-factor is on, so a code from the app
 * or a recovery code comes with the password.
 */
export function reauthSchema(needsCode: boolean) {
  return z
    .object({ password, code: z.string() })
    .superRefine((data, context) => checkSecondFactor(data.code, needsCode, context));
}
export type ReauthValues = z.infer<ReturnType<typeof reauthSchema>>;

/** SET-13: re-authentication plus the checkbox that says the member read what happens. */
export function deleteAccountSchema(needsCode: boolean) {
  return z
    .object({ password, code: z.string(), understood: z.boolean() })
    .superRefine((data, context) => {
      checkSecondFactor(data.code, needsCode, context);
      if (!data.understood) context.addIssue({ code: 'custom', path: ['understood'], message: 'validation.understoodRequired' });
    });
}
export type DeleteAccountValues = z.infer<ReturnType<typeof deleteAccountSchema>>;

export function isSupportCategory(value: string): value is SupportCategory {
  return (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

/** SET-15. The category starts empty: the member picks one, nothing is preselected. */
export const supportTicketSchema = z.object({
  category: z.string().refine((value): boolean => isSupportCategory(value), 'validation.categoryRequired'),
  subject: z.string().trim().min(1, 'validation.subjectRequired').max(SUBJECT_MAX_LENGTH, 'validation.subjectTooLong'),
  message: z
    .string()
    .trim()
    .min(1, 'validation.messageRequired')
    .min(MESSAGE_MIN_LENGTH, 'validation.messageTooShort')
    .max(MESSAGE_MAX_LENGTH, 'validation.messageTooLong'),
});
export type SupportTicketValues = z.infer<typeof supportTicketSchema>;

/** SET-15b: the server takes 2 to 5000 characters (StoreTicketMessageRequest). */
export const REPLY_MIN_LENGTH = 2;

/** SET-15b, the member's reply in their own request (ADR-249). */
export const supportReplySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'validation.replyRequired')
    .min(REPLY_MIN_LENGTH, 'validation.replyTooShort')
    .max(MESSAGE_MAX_LENGTH, 'validation.messageTooLong'),
});
export type SupportReplyValues = z.infer<typeof supportReplySchema>;

/** AUTH-11: six digits, or a recovery code instead. */
export const recoveryCodeSchema = z.object({
  recoveryCode: z
    .string()
    .trim()
    .min(1, 'validation.recoveryRequired')
    .refine((value) => RECOVERY_CODE.test(value.replace(/\s/g, '')), 'validation.recoveryInvalid'),
});
export type RecoveryCodeValues = z.infer<typeof recoveryCodeSchema>;
