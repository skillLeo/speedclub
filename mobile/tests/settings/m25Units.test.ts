import { reportTitleText } from '@/features/safety/components/ReportRow';
import { platformLabel } from '@/features/settings/deviceLines';
import { metaLineText } from '@/ui/textBreaks';
import { mergeSettings, privacyOf, PRIVACY_DEFAULTS, recoveryCodesOf } from '@/api/queries/settings';
import type { MemberSettings } from '@/api/queries/auth';
import { twoFactorEnabledOf } from '@/features/settings/account';
import { settingsKeyOf, SETTINGS_GROUPS, visibleGroups } from '@/features/settings/navigation';
import { groupSecret, recoveryCodesText } from '@/features/settings/recoveryCodes';
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  reauthSchema,
  recoveryCodeSchema,
  supportTicketSchema,
} from '@/features/settings/schemas';
import { minutesOf, timeOf } from '@/features/settings/screens/NotificationSettingsScreen';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const SETTINGS: MemberSettings = {
  theme: 'carbon',
  locale: 'de',
  power_display: 'ps_kw',
  show_owner_on_qr: true,
  who_can_message: 'everyone',
  discoverable: true,
  indexable: true,
  read_receipts: true,
  ai_suggestions: false,
  notification_prefs: {
    types: {
      new_follower: { push: true },
      followed_published: { push: false },
      build_saved: { push: false },
      new_message: { push: true, email_digest: false },
      message_request: { push: true },
      hu_au_reminder: { push: true, email: false },
      qr_milestone: { push: false },
    },
    quiet_hours: { enabled: true, from: '22:00', to: '07:00' },
    message_previews: false,
  },
};

