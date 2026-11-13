/** 09 §6.2 pattern (d): the Home header with the brush wordmark and the bell, hiding on scroll down (M4.5). */
import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { BrandHeader, nextBrandHeaderOffset } from '@/ui';

import { renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('the Home header (09 §6.2 d)', () => {
  it('hides on scroll down and comes back on the first scroll up, always shown at the top', () => {
    expect(nextBrandHeaderOffset(0, 0, 30, 100)).toBe(30);
    expect(nextBrandHeaderOffset(30, 30, 400, 100)).toBe(100);
    expect(nextBrandHeaderOffset(100, 400, 380, 100)).toBe(80);
    expect(nextBrandHeaderOffset(80, 380, 200, 100)).toBe(0);
    expect(nextBrandHeaderOffset(60, 50, -20, 100)).toBe(0);
  });

  it('draws the wordmark and the bell with its unread badge in the name', async () => {
    const onPress = jest.fn();
    await renderUi(
      <BrandHeader
        actions={[
          {
            icon: 'bell',
            label: 'Benachrichtigungen',
            onPress,
            unread: { count: 2, label: '2 ungelesen' },
            testID: 'HOME-01.bell',
          },
        ]}
        testID="HOME-01.header"
      />,
    );
    expect(screen.getByTestId('HOME-01.header.logo')).toBeTruthy();
    expect(screen.getByLabelText('SPEED CLUB')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Benachrichtigungen, 2 ungelesen'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
