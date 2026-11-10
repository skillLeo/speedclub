import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { ErrorState } from '@/ui/ErrorState';

import { renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('ErrorState', () => {
  it('says what happened in plain language and retries, from namespace common', async () => {
    const onRetry = jest.fn();
    await renderUi(<ErrorState onRetry={onRetry} testID="e" />);
    expect(screen.getByText('Das hat nicht geklappt')).toBeTruthy();
    expect(screen.getByText('Prüfe deine Verbindung und versuche es noch einmal.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('e').props.role).toBe('alert');
  });

  it('takes a specific cause', async () => {
    await renderUi(<ErrorState title="Fahrzeug nicht verfügbar" message="Der Besitzer hat es entfernt." />);
    expect(screen.getByText('Fahrzeug nicht verfügbar')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ignores a second press while retrying', async () => {
    const onRetry = jest.fn();
    await renderUi(<ErrorState onRetry={onRetry} retrying testID="e" />);
    await fireEvent.press(screen.getByTestId('e.action'));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
