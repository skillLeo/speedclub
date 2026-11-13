// DQ-1023: the live component scales so an ONB page fits its window (floor 0.75), never above its own size.
import { LIVE_SCALE_FLOOR, liveScale } from '@/features/onboarding/OnboardingScreen';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('liveScale', () => {
  it('keeps the component at its size when it fits, scales it down when not, never below the floor', () => {
    expect(liveScale({ room: 600, natural: 400 })).toBe(1);
    expect(liveScale({ room: 340, natural: 400 })).toBeCloseTo(0.85);
    expect(liveScale({ room: 100, natural: 400 })).toBe(LIVE_SCALE_FLOOR);
    expect(liveScale({ room: 400, natural: 0 })).toBeNull();
  });
});
