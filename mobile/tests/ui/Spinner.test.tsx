import { screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { Spinner } from '@/ui/Spinner';

import { renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('Spinner', () => {
  it('is a progressbar with the default label from common', async () => {
    await renderUi(<Spinner testID="s" />);
    expect(screen.getByTestId('s').props.role).toBe('progressbar');
    expect(screen.getByTestId('s').props['aria-label']).toBe('Wird geladen');
  });

  it('accepts a label', async () => {
    await renderUi(<Spinner label="Foto wird hochgeladen" testID="s" />);
    expect(screen.getByTestId('s').props['aria-label']).toBe('Foto wird hochgeladen');
  });

  it('is hidden from screen readers inside a busy control', async () => {
    await renderUi(<Spinner decorative testID="s" />);
    expect(screen.getByTestId('s', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(screen.getByTestId('s', { includeHiddenElements: true }).props.role).toBeUndefined();
  });
});
