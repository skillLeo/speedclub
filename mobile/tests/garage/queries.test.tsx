/**
 * Round 3 of the garage queries: a visibility save reaches the cached QR code at once (BH-23 rest), and the owner's mods and
 * stickers are not read while the session changes hands (BH-28).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useChangeVisibility } from '@/api/queries/garage';
import { useOwnerMod, useVehicleMods } from '@/api/queries/mods';
import { qrCodeKey, qrListKey, useMyQrCodes, useQrCode, type QrCodeData } from '@/api/queries/qr';
import { useSessionStore } from '@/state/session';

import { qrRow } from '../qr/harness';
import { vehicle, VEHICLE_ID } from './fixtures';
import { list, newQueryClient, signIn, stubFetch } from './harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

function setup() {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const code = (scanState: QrCodeData['scan_state'], visibility: string, id: string = VEHICLE_ID) =>
  qrRow({ scan_state: scanState }, { id, visibility }) as unknown as QrCodeData;

beforeEach(() => {
  signIn();
  useSessionStore.setState({ memberChanged: false });
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null, memberChanged: false }));

describe('useChangeVisibility patches the cached code from the answer (BH-23)', () => {
  it.each([
    ['private', 'active', 'private'],
    ['unlisted', 'private', 'active'],
    ['public', 'private', 'active'],
  ] as const)('to %s: QR-02 and the QR-01 row show it before any re-read', async (visibility, before, after) => {
    stubFetch({ [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: vehicle({ visibility }) } } });
    const { client, wrapper } = setup();
    client.setQueryData(qrCodeKey(VEHICLE_ID), code(before, before === 'private' ? 'private' : 'public'));
    client.setQueryData(qrListKey, [code(before, 'public'), code('active', 'public', '01other')]);
    const { result } = await renderHook(() => useChangeVisibility(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(visibility);
    });
    const one = client.getQueryData<QrCodeData>(qrCodeKey(VEHICLE_ID));
    expect(one?.scan_state).toBe(after);
    expect(one?.vehicle.visibility).toBe(visibility);
    const rows = client.getQueryData<QrCodeData[]>(qrListKey);
    expect(rows?.[0]?.scan_state).toBe(after);
    expect(rows?.[0]?.vehicle.visibility).toBe(visibility);
    // Another vehicle's row is left alone, and both still read again from the server.
    expect(rows?.[1]?.scan_state).toBe('active');
    expect(client.getQueryState(qrCodeKey(VEHICLE_ID))?.isInvalidated).toBe(true);
    expect(client.getQueryState(qrListKey)?.isInvalidated).toBe(true);
  });

  it('leaves a revoked code revoked', async () => {
    stubFetch({ [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: vehicle({ visibility: 'private' }) } } });
    const { client, wrapper } = setup();
    client.setQueryData(qrCodeKey(VEHICLE_ID), code('revoked', 'public'));
    const { result } = await renderHook(() => useChangeVisibility(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('private');
    });
    expect(client.getQueryData<QrCodeData>(qrCodeKey(VEHICLE_ID))?.scan_state).toBe('revoked');
  });
});

describe('no owned reads while the session changes hands (BH-28)', () => {
  it('mods, a mod, the sticker list and a sticker wait, and read once the change is through', async () => {
    const { calls } = stubFetch({
      [`/api/v1/vehicles/${VEHICLE_ID}/mods`]: list([]),
      '/api/v1/mods/01wheels': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } },
      '/api/v1/me/qr-codes': list([]),
      [`/api/v1/vehicles/${VEHICLE_ID}/qr`]: { body: { data: code('active', 'public') } },
    });
    useSessionStore.setState({ memberChanged: true });
    const { wrapper } = setup();
    await renderHook(
      () => {
        useVehicleMods(VEHICLE_ID);
        useOwnerMod('01wheels');
        useMyQrCodes();
        useQrCode(VEHICLE_ID);
      },
      { wrapper },
    );
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(calls).toHaveLength(0);
    await act(async () => useSessionStore.setState({ memberChanged: false }));
    await waitFor(() => expect(calls).toHaveLength(4));
  });
});
