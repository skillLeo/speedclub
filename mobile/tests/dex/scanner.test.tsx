import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useScanAction } from '@/features/dex/entry';
import { ScannerScreen } from '@/features/dex/screens/ScannerScreen';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, signOut, spotResponse, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/scan',
  router: { push: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));
jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockRequest = jest.fn(async () => mockPermission);
let mockScan: ((result: { type: string; data: string }) => void) | undefined;
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [mockPermission, mockRequest, mockRequest],
    CameraView: (props: { onBarcodeScanned?: (result: { type: string; data: string }) => void; testID?: string; children?: ReactNode }) => {
      mockScan = props.onBarcodeScanned;
      return <View testID={props.testID} />;
    },
  };
});
let mockWeb = false;
jest.mock('@/features/dex/availability', () => ({ scannerAvailable: () => !mockWeb }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

async function read(data: string) {
  await act(async () => {
    mockScan?.({ type: 'qr', data });
  });
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockWeb = false;
  mockPermission = { granted: true, canAskAgain: true };
  mockScan = undefined;
  onlineManager.setOnline(true);
  signIn();
});

describe('DEX-02 scanner', () => {
  it('web: "Spotten geht nur in der App", a badged sample and no camera', async () => {
    mockWeb = true;
    await renderScreen(<ScannerScreen />);
    expect(screen.getByText('Spotten geht nur in der App')).toBeTruthy();
    // The sample is a picture of the state, hidden from readers; the title and the button say what to do.
    expect(screen.getByTestId('DEX-02.web.card.sample', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('DEX-02.camera')).toBeNull();
    expect(mockScan).toBeUndefined();
  });

  it('reads only while idle and answers a foreign code calmly, without a request', async () => {
    const { fetchMock } = stubFetch({});
    await renderScreen(<ScannerScreen />);
    expect(screen.getByTestId('DEX-02.camera')).toBeTruthy();
    await read('https://example.com/C/7H2KQXMB');
    expect(screen.getByText('Das ist kein Speedclub Sticker')).toBeTruthy();
    // While the panel shows, the camera hands no reads over.
    expect(mockScan).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('DEX-02.scanAgain'));
    expect(mockScan).toBeDefined();
  });

  it('spots our sticker and opens the reveal', async () => {
    stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    await renderScreen(<ScannerScreen />);
    await read('https://speedclub.test/C/7H2KQXMB');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/dex/spot/[spotId]', params: { spotId: '01spot0000000000000000000a' } });
  });

  it('shows a refusal as a panel with the next step', async () => {
    stubFetch({ '/spots': { status: 409, body: { message: 'Eigenes Auto', code: 'spot_own_car', errors: {} } } });
    await renderScreen(<ScannerScreen />);
    await read('speedclub://c/7H2KQXMB');
    expect(screen.getByTestId('DEX-02.refused.own_car')).toBeTruthy();
    expect(screen.getByText('Das ist dein eigenes Auto')).toBeTruthy();
  });

  it('offline: "Gespeichert – wird gesendet, sobald du online bist"', async () => {
    const { fetchMock } = stubFetch({});
    onlineManager.setOnline(false);
    await renderScreen(<ScannerScreen />);
    await read('https://speedclub.test/C/7H2KQXMB');
    expect(screen.getByText('Gespeichert – wird gesendet, sobald du online bist')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('camera permission: explanation first, then the settings when blocked', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    const view = await renderScreen(<ScannerScreen />);
    expect(screen.getByTestId('DEX-02.permission.state')).toBeTruthy();
    await fireEvent.press(screen.getByText('Kamera erlauben'));
    expect(mockRequest).toHaveBeenCalled();
    await view.unmount();
    mockPermission = { granted: false, canAskAgain: false };
    await renderScreen(<ScannerScreen />);
    expect(screen.getByText('Einstellungen öffnen')).toBeTruthy();
  });

  it('a guest is asked to sign in', async () => {
    signOut();
    await renderScreen(<ScannerScreen />);
    expect(screen.getByTestId('DEX-02.guest.state')).toBeTruthy();
  });
});

describe('the SCAN button of HOME-01 and GAR-01', () => {
  it('is the Phosphor scan glyph named "Sticker scannen" and opens the scanner', async () => {
    const { result } = await renderHook(() => useScanAction('HOME-01'));
    expect(result.current).toMatchObject({ icon: 'scan', label: 'Sticker scannen', testID: 'HOME-01.scan' });
    await act(async () => result.current.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/scan');
  });

  it('asks a guest to sign in first', async () => {
    signOut();
    const { result } = await renderHook(() => useScanAction('GAR-01'));
    await act(async () => result.current.onPress());
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
