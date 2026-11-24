import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, type ReactNode } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { OverviewSection } from '@/features/vehicle/components/ProfileSections';
import { hydrateThemePreference, ThemeProvider } from '@/theme';

import { R34 } from './fixtures';
import { newQueryClient } from './harness';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: () => true }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

beforeAll(hydrateThemePreference);

/** Stands in for BuildScoreSection / HighlightsRail: counts its mounts, as an open sheet's state lives exactly as long as one mount. */
function makeProbe(label: string, mounts: string[]) {
  return function Probe() {
    useEffect(() => {
      mounts.push(label);
    }, []);
    return <Text testID={`probe.${label}`}>{label}</Text>;
  };
}

describe('VEH-01 Übersicht keeps its sections mounted while blocks load', () => {
  it('does not remount the Build Score section or the rail when the owner lines arrive after the first frame', async () => {
    const mounts: string[] = [];
    const Score = makeProbe('score', mounts);
    const Pins = makeProbe('pins', mounts);
    const client = newQueryClient();
    // The providers of renderWithProviders, kept around every rerender so only OverviewSection's props change.
    const ui = (ownerContent?: ReactNode) => (
      <GestureHandlerRootView>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <OverviewSection
        vehicle={R34}
        routeId="VEH-01"
        ownerContent={ownerContent}
        score={() => <Score />}
        pins={() => <Pins />}
            />
          </ThemeProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    );

    const view = await render(ui());
    await screen.findByTestId('probe.pins');
    expect(mounts).toEqual(['score', 'pins']);

    // VehicleScreen: the next HU and the owner's spot line come from their own queries, after the vehicle.
    await view.rerender(ui(<Text testID="owner.line">Nächste HU</Text>));
    await screen.findByTestId('owner.line');
    expect(screen.getByTestId('probe.score')).toBeTruthy();
    expect(mounts).toEqual(['score', 'pins']);

    // And back (the line disappears after a refetch): still the same mounts.
    await view.rerender(ui());
    await waitFor(() => expect(screen.queryByTestId('owner.line')).toBeNull());
    expect(mounts).toEqual(['score', 'pins']);
  });
});
