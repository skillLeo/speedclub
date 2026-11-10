import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useOnline } from '@/state/online';

type NetInfoHandler = (state: { isConnected: boolean | null }) => void;

const mockHandlers = new Set<NetInfoHandler>();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (handler: NetInfoHandler) => {
      mockHandlers.add(handler);
      return () => mockHandlers.delete(handler);
    },
  },
}));

function Probe({ testID }: { testID: string }) {
  return <Text testID={testID}>{useOnline() ? 'online' : 'offline'}</Text>;
}

const emit = (isConnected: boolean | null) =>
  act(async () => {
    mockHandlers.forEach((handler) => handler({ isConnected }));
  });

async function renderTwo() {
  await render(
    <>
      <Probe testID="first" />
      <Probe testID="second" />
    </>,
  );
  expect(mockHandlers.size).toBe(2);
}

describe('useOnline on native', () => {
  afterEach(() => emit(true));

  it('updates every mounted instance when the connection drops and returns', async () => {
    await renderTwo();
    await emit(false);
    expect(screen.getByTestId('first')).toHaveTextContent('offline');
    expect(screen.getByTestId('second')).toHaveTextContent('offline');

    await emit(true);
    expect(screen.getByTestId('first')).toHaveTextContent('online');
    expect(screen.getByTestId('second')).toHaveTextContent('online');
  });

  it('treats an unknown connection as online', async () => {
    await renderTwo();
    await emit(false);
    await emit(null);
    expect(screen.getByTestId('second')).toHaveTextContent('online');
  });
});
