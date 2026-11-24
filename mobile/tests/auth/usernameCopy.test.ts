// R4B-004: the username rule and its error name the limits of limits.ts (5 to 24 since client round 3), interpolated, so the copy
// cannot drift from the rule again. AUTH-08 and PROF-03 both read these keys.
import i18n from '@/i18n';
import { fieldMessage } from '@/features/auth/forms';
import { USERNAME_LENGTH_VALUES, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@/features/auth/limits';
import de from '@/i18n/locales/de/auth.json';
import en from '@/i18n/locales/en/auth.json';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const NBSP = ' ';

describe('username length copy (R4B-004)', () => {
  it('holds no number of its own: both languages take the limits as values', () => {
    for (const copy of [de, en]) {
      expect(copy.username.rules.length).toMatch(/\{\{min\}\}.*\{\{max\}\}/);
      expect(copy.username.reason.length).toMatch(/\{\{min\}\}.*\{\{max\}\}/);
      expect(`${copy.username.rules.length} ${copy.username.reason.length}`).not.toMatch(/\d/);
    }
    expect(USERNAME_LENGTH_VALUES).toEqual({ min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH });
  });

  it('says 5 to 24 in German and English, in the rule list and in the field error', async () => {
    await i18n.changeLanguage('de');
    const t = i18n.getFixedT('de', 'auth');
    expect(t('username.rules.length', USERNAME_LENGTH_VALUES)).toBe(`${USERNAME_MIN_LENGTH}${NBSP}bis ${USERNAME_MAX_LENGTH}${NBSP}Zeichen`);
    expect(fieldMessage(t, { type: 'custom', message: 'username.reason.length' })).toBe(`Dein Benutzername braucht 5${NBSP}bis 24${NBSP}Zeichen.`);
    const tEn = i18n.getFixedT('en', 'auth');
    expect(tEn('username.rules.length', USERNAME_LENGTH_VALUES)).toBe(`5${NBSP}to 24${NBSP}characters`);
    expect(fieldMessage(tEn, { type: 'custom', message: 'username.reason.length' })).toBe(`Your username needs 5${NBSP}to 24${NBSP}characters.`);
    // PROF-03 reads the same key through its namespace prefix.
    expect(i18n.getFixedT('de', ['profile', 'auth'])('auth:username.reason.length', USERNAME_LENGTH_VALUES)).toBe(`Dein Benutzername braucht 5${NBSP}bis 24${NBSP}Zeichen.`);
  });
});
