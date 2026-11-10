import { sanitizeCode } from '@/features/auth/code';
import { profileUrlPreview, readResetFragment } from '@/features/auth/links';
import {
  forgotPasswordSchema,
  normalizeUsername,
  passwordChecks,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  usernameSchema,
  usernameViolations,
} from '@/features/auth/schemas';

const messagesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]));

describe('e-mail addresses (BH-06)', () => {
  const accepts = (email: string) => forgotPasswordSchema.safeParse({ email }).success;

  it.each(['max@müller.de', 'max@xn--mller-kva.de', 'max@mueller.de', 'max.mustermann+garage@speedclub.test', 'max@straße.berlin'])(
    'lets %s through: the domain may be international',
    (email) => {
      expect(accepts(email)).toBe(true);
      expect(signInSchema.safeParse({ email, password: 'x' }).success).toBe(true);
    },
  );

  it.each(['jürgen@gmail.com', 'max@gmail', 'max@müller', 'max@gmail.c', 'max@müller.d', '@müller.de', 'max@.de', 'max müller@gmail.com'])(
    'refuses %s, with the normal message',
    (email) => {
      expect(accepts(email)).toBe(false);
      expect(messagesOf(forgotPasswordSchema.safeParse({ email }))).toEqual({ email: 'validation.emailInvalid' });
    },
  );

  it('trims what surrounds the address', () => {
    expect(forgotPasswordSchema.safeParse({ email: '  max@müller.de ' }).data).toEqual({ email: 'max@müller.de' });
  });
});

describe('password rules', () => {
  it('is a checklist, not a score', () => {
    expect(passwordChecks('', 'a@b.de')).toEqual({ length: false, notEmail: false });
    expect(passwordChecks('kurz', 'a@b.de')).toEqual({ length: false, notEmail: true });
    expect(passwordChecks('Nachtfahrt-R34', 'a@b.de')).toEqual({ length: true, notEmail: true });
  });

  it('refuses the address as the password, in any case', () => {
    expect(passwordChecks('Lukas@Speedclub.test', ' lukas@speedclub.test ')).toEqual({ length: true, notEmail: false });
  });

  it('sign-up needs 10 characters, all three consents and no copy of the address', () => {
    const result = signUpSchema.safeParse({
      email: 'lukas@speedclub.test',
      password: 'lukas@speedclub.test',
      ageConfirmed: false,
      termsAccepted: false,
      privacyAccepted: true,
      marketingConsent: false,
    });
    expect(messagesOf(result)).toEqual({
      ageConfirmed: 'validation.ageRequired',
      termsAccepted: 'validation.termsRequired',
      password: 'validation.passwordSameAsEmail',
    });
    expect(
      signUpSchema.safeParse({
        email: ' lukas@speedclub.test ',
        password: 'Nachtfahrt-R34',
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
        marketingConsent: false,
      }).success,
    ).toBe(true);
  });

  it('marketing stays optional', () => {
    const base = { email: 'a@b.de', password: 'Nachtfahrt-R34', ageConfirmed: true, termsAccepted: true, privacyAccepted: true };
    expect(signUpSchema.safeParse({ ...base, marketingConsent: false }).success).toBe(true);
  });

  it('short passwords and bad addresses get their own messages', () => {
    expect(messagesOf(signUpSchema.safeParse({ email: 'kein-at', password: 'kurz', ageConfirmed: true, termsAccepted: true, privacyAccepted: true, marketingConsent: false }))).toEqual({
      email: 'validation.emailInvalid',
      password: 'validation.passwordLength',
    });
    expect(messagesOf(signInSchema.safeParse({ email: '', password: '' }))).toEqual({
      email: 'validation.emailRequired',
      password: 'validation.passwordRequired',
    });
  });

  it('a reset needs a six-digit code and the same password twice', () => {
    expect(
      messagesOf(resetPasswordSchema.safeParse({ email: 'a@b.de', code: '12345', password: 'Nachtfahrt-R34', passwordRepeat: 'Nachtfahrt-R33' })),
    ).toEqual({ code: 'validation.codeInvalid', passwordRepeat: 'validation.passwordsDiffer' });
    expect(resetPasswordSchema.safeParse({ email: 'a@b.de', code: '123456', password: 'Nachtfahrt-R34', passwordRepeat: 'Nachtfahrt-R34' }).success).toBe(true);
  });
});

