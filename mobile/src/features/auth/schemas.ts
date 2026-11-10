/**
 * The client side of 02_PRODUCT_SPEC §3.1. The server decides; these rules only say early what it would say anyway. The
 * common-password list is the server's alone. Every message is a key in the `auth` namespace.
 *
 * One deliberate step beyond that: an address with a non-ASCII local part is refused on all forms. The mail may not reach it
 * (the mail step needs SMTPUTF8 for it), and the server refuses it at registration. An international domain is fine: it goes out
 * as punycode.
 */
import { z } from 'zod';

import type { UsernameReason } from '@/api/queries/auth';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 255;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const CODE_LENGTH = 6;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const CITY_MAX_LENGTH = 100;

export type PasswordRule = 'length' | 'notEmail';

/** Which of the rules this password meets, for the checklist of AUTH-04 and AUTH-07. No score. */
export function passwordChecks(password: string, email: string): Record<PasswordRule, boolean> {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    notEmail: password.length > 0 && password.toLowerCase() !== email.trim().toLowerCase(),
  };
}

/**
 * z.regexes.email with its local part unchanged, and the letters of any script in the domain, down to a top-level domain of at
 * least two. Not z.regexes.unicodeEmail, which takes max@gmail and jürgen@gmail.com.
 */
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*\.)+(?:\p{L}[\p{L}\p{M}]+|xn--[A-Za-z0-9-]+)$/u;

const emailField = z
  .string()
  .trim()
  .min(1, 'validation.emailRequired')
  .pipe(z.email({ pattern: EMAIL_PATTERN, error: 'validation.emailInvalid' }));

const currentPasswordField = z.string().min(1, 'validation.passwordRequired');

const newPasswordField = z
  .string()
  .min(1, 'validation.passwordRequired')
  .min(PASSWORD_MIN_LENGTH, 'validation.passwordLength')
  .max(PASSWORD_MAX_LENGTH, 'validation.passwordTooLong');

const notSameAsEmail = (data: { email: string; password: string }, context: z.RefinementCtx) => {
  if (data.password.toLowerCase() === data.email.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'validation.passwordSameAsEmail' });
  }
};

const codeField = z
  .string()
  .regex(new RegExp(`^\\d{${CODE_LENGTH}}$`), 'validation.codeInvalid');

export const signInSchema = z.object({ email: emailField, password: currentPasswordField });
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    email: emailField,
    password: newPasswordField,
    ageConfirmed: z.boolean().refine(Boolean, 'validation.ageRequired'),
    termsAccepted: z.boolean().refine(Boolean, 'validation.termsRequired'),
    privacyAccepted: z.boolean().refine(Boolean, 'validation.privacyRequired'),
    marketingConsent: z.boolean(),
  })
  .superRefine(notSameAsEmail);
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const verifyEmailSchema = z.object({ code: codeField, password: z.string() });
export type VerifyEmailValues = z.infer<typeof verifyEmailSchema>;

export const resetPasswordSchema = z
  .object({
    email: emailField,
    code: codeField,
    password: newPasswordField,
    passwordRepeat: z.string().min(1, 'validation.passwordRepeatRequired'),
  })
  .superRefine((data, context) => {
    notSameAsEmail(data, context);
    if (data.password !== data.passwordRepeat) {
      context.addIssue({ code: 'custom', path: ['passwordRepeat'], message: 'validation.passwordsDiffer' });
    }
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const profileSetupSchema = z.object({
  displayName: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH, 'validation.displayNameTooLong'),
  city: z.string().trim().max(CITY_MAX_LENGTH, 'validation.cityTooLong'),
});
export type ProfileSetupValues = z.infer<typeof profileSetupSchema>;

/** Usernames are case-insensitive and stored lowercase. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Mirrors App\Support\Username::violations without the reserved list and the uniqueness, which only the server knows.
 * Same order as the server, so the first entry is the one to show.
 */
export function usernameViolations(value: string): UsernameReason[] {
  const username = normalizeUsername(value);
  const violations: UsernameReason[] = [];
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) violations.push('length');
  if (!/^[a-z0-9._]*$/.test(username)) violations.push('characters');
  if (username !== '' && !/^[a-z0-9]/.test(username)) violations.push('start');
  if (username.endsWith('.')) violations.push('trailing_dot');
  if (username.includes('..')) violations.push('consecutive_dots');
  return violations;
}

export const usernameSchema = z.object({
  username: z.string().superRefine((value, context) => {
    const first = usernameViolations(value)[0];
    if (first) context.addIssue({ code: 'custom', message: `username.reason.${first}` });
  }),
});
export type UsernameValues = z.infer<typeof usernameSchema>;
