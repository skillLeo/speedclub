import { screen } from '@testing-library/react-native';

import { GroupHeader } from '@/features/vehicle/components/RowCard';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

beforeAll(hydrateThemePreference);

describe('GroupHeader (FS-3 Mods)', () => {
  it('keeps the count in the heading, joined to the last word, so it never sits alone on a line (DQ-180)', async () => {
    await renderUi(<GroupHeader title="Motor & Antrieb" icon="wrench" count={3} testID="g" />);
    const heading = screen.getByRole('heading');
    expect(heading).toContainElement(screen.getByTestId('g.count'));
    expect(screen.getByTestId('g')).toHaveTextContent('Motor & Antrieb 3');
    expect(JSON.stringify(screen.toJSON())).toContain('"Motor & Antrieb","\u00A0"');
  });

  it('names the heading with the count and its word, for a screen reader', async () => {
    await renderUi(<GroupHeader title="Fahrwerk" count={3} countLabel="3 Mods" testID="g" />);
    expect(screen.getByRole('heading', { name: 'Fahrwerk, 3 Mods' })).toBeTruthy();
  });

  it('has no count and no extra name without one', async () => {
    await renderUi(<GroupHeader title="Details" testID="g" />);
    expect(screen.queryByTestId('g.count')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Details' })).toHaveTextContent('Details');
  });
});
