/**
 * BH-30 and ADR-175(c) in the real router: anyone but the member whose session ended drops the form under the sign-in. A replace does
 * not do that. The root stack keeps the old (tabs) below the new one, mounted, and a screen there would read its vehicle as the new
 * member the moment its query came back on. With every way a member can change, nothing of the old screens may stay or ask.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { adoptMe, meKey, type Me } from '@/api/queries/auth';
import { useVehicle } from '@/api/queries/garage';
import { queryClient } from '@/api/queryClient';
import { SessionHost } from '@/features/auth/SessionHost';
import { EditBasicsScreen } from '@/features/garage/screens/EditBasicsScreen';
import '@/i18n';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { DiscardGuardDialog } from '@/ui/DiscardGuardDialog';

import { vehicle, VEHICLE_ID } from '../garage/fixtures';
import { stubFetch } from '../settings/harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ NotificationFeedbackType: { Warning: 'warning' }, notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const VEHICLE = '01draft';
const ME: Me = {
  id: '01nina',
  email: 'nina@speedclub.test',
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  two_factor_enabled: false,
  username: 'nina.neu',
  username_change_available_at: null,
  display_name: 'Nina',
  city: null,
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 0, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};
const OTHER: Me = { ...ME, id: '01paul', email: 'paul@speedclub.test', username: 'paul.roadster', display_name: 'Paul' };

let tester: Awaited<ReturnType<typeof renderRouter>> | undefined;
function rendered() {
  if (!tester) throw new Error('Nothing rendered yet');
  return tester;
}

/** Mount and unmount of each probe, in order. */
const mounts: string[] = [];
function Probe({ id, children }: { id: string; children?: ReactNode }) {
  useEffect(() => {
    mounts.push(`+${id}`);
    return () => {
      mounts.push(`-${id}`);
    };
  }, [id]);
  return <View testID={id}>{children}</View>;
}

/** A garage editor as far as this is concerned: it reads the vehicle, and when asked to it guards a dirty form that stays. */
function Editor({ guard }: { guard: boolean }) {
  useVehicle(VEHICLE);
  return (
    <Probe id="editor">
      <DiscardGuardDialog dirty={guard} testID="editor.discard" />
    </Probe>
  );
}

let editorGuards = false;
const screenOf = (id: string) =>
  function ProbeScreen() {
    return <Probe id={id} />;
  };
const StackLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const TabsLayout = () => (
  <Tabs>
    <TabList style={{ display: 'none' }}>
      <TabTrigger name="home" href="/(tabs)/(home)" />
      <TabTrigger name="garage" href="/(tabs)/(garage)/garage" />
    </TabList>
    <TabSlot />
  </Tabs>
);
const RootLayout = () => (
  <GestureHandlerRootView>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <SessionHost />
      </ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);
const tree = () => ({
  _layout: { default: RootLayout },
  '(tabs)/_layout': { default: TabsLayout },
  '(tabs)/(home)/_layout': { default: StackLayout },
  '(tabs)/(home)/index': { default: screenOf('home') },
  '(tabs)/(garage)/_layout': { default: StackLayout },
  '(tabs)/(garage)/garage/index': { default: screenOf('garage') },
  '(tabs)/(garage)/garage/[id]/basics': { default: () => <Editor guard={editorGuards} /> },
  '(tabs)/(garage)/garage/[id]/real': { default: EditBasicsScreen },
  '(auth)/_layout': { default: StackLayout },
  '(auth)/sign-in': { default: screenOf('sign-in') },
  '(auth)/verify-email': { default: screenOf('verify-email') },
});

const memberOf = (me: Me) => ({ id: me.id, username: me.username ?? '', displayName: me.display_name, avatarUrl: null, nextStep: me.next_step });
const vehicleReads = (calls: Request[]) => calls.filter((call) => new URL(call.url).pathname.endsWith(`/vehicles/${VEHICLE}`));
const settled = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
  }
};

function serve(me: Me) {
  return stubFetch({
    '/auth/me': { body: { data: me } },
    [`/vehicles/${VEHICLE}`]: { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } },
  });
}

/** The member's editor, deep linked. A copy of the vehicle stands in, so it asks for nothing until the cache is gone. */
async function onEditor() {
  queryClient.setQueryData(meKey, ME);
  queryClient.setQueryData(['garage', 'vehicle', VEHICLE], { id: VEHICLE });
  setMember(memberOf(ME));
  tester = await renderRouter(tree(), { initialUrl: `/garage/${VEHICLE}/basics` });
  await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
}

/** The session ended under the editor, and the sign-in opened over it. */
async function signInOverEditor() {
  await onEditor();
  await act(async () => {
    useSessionStore.setState({ status: 'guest', member: null, expiredFrom: ME.id });
  });
  await act(async () => {
    router.push({ pathname: '/sign-in', params: { returnTo: `/garage/${VEHICLE}/basics` } });
  });
  await waitFor(() => expect(rendered().getPathname()).toBe('/sign-in'));
  useSessionStore.setState({ intent: { returnTo: `/garage/${VEHICLE}/basics` } });
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mounts.length = 0;
  editorGuards = false;
  queryClient.clear();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null, expiredFrom: null, memberChanged: false });
});
afterEach(() => queryClient.clear());

