// Native modules are not available in Jest. Keep shared mocks here so every test file starts from the same base.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'de', languageTag: 'de-DE' }],
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-navigation-bar', () => ({ NavigationBar: { setStyle: jest.fn() } }));

// The official mock: src/ui/index.ts reaches this library through Sheet and StickyCTABar, and its native module is absent here.
jest.mock('react-native-keyboard-controller', () => jest.requireActual('react-native-keyboard-controller/jest'));

// The official mock of the network status (a file's own jest.mock still wins). Without it a suite that reaches the library only through
// an import chain (the API client's online manager) ran the real module: its reachability check read the absent native state and
// threw "Cannot read properties of undefined (reading 'isInternetReachable')" outside any test, which ended the whole in-band run.
jest.mock('@react-native-community/netinfo', () => jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock'));

// Every overlay brings a toast host, which reads the insets.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

// The official mocks of the gesture detector and the native module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

// It installs into the native UI runtime, which the worklets mock in Jest refuses to provide.
jest.mock('react-native-gesture-handler/src/handlers/gestures/installUIRuntimeBindings', () => ({
  installUIRuntimeBindings: jest.fn(),
}));
jest.mock('react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings', () => ({
  installUIRuntimeBindings: jest.fn(),
}));
