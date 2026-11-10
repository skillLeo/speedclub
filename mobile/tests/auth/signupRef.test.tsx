/** ADR-216: `ref` on auth/register only when the sign-up began on a QR scan or a public page. */
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useRegister } from '@/api/queries/auth';
import { useReturnToParam } from '@/features/auth/forms';
import { forgetSignupOrigin, noteSignupOrigin, signupRef, signupRefForPath } from '@/features/auth/signupRef';
import { mapIncomingPath } from '@/features/shell/nativeIntent';
import { useSessionStore } from '@/state/session';

import { newQueryClient, stubFetch } from '../settings/harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={newQueryClient()}>{children}</QueryClientProvider>;

beforeEach(() => {
  forgetSignupOrigin();
  useSessionStore.setState({ status: 'guest', member: null, intent: null });
});

describe('signupRefForPath', () => {
  it('names the three sources, with or without the web base path, and nothing else', () => {
    expect(signupRefForPath('/c/AB12CD')).toBe('qr');
    expect(signupRefForPath('/app/C/AB12CD?x=1')).toBe('qr');
    expect(signupRefForPath('/v/bmw-m4-g82-lukas')).toBe('public_vehicle');
    expect(signupRefForPath('/app/v/bmw-m4-g82-lukas/mods/1')).toBe('public_vehicle');
    expect(signupRefForPath('/u/lukas.sc')).toBe('public_profile');
    for (const path of ['/', '/app', '/discover', '/sign-up', '/garage/01ABC', '/c/', '/vehicles', undefined, null]) {
      expect(signupRefForPath(path)).toBeNull();
    }
  });

  it('keeps the first source of the run: a scan that went on to its vehicle page stays a scan', () => {
    noteSignupOrigin('/discover');
    expect(signupRef()).toBeNull();
    noteSignupOrigin('/c/AB12CD');
    noteSignupOrigin('/v/bmw-m4');
    expect(signupRef()).toBe('qr');
  });
});

describe('where the source comes from', () => {
  it('native: the link that opened the app', () => {
    mapIncomingPath('https://speedclub.de/app/u/lukas.sc', ['speedclub.de']);
    expect(signupRef()).toBe('public_profile');
  });

  it('web: a public page hands `next` over; the app\'s own returnTo is no source', async () => {
    await renderHook(() => useReturnToParam({ returnTo: '/v/bmw-m4' }));
    expect(signupRef()).toBeNull();
    await renderHook(() => useReturnToParam({ next: '/v/bmw-m4' }));
    expect(signupRef()).toBe('public_vehicle');
  });
});

describe('auth/register', () => {
  const answer = { data: { email: 'neu@speedclub.test', resend_after_seconds: 60 } };

  it('sends ref when there is one, and no ref key otherwise', async () => {
    const { calls } = stubFetch({ '/auth/register': { status: 201, body: answer } });
    const { result } = await renderHook(() => useRegister(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'neu@speedclub.test', password: 'Boxer-Motor-2002', marketingConsent: false, ref: 'qr' }));
    await act(() => result.current.mutateAsync({ email: 'neu@speedclub.test', password: 'Boxer-Motor-2002', marketingConsent: false, ref: null }));
    await waitFor(() => expect(calls.length).toBe(2));
    const bodies = await Promise.all(calls.map((request) => request.clone().json() as Promise<Record<string, unknown>>));
    expect(bodies[0]?.ref).toBe('qr');
    expect(bodies[1]).not.toHaveProperty('ref');
  });
});