describe('another member signs in over a held editor', () => {
  it('goes home with the editor unmounted, and never reads its vehicle', async () => {
    await signInOverEditor();
    const { calls } = serve(OTHER);
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await settled();
    expect(mounts).toContain('-editor');
    expect(screen.queryByTestId('editor', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(vehicleReads(calls)).toEqual([]);
  });

  it('leaves one route on the root stack: nothing of the previous member lies below', async () => {
    await signInOverEditor();
    serve(OTHER);
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
    const root = rendered().getRouterState()?.routes[0]?.state;
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)']);
  });

  it('with an open step goes to that step, also without the editor below', async () => {
    await signInOverEditor();
    const open: Me = { ...OTHER, email_verified: false, next_step: 'verify_email' };
    const { calls } = serve(open);
    await act(async () => adoptMe(open));
    await waitFor(() => expect(rendered().getPathname()).toBe('/verify-email'));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await settled();
    expect(mounts).toContain('-editor');
    expect(vehicleReads(calls)).toEqual([]);
  });

  it('a form that guards goes without asking: its text belonged to the previous member (DiscardGuardDialog, memberChanged)', async () => {
    editorGuards = true;
    await signInOverEditor();
    serve(OTHER);
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(mounts).toContain('-editor'));
    expect(screen.queryByTestId('editor.discard.discard', { includeHiddenElements: true })).toBeNull();
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
  });
});

describe('GAR-05 itself, dirty, behind the sign-in', () => {
  const TEXT = 'Winterprojekt: Getriebe neu gelagert.';
  const catalogue = {
    '/catalog/makes': { body: { data: [{ id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true }], meta: { next_cursor: null } } },
    '/catalog/makes/34/models': { body: { data: [{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }], meta: { next_cursor: null } } },
    '/generations': { body: { data: [{ id: 120, name: 'R34', year_from: 1999, year_to: 2002 }], meta: { next_cursor: null } } },
    '/me/vehicles': { body: { data: [], meta: { next_cursor: null } } },
  };

  async function dirtyFormBehindSignIn() {
    queryClient.setQueryData(meKey, ME);
    setMember(memberOf(ME));
    stubFetch({ ...catalogue, '/auth/me': { body: { data: ME } }, [`/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } } });
    tester = await renderRouter(tree(), { initialUrl: `/garage/${VEHICLE_ID}/real` });
    await waitFor(() => expect(screen.getByTestId('GAR-05.description')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-05.description'), TEXT);
    await act(async () => {
      useSessionStore.setState({ status: 'guest', member: null, expiredFrom: ME.id });
    });
    await act(async () => {
      router.push({ pathname: '/sign-in', params: { returnTo: `/garage/${VEHICLE_ID}/real` } });
    });
    await waitFor(() => expect(rendered().getPathname()).toBe('/sign-in'));
    useSessionStore.setState({ intent: { returnTo: `/garage/${VEHICLE_ID}/real` } });
  }

  it('another member: the form goes with its data, so nothing asks, and its vehicle is never read', async () => {
    await dirtyFormBehindSignIn();
    const { calls } = stubFetch({ ...catalogue, '/auth/me': { body: { data: OTHER } } });
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await settled();
    expect(screen.queryByTestId('GAR-05.discard.discard', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('GAR-05.description', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByDisplayValue(TEXT, { includeHiddenElements: true })).toBeNull();
    expect(calls.filter((call) => new URL(call.url).pathname.endsWith(`/vehicles/${VEHICLE_ID}`))).toEqual([]);
  });

  it('the same member: the same form, with the text', async () => {
    await dirtyFormBehindSignIn();
    await act(async () => adoptMe(ME));
    await waitFor(() => expect(rendered().getPathname()).toBe(`/garage/${VEHICLE_ID}/real`));
    await settled();
    expect(screen.getByTestId('GAR-05.description').props.value).toBe(TEXT);
  });
});

describe('the same member signs in over a held editor', () => {
  it('finds the editor that was there, mounted once', async () => {
    await signInOverEditor();
    serve(ME);
    await act(async () => adoptMe(ME));
    await waitFor(() => expect(rendered().getPathname()).toBe(`/garage/${VEHICLE}/basics`));
    await settled();
    expect(mounts.filter((entry) => entry === '+editor')).toHaveLength(1);
    expect(mounts).not.toContain('-editor');
    expect(useSessionStore.getState().memberChanged).toBe(false);
  });
});

describe('the server answers for another member under a screen (BH-28)', () => {
  it('goes home on a fresh shell: the editor is unmounted and never asks', async () => {
    await onEditor();
    const { calls } = serve(OTHER);
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await settled();
    expect(mounts).toContain('-editor');
    expect(screen.queryByTestId('editor', { includeHiddenElements: true })).toBeNull();
    expect(vehicleReads(calls)).toEqual([]);
  });

  it('on Start too, where the address does not change', async () => {
    queryClient.setQueryData(meKey, ME);
    setMember(memberOf(ME));
    tester = await renderRouter(tree(), { initialUrl: `/garage/${VEHICLE}/basics` });
    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
    await act(async () => {
      router.replace('/');
    });
    await waitFor(() => expect(rendered().getPathname()).toBe('/'));
    const { calls } = serve(OTHER);
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
    await settled();
    expect(mounts).toContain('-editor');
    expect(vehicleReads(calls)).toEqual([]);
    expect(rendered().getPathname()).toBe('/');
  });
});