const messages = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}:${issue.message}`);

describe('FS-12 groups', () => {
  it('lists Konto · Sicherheit · Privatsphäre · App · Daten · Hilfe · Rechtliches in that order', () => {
    expect(SETTINGS_GROUPS.map((group) => group.key)).toEqual(['account', 'security', 'privacy', 'app', 'data', 'help', 'legal']);
  });

  it('gives a guest only what works without an account', () => {
    const rows = visibleGroups(false).flatMap((group) => group.rows.map((row) => row.key));
    expect(rows).toEqual(['appearance', 'language', 'help', 'legal']);
  });

  it('finds the row of a nested page, the longest path first', () => {
    expect(settingsKeyOf('/settings/account/email')).toBe('account');
    expect(settingsKeyOf('/settings/help/contact')).toBe('contact');
    expect(settingsKeyOf('/settings/help/qr-sticker')).toBe('help');
    expect(settingsKeyOf('/settings/privacy/blocked')).toBe('blocked');
    expect(settingsKeyOf('/settings/data/deleted')).toBeNull();
  });
});

describe('settings adapters', () => {
  it('merges a notification patch level by level, as the server does', () => {
    const next = mergeSettings(SETTINGS, { notification_prefs: { types: { new_message: { email_digest: true } }, quiet_hours: { from: '23:00' } } });
    expect(next.notification_prefs.types.new_message).toEqual({ push: true, email_digest: true });
    expect(next.notification_prefs.quiet_hours).toEqual({ enabled: true, from: '23:00', to: '07:00' });
    expect(next.notification_prefs.types.new_follower).toEqual({ push: true });
    expect(mergeSettings(SETTINGS, { power_display: 'hp' }).power_display).toBe('hp');
  });

  it('reads the privacy fields of an answer, and the defaults of 08 §1 before one', () => {
    expect(privacyOf(undefined)).toEqual(PRIVACY_DEFAULTS);
    expect(privacyOf({ ...SETTINGS, who_can_message: 'nobody', indexable: false })).toEqual({
      ...PRIVACY_DEFAULTS,
      who_can_message: 'nobody',
      indexable: false,
    });
  });

  it('reads the recovery codes as a list, whichever way the export types them', () => {
    expect(recoveryCodesOf(['ABCDE-FGHJK', 'MNPQR-STUVW'])).toEqual(['ABCDE-FGHJK', 'MNPQR-STUVW']);
    expect(recoveryCodesOf('ABCDE-FGHJK MNPQR-STUVW')).toEqual(['ABCDE-FGHJK', 'MNPQR-STUVW']);
    expect(recoveryCodesOf(null)).toEqual([]);
  });

  it('knows the two-factor state only once Me reports it', () => {
    expect(twoFactorEnabledOf(undefined)).toBeNull();
  });

  it('writes the quiet hours as HH:MM', () => {
    expect(minutesOf('22:30')).toBe(1350);
    expect(timeOf(1350)).toBe('22:30');
    expect(timeOf(0)).toBe('00:00');
    expect(timeOf(5000)).toBe('23:59');
  });

  it('groups a TOTP key for reading and writes the codes file plainly', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    expect(recoveryCodesText(['AAAA-BBBB', 'CCCC-DDDD'], 'Titel', 'So geht es.')).toBe('Titel\n\nSo geht es.\n\nAAAA-BBBB\nCCCC-DDDD\n');
  });
});

describe('M2.5 form rules', () => {
  it('SET-03 refuses the current address, also written differently', () => {
    const schema = changeEmailSchema('lukas.sc@speedclub.test');
    expect(messages(schema.safeParse({ email: ' Lukas.SC@speedclub.test ', password: 'x' }))).toEqual(['email:validation.emailUnchanged']);
    expect(messages(schema.safeParse({ email: 'neu@speedclub.test', password: '' }))).toEqual(['password:validation.passwordRequired']);
    expect(messages(schema.safeParse({ email: 'neu@speedclub', password: 'x' }))).toEqual(['email:validation.emailInvalid']);
  });

  it('SET-04 applies §3.1 and asks for a real change', () => {
    const schema = changePasswordSchema('lukas.sc@speedclub.test');
    const base = { currentPassword: 'Alt-Passwort-1', password: 'Boxer-Motor-2002', passwordRepeat: 'Boxer-Motor-2002', revokeOtherSessions: true };
    expect(messages(schema.safeParse(base))).toEqual([]);
    expect(messages(schema.safeParse({ ...base, password: 'kurz', passwordRepeat: 'kurz' }))).toEqual(['password:validation.passwordLength']);
    expect(messages(schema.safeParse({ ...base, passwordRepeat: 'anders' }))).toEqual(['passwordRepeat:validation.passwordsDiffer']);
    expect(messages(schema.safeParse({ ...base, password: base.currentPassword, passwordRepeat: base.currentPassword }))).toEqual([
      'password:validation.passwordUnchanged',
    ]);
    expect(
      messages(schema.safeParse({ ...base, password: 'Lukas.sc@speedclub.test', passwordRepeat: 'Lukas.sc@speedclub.test' })),
    ).toEqual(['password:validation.passwordSameAsEmail']);
  });

  it('re-authentication asks for the second factor only when two-factor is on', () => {
    expect(messages(reauthSchema(false).safeParse({ password: 'x', code: '' }))).toEqual([]);
    expect(messages(reauthSchema(true).safeParse({ password: 'x', code: '' }))).toEqual(['code:validation.codeRequired']);
    expect(messages(reauthSchema(true).safeParse({ password: 'x', code: '123 456' }))).toEqual([]);
    expect(messages(reauthSchema(true).safeParse({ password: 'x', code: 'ABCD-EFGH' }))).toEqual([]);
    expect(messages(reauthSchema(true).safeParse({ password: 'x', code: '12' }))).toEqual(['code:validation.codeOrRecoveryInvalid']);
  });

  it('SET-13 needs the password and the checkbox', () => {
    expect(messages(deleteAccountSchema(false).safeParse({ password: '', code: '', understood: false }))).toEqual([
      'password:validation.passwordRequired',
      'understood:validation.understoodRequired',
    ]);
    expect(messages(deleteAccountSchema(false).safeParse({ password: 'x', code: '', understood: true }))).toEqual([]);
  });

  it('SET-15 starts without a category and needs a few words', () => {
    expect(messages(supportTicketSchema.safeParse({ category: '', subject: 'Sticker', message: 'Mein Sticker zeigt nichts an.' }))).toEqual([
      'category:validation.categoryRequired',
    ]);
    expect(messages(supportTicketSchema.safeParse({ category: 'qr', subject: 'Sticker', message: 'Kaputt' }))).toEqual([
      'message:validation.messageTooShort',
    ]);
  });

  it('AUTH-11 takes a recovery code with or without its dash', () => {
    expect(recoveryCodeSchema.safeParse({ recoveryCode: 'abcd-efgh' }).success).toBe(true);
    expect(recoveryCodeSchema.safeParse({ recoveryCode: 'abc' }).success).toBe(false);
  });
});

describe('security notices of M2.5', () => {
  it('names verification_failed, recovery_code_used and sessions_revoked in both languages, never the raw key', async () => {
    const { notificationText } = jest.requireActual<typeof import('@/features/home/notifications')>('@/features/home/notifications');
    const i18n = jest.requireActual<{ default: typeof import('@/i18n').default }>('@/i18n').default;
    for (const language of ['de', 'en']) {
      await i18n.changeLanguage(language);
      const t = i18n.getFixedT(language, 'home');
      const other = t('notifications.text.security.other');
      for (const event of ['verification_failed', 'recovery_code_used', 'sessions_revoked']) {
        const text = notificationText(
          {
            id: event,
            type: 'security',
            group_key: event,
            actors: [],
            actor_count: 0,
            vehicle: null,
            details: { event, device_name: null },
            read_at: null,
            created_at: '2026-11-08T10:00:00Z',
          } as Parameters<typeof notificationText>[0],
          t,
        );
        expect(text).not.toContain(event);
        expect(text).not.toContain('notifications.');
        expect(text).not.toBe(other);
      }
    }
    await i18n.changeLanguage('de');
  });
});

describe('SET-06 device lines (DQ-457, DQ-458)', () => {
  it('names the platform, never the raw value', () => {
    expect(platformLabel('ios')).toBe('iOS');
    expect(platformLabel('android')).toBe('Android');
    expect(platformLabel('web')).toBeNull();
    expect(platformLabel(null)).toBeNull();
  });

  it('keeps "Zuletzt vor 3 Tagen" whole and wraps before the separator', () => {
    const used = 'Zuletzt vor 3 Tagen';
    const meta = metaLineText(['iOS', 'App 0.2.0', used].join(' · '), used.length, 'starts');
    expect(meta).toBe('iOS ·\u00a0App\u00a00.2.0 ·\u00a0Zuletzt\u00a0vor\u00a03\u00a0Tagen');
  });
});

describe('SET-16 report title (DQ-456)', () => {
  it('keeps a trailing chassis code with the model', () => {
    expect(reportTitleText('Foto von Audi RS6 C8')).toBe('Foto von Audi RS6\u00a0C8');
    expect(reportTitleText('Profil von @marco.amg')).toBe('Profil von @marco.amg');
  });
});
