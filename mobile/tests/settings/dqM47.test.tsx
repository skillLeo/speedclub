// Design QA M4.6 r2 / M4.7 r1: units behind the fixes (DQ-999, DQ-1014, DQ-1017, DQ-1018).
import { screen } from '@testing-library/react-native';

import { passkeyOwnName } from '@/features/settings/passkeyName';
import { RISKY_ACTIVITY, secureActionOf } from '@/features/settings/screens/SecurityActivityScreen';
import { hydrateThemePreference } from '@/theme';
import { ListRow, titleHyphenates } from '@/ui/ListRow';

import { renderUi } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

beforeAll(hydrateThemePreference);

describe('passkey fallback name (DQ-999)', () => {
  it('is no name: the generic "Passkey" and blanks give null, a real name stays', () => {
    expect(passkeyOwnName('Passkey')).toBeNull();
    expect(passkeyOwnName(' passkey ')).toBeNull();
    expect(passkeyOwnName('')).toBeNull();
    expect(passkeyOwnName(null)).toBeNull();
    expect(passkeyOwnName('iCloud-Schlüsselbund')).toBe('iCloud-Schlüsselbund');
    expect(passkeyOwnName('Passkey MacBook')).toBe('Passkey MacBook');
  });
});

describe('"Das war ich nicht" per row (DQ-1014)', () => {
  const row = (type: Parameters<typeof secureActionOf>[0]['type'], extra: { can_secure?: boolean; this_device?: boolean } = {}) => ({
    type,
    can_secure: extra.can_secure ?? true,
    this_device: extra.this_device ?? false,
  });

  it('inline on risky events and the marked row, a menu on routine ones, none on this device or where the server offers none', () => {
    for (const type of RISKY_ACTIVITY) expect(secureActionOf(row(type), false)).toBe('inline');
    expect(secureActionOf(row('signed_in'), false)).toBe('menu');
    expect(secureActionOf(row('signed_in'), true)).toBe('inline');
    expect(secureActionOf(row('new_device', { this_device: true }), true)).toBeNull();
    expect(secureActionOf(row('new_device', { can_secure: false }), true)).toBeNull();
  });
});

describe('ListRow for a handle (DQ-1017) and a short title (DQ-1018)', () => {
  it('keeps the handle on one line without hyphens, and names the row in full', async () => {
    await renderUi(
      <ListRow
        title="Aktivität"
        accessibilityTitle="Sicherheitsaktivität"
        subtitle="@m47smwd86xylcm7h3abcdefg"
        subtitleLines={1}
        hyphenate={false}
        onPress={jest.fn()}
        testID="row"
      />,
    );
    const handle = screen.getByText('@m47smwd86xylcm7h3abcdefg');
    expect(handle.props.numberOfLines).toBe(1);
    expect(screen.getByTestId('row.body').props['aria-label'] ?? screen.getByTestId('row.body').props.accessibilityLabel).toMatch(/^Sicherheitsaktivität/);
  });
});

describe('row titles at large text (DQ-987 reach check)', () => {
  it('hyphenate only a word that cannot fit a row whole at the font scale', () => {
    expect(titleHyphenates('E-Mail-Code', 2)).toBe(false);
    expect(titleHyphenates('Anmeldung & Passkeys', 2)).toBe(false);
    expect(titleHyphenates('Nachrichtenanfragen', 1)).toBe(false);
    expect(titleHyphenates('Nachrichtenanfragen', 2)).toBe(true);
    expect(titleHyphenates('Sicherheitsaktivität', 1)).toBe(false);
    expect(titleHyphenates('Sicherheitsaktivität', 2)).toBe(true);
    expect(titleHyphenates('Datenschutz', 2)).toBe(false);
    expect(titleHyphenates('Zwei-Faktor-Schutz', 2)).toBe(false);
  });
});
