/**
 * The download sheet's controller (useQrDownload): one transfer at a time, also when a cancelled one settles only after
 * the next one started.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useQrDownload } from '@/features/qr/useQrDownload';

import { newQueryClient } from './harness';

type Transfer = { format: string; signal: AbortSignal; resolve: (value: unknown) => void; reject: (error: unknown) => void };

const mockTransfers: Transfer[] = [];
jest.mock('@/features/qr/download', () => ({
  downloadQr: (request: { format: string; signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      mockTransfers.push({ format: request.format, signal: request.signal, resolve, reject });
    }),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

function aborted(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

beforeEach(() => {
  mockTransfers.length = 0;
});

function setup(onDone = jest.fn()) {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useQrDownload({ vehicleId: 'v1', code: '8TR0Q3MC' }, onDone), { wrapper });
}

it('ignores a cancelled transfer that settles after the next one started', async () => {
  const onDone = jest.fn();
  const { result } = await setup(onDone);
  await act(async () => {
    void result.current.start('png');
  });
  await waitFor(() => expect(mockTransfers).toHaveLength(1));
  await act(async () => result.current.cancel());
  expect(mockTransfers[0]?.signal.aborted).toBe(true);
  await act(async () => {
    void result.current.start('svg');
  });
  await waitFor(() => expect(mockTransfers).toHaveLength(2));
  expect(result.current.active).toBe('svg');

  // The PNG only now reports its abort.
  await act(async () => {
    mockTransfers[0]?.reject(aborted());
  });
  expect(result.current.active).toBe('svg');

  // The SVG is still the one a start waits for, and the one a cancel reaches.
  await act(async () => {
    void result.current.start('pdf');
  });
  expect(mockTransfers).toHaveLength(2);
  await act(async () => result.current.cancel());
  expect(mockTransfers[1]?.signal.aborted).toBe(true);
  expect(result.current.active).toBeNull();
  expect(onDone).not.toHaveBeenCalled();
});

it('reports a finished transfer once, and a cancelled one that finished anyway not at all', async () => {
  const onDone = jest.fn();
  const { result } = await setup(onDone);
  await act(async () => {
    void result.current.start('png');
  });
  await waitFor(() => expect(mockTransfers).toHaveLength(1));
  await act(async () => result.current.cancel());
  await act(async () => {
    mockTransfers[0]?.resolve({ kind: 'shared' });
  });
  expect(onDone).not.toHaveBeenCalled();
  await act(async () => {
    void result.current.start('svg');
  });
  await waitFor(() => expect(mockTransfers).toHaveLength(2));
  await act(async () => {
    mockTransfers[1]?.resolve({ kind: 'shared' });
  });
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: 'shared' }, 'svg'));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(result.current.active).toBeNull();
});
