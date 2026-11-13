/**
 * SF-R4-1: on Android, hyphenation is a paragraph attribute (`android_hyphenationFrequency` of the root Text); a nested Text is
 * a virtual span that cannot turn it off. A SlotText line with a slot or a kept name therefore does not hyphenate at its root,
 * so the value never splits. Without a span the copy keeps its hyphenation; iOS has nothing to set.
 */
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { SlotText, slot } from '@/ui/SlotText';
import { nameInText, PRODUCT_NAMES } from '@/ui/textBreaks';

import { renderUi } from './helpers';

jest.mock('expo-haptics', () => ({}));

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
afterEach(() => {
  Platform.OS = originalOS;
});

describe('SlotText on Android (SF-R4-1)', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('turns hyphenation off at the root Text when a slot is set apart', async () => {
    await renderUi(
      <SlotText variant="body" text={`${slot('vehicle')} hat jetzt einen eigenen QR-Code.`} slots={{ vehicle: nameInText('Nissan Skyline GT-R R34') }} testID="line" />,
    );
    expect(screen.getByTestId('line').props.android_hyphenationFrequency).toBe('none');
  });

  it('turns hyphenation off at the root Text when a kept product name is set apart', async () => {
    await renderUi(<SlotText variant="body" text="Öffne Google Authenticator und scanne den Code." keep={PRODUCT_NAMES} testID="line" />);
    expect(screen.getByTestId('line').props.android_hyphenationFrequency).toBe('none');
  });

  it('keeps the hyphenation of a line without a span', async () => {
    await renderUi(<SlotText variant="body" text="Fahrwerksüberarbeitung beim Spezialisten" keep={PRODUCT_NAMES} testID="line" />);
    expect(screen.getByTestId('line').props.android_hyphenationFrequency).toBe('normal');
  });

  it('respects a caller that turns hyphenation off', async () => {
    await renderUi(<SlotText variant="body" text="Fahrwerksüberarbeitung" hyphenate={false} testID="line" />);
    expect(screen.getByTestId('line').props.android_hyphenationFrequency).toBe('none');
  });
});

describe('SlotText on iOS', () => {
  it('sets no Android paragraph attribute', async () => {
    Platform.OS = 'ios';
    await renderUi(<SlotText variant="body" text={`Code ${slot('code')}`} slots={{ code: '7H2KQXMB' }} testID="line" />);
    expect(screen.getByTestId('line').props.android_hyphenationFrequency).toBeUndefined();
  });
});