describe('username rules (mirror of App\\Support\\Username)', () => {
  it.each([
    ['lukas.sc', []],
    ['k8', ['length']],
    ['a'.repeat(25), ['length']],
    ['jann-ptrs', ['characters']],
    ['_lukas', ['start']],
    ['.lukas', ['start']],
    ['lukas.', ['trailing_dot']],
    ['lu..kas', ['consecutive_dots']],
    ['ä', ['length', 'characters', 'start']],
  ])('%s', (name, expected) => {
    expect(usernameViolations(name)).toEqual(expected);
  });

  it('is case-insensitive and trimmed, like the server', () => {
    expect(normalizeUsername('  Lukas.SC ')).toBe('lukas.sc');
    expect(usernameViolations('Lukas.SC')).toEqual([]);
  });

  it('the form shows the first broken rule as a reason key', () => {
    expect(messagesOf(usernameSchema.safeParse({ username: 'lu..' }))).toEqual({ username: 'username.reason.trailing_dot' });
  });

  it('previews the profile address without inventing a domain', () => {
    expect(profileUrlPreview('lukas.sc', 'https://speedclub.de/', undefined)).toBe('speedclub.de/u/lukas.sc');
    expect(profileUrlPreview('lukas.sc', '', 'localhost:8080')).toBe('localhost:8080/u/lukas.sc');
    expect(profileUrlPreview('lukas.sc', undefined, undefined)).toBe('/u/lukas.sc');
  });
});

describe('codes', () => {
  it('keeps six digits of whatever was pasted', () => {
    expect(sanitizeCode('123 456')).toBe('123456');
    expect(sanitizeCode('Code: 98-76-54-32')).toBe('987654');
    expect(sanitizeCode('abc')).toBe('');
  });

  it('reads code and address from the reset link fragment (ADR-138)', () => {
    expect(readResetFragment('#code=123456&email=lukas%40speedclub.test')).toEqual({ code: '123456', email: 'lukas@speedclub.test' });
    expect(readResetFragment('')).toEqual({});
    expect(readResetFragment('#code=12%2034%2056x')).toEqual({ code: '123456' });
  });

  it('keeps the link for the screens of one page load, until a route names its own address', () => {
    jest.isolateModules(() => {
      // A fresh module: a new page load.
      const links = jest.requireActual<typeof import('@/features/auth/links')>('@/features/auth/links');
      const hash = '#code=123456&email=lukas%40speedclub.test';
      expect(links.resetLinkFor(undefined, hash)).toEqual({ code: '123456', email: 'lukas@speedclub.test' });
      // Mounted again after the address bar lost the fragment, as after the session restore.
      expect(links.resetLinkFor(undefined, '')).toEqual({ code: '123456', email: 'lukas@speedclub.test' });
      // AUTH-06 or a forced change sent a new code: the link's code is stale, whatever the address.
      expect(links.resetLinkFor('lukas@speedclub.test', '')).toEqual({});
      expect(links.resetLinkFor(undefined, '')).toEqual({});
    });
  });

  it('forgets a link whose code was spent', () => {
    jest.isolateModules(() => {
      const links = jest.requireActual<typeof import('@/features/auth/links')>('@/features/auth/links');
      expect(links.resetLinkFor(undefined, '#code=123456')).toEqual({ code: '123456' });
      links.forgetResetLink();
      expect(links.resetLinkFor(undefined, '#code=123456')).toEqual({});
    });
  });
});
