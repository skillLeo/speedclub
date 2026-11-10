// HOME-01 build-update rows: the meta line keeps a handle whole and lets it move with the date (DQ-433).
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { BuildUpdateRow, updateMetaText } from '@/ui/BuildUpdateRow';

import { renderUi } from '../ui/helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn() }));
const dimensions = useWindowDimensions as jest.Mock;

const NBSP = ' ';
const ZWSP = '​';
const META = 'Mercedes-AMG C 63 AMG · @marco.amg · vor 3 Tagen';

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 }));

describe('the meta line of a build update (DQ-433)', () => {
  it('never splits a handle at its dot: "@marco." / "amg" can no longer happen', () => {
    const text = updateMetaText(META, 1);
    expect(text).toContain('@marco.amg');
    expect(text).not.toContain(ZWSP);
  });

  it('breaks before the handle, so handle and date move to the next line together, and never starts a line with "·"', () => {
    const text = updateMetaText(META, 1);
    expect(text).toContain(`AMG${NBSP}· @marco.amg${NBSP}· vor${NBSP}3${NBSP}Tagen`);
  });

  it('keeps a handle whole at twice the size while it fits the line', () => {
    expect(updateMetaText(META, 2)).toContain('@marco.amg');
    expect(updateMetaText(META, 2)).not.toContain(ZWSP);
  });

  it('lets a handle wider than the line alone break after its "." or "_" (24 characters at the font scale)', () => {
    const long = 'BMW M3 E46 · @carbon_garage.e46_csl · vor 2 Std.';
    // 21 characters: whole at 1, wider than the line at 2.
    expect(updateMetaText(long, 1)).toContain('@carbon_garage.e46_csl');
    expect(updateMetaText(long, 2)).toContain(`@carbon_${ZWSP}garage.${ZWSP}e46_${ZWSP}csl`);
  });

  it('renders that line in the row, at the font scale of the theme', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 2 });
    await renderUi(<BuildUpdateRow title="Fahrwerk geändert" meta={META} photo={{ source: 'https://x/a.webp' }} onPress={jest.fn()} testID="HOME-01.update" />);
    expect(screen.getByText(updateMetaText(META, 2))).toBeTruthy();
    expect(screen.getByRole('link', { name: `Fahrwerk geändert, ${META}` })).toBeTruthy();
  });
});
