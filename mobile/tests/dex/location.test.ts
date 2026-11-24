import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { __resetCitiesForTests, type CityRow, type CityStore } from '@/features/dex/cities';
import { allowLocation, locationStep, resolveSpotCity, skipLocation } from '@/features/dex/location';

import { containsCoordinates, LAT, LNG } from './helpers';

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));
jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const location = jest.mocked(Location);
const NEUSS: CityRow = [2864118, 'Neuss', 'NW', 51.198, 6.692, 152457];
const store: CityStore = {
  read: async () => ({ text: JSON.stringify({ v: 1, cities: [NEUSS] }), meta: { etag: null, checkedAt: Date.now() } }),
  write: async () => undefined,
  touch: async () => undefined,
};
const fix = { coords: { latitude: LAT, longitude: LNG, accuracy: 900, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: 1 };
const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as unknown as Location.LocationPermissionResponse;
const undetermined = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' } as unknown as Location.LocationPermissionResponse;
const blocked = { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as unknown as Location.LocationPermissionResponse;

beforeEach(async () => {
  jest.clearAllMocks();
  __resetCitiesForTests();
  await AsyncStorage.clear();
});

describe('locationStep: explain before the first system question', () => {
  it('explains once while the system may still ask', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(undetermined);
    expect(await locationStep()).toBe('explain');
    await skipLocation();
    expect(await locationStep()).toBe('off');
  });

  it('asks the system only from the sheet, and remembers that it did', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(undetermined);
    location.requestForegroundPermissionsAsync.mockResolvedValue(granted);
    expect(await allowLocation()).toBe(true);
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('sc.dexLocation')).toBe('asked');
  });

  it('goes without a city when blocked in the settings, and reads it when granted', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(blocked);
    expect(await locationStep()).toBe('off');
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    expect(await locationStep()).toBe('granted');
  });
});

describe('resolveSpotCity: coordinates never leave the module', () => {
  it('turns the last known fix into a city id and Bundesland, nothing else', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    location.getLastKnownPositionAsync.mockResolvedValue(fix);
    const city = await resolveSpotCity({ cities: { store } });
    expect(city).toEqual({ city_id: NEUSS[0], bundesland: 'NW' });
    expect(containsCoordinates(city)).toBe(false);
    expect(location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 600000, requiredAccuracy: 3000 });
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    // OS reverse geocoding would send the position to Google or Apple.
    expect(location.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it('asks for one approximate fix when there is no recent one', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    location.getLastKnownPositionAsync.mockResolvedValue(null);
    location.getCurrentPositionAsync.mockResolvedValue(fix);
    expect(await resolveSpotCity({ cities: { store } })).toEqual({ city_id: NEUSS[0], bundesland: 'NW' });
    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Low });
  });

  it('never asks and never reads without permission', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(undetermined);
    expect(await resolveSpotCity({ cities: { store } })).toBeNull();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('swallows failures whole: no log and no error carries the position', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => undefined));
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    location.getLastKnownPositionAsync.mockRejectedValue(new Error(`position ${LAT},${LNG} unavailable`));
    location.getCurrentPositionAsync.mockRejectedValue(new Error(`timeout at ${LAT}`));
    await expect(resolveSpotCity({ cities: { store }, timeoutMs: 50 })).resolves.toBeNull();
    for (const spy of spies) {
      expect(spy.mock.calls.some((call) => containsCoordinates(call.map(String).join(' ')))).toBe(false);
      spy.mockRestore();
    }
  });

  it('gives up after the timeout instead of holding the scan', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    location.getLastKnownPositionAsync.mockReturnValue(new Promise(() => undefined));
    location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    await expect(resolveSpotCity({ cities: { store }, timeoutMs: 20 })).resolves.toBeNull();
  });

  it('stores nothing with a coordinate on the device', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(granted);
    location.getLastKnownPositionAsync.mockResolvedValue(fix);
    await resolveSpotCity({ cities: { store } });
    const keys = await AsyncStorage.getAllKeys();
    const values = await AsyncStorage.multiGet(keys);
    expect(containsCoordinates(values)).toBe(false);
  });
});
