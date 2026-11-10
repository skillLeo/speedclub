import { screen, waitFor } from '@testing-library/react-native';

import { ScanStats } from '@/features/qr/components/ScanStats';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, stubFetch } from './harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const VEHICLE = '01m6f7zv1vs5e2xw9a96cbqzyp';

function days(counts: number[]) {
  return counts.map((count, index) => ({ date: `2026-10-${String(26 + index).padStart(2, '0')}`, count }));
}

beforeAll(hydrateThemePreference);
beforeEach(() => signIn());

describe('QR-02 scans row (sig.qr_stats)', () => {
  it('draws 14 bars, the counts and the milestone line', async () => {
    const counts = [0, 1, 2, 0, 0, 5, 3, 0, 0, 1, 0, 4, 2, 5];
    const { calls } = stubFetch({ [`/vehicles/${VEHICLE}/qr/stats`]: { body: { data: { days: days(counts), total: 128, total_14_days: 23 } } } });
    renderScreen(<ScanStats vehicleId={VEHICLE} routeId="QR-02" />);
    await waitFor(() => expect(screen.getByTestId('QR-02.scans.summary')).toHaveTextContent('23 in 14 Tagen · 128 gesamt'));
    expect(screen.getByTestId('QR-02.scans.milestone')).toHaveTextContent('Meilenstein erreicht: 100 Scans. Der nächste kommt bei 500.');
    expect(screen.getByTestId('QR-02.scans.bars').children).toHaveLength(14);
    expect(screen.getByLabelText(/Scans: 23 in den letzten 14 Tagen, 128 insgesamt/)).toBeTruthy();
    expect(calls.every((request) => request.method === 'GET')).toBe(true);
  });

  it('has a designed zero state for a new sticker (DQ-459)', async () => {
    stubFetch({ [`/vehicles/${VEHICLE}/qr/stats`]: { body: { data: { days: days(Array(14).fill(0)), total: 0, total_14_days: 0 } } } });
    renderScreen(<ScanStats vehicleId={VEHICLE} routeId="QR-02" />);
    await waitFor(() => expect(screen.getByTestId('QR-02.scans.summary')).toHaveTextContent('Noch keine Scans'));
    expect(screen.getByTestId('QR-02.scans.milestone')).toHaveTextContent('Erster Meilenstein: 10 Scans');
    expect(screen.getByTestId('QR-02.scans.bars').children).toHaveLength(14);
    expect(screen.getByLabelText('Scans: noch keine. Erster Meilenstein: 10 Scans')).toBeTruthy();
  });

  it('says so when the last 14 days had no scans, and keeps each number with its unit (DQ-460)', async () => {
    stubFetch({ [`/vehicles/${VEHICLE}/qr/stats`]: { body: { data: { days: days(Array(14).fill(0)), total: 22, total_14_days: 0 } } } });
    renderScreen(<ScanStats vehicleId={VEHICLE} routeId="QR-02" />);
    await waitFor(() => expect(screen.getByTestId('QR-02.scans.summary')).toHaveTextContent('22 gesamt · keine in den letzten 14 Tagen'));
    expect(screen.getByTestId('QR-02.scans.summary').props.children).toContain('22\u00a0gesamt');
  });

  it('takes itself away on a 404 (flag off on the server, not the member’s vehicle)', async () => {
    stubFetch({});
    renderScreen(<ScanStats vehicleId={VEHICLE} routeId="QR-02" />);
    await waitFor(() => expect(screen.queryByTestId('QR-02.scans')).toBeNull());
  });

  it('offers a retry when the counts cannot be read', async () => {
    stubFetch({ [`/vehicles/${VEHICLE}/qr/stats`]: { status: 403, body: { message: 'Nicht erlaubt', code: 'forbidden', errors: {} } } });
    renderScreen(<ScanStats vehicleId={VEHICLE} routeId="QR-02" />);
    await waitFor(() => expect(screen.getByTestId('QR-02.scans.retry')).toBeTruthy());
  });
});
