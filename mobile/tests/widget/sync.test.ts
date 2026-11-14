import { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { maintenanceKeys } from '@/api/queries/maintenance';
import { myVehiclesKey } from '@/api/queries/profile';
import i18n from '@/i18n';
import type { WidgetPhoto, WidgetSnapshot } from '@/features/widget/snapshot';
import { startWidgetSync, SYNC_DEBOUNCE_MS, type WidgetSync, type WidgetSyncDeps } from '@/features/widget/sync';
import type { SessionStatus } from '@/state/session';

import { R34, S15, upcoming, vehicle } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => new Promise(() => undefined)) }));
jest.mock('@/api/queries/profile', () => ({
  ...jest.requireActual('@/api/queries/profile'),
  fetchMyVehicles: jest.fn(() => new Promise(() => undefined)),
}));
jest.mock('@/api/queries/maintenance', () => {
  const actual = jest.requireActual('@/api/queries/maintenance');
  return { ...actual, maintenanceApi: { ...actual.maintenanceApi, upcoming: jest.fn(() => new Promise(() => undefined)) } };
});

type Session = { status: SessionStatus; member: { id: string } | null };

const PHOTO: WidgetPhoto = { uri: 'file:///docs/widget/car-m1-1080.jpg', mediaId: 'm1', source: 'https://cdn/1080.webp', width: 480, height: 600 };

function setup(initial: Session, flags: Record<string, boolean> = { android_widget: true, maintenance: true }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags }, confirmed: true });
  const session = create<Session>(() => initial);
  let stored: WidgetSnapshot | null = null;
  const deps = {
    queryClient,
    session,
    translate: () => ({ t: i18n.getFixedT('de', 'garage'), locale: 'de' as const }),
    unit: () => 'km' as const,
    read: jest.fn(async () => stored),
    write: jest.fn(async (next: WidgetSnapshot) => {
      stored = next;
    }),
    clearAll: jest.fn(() => {
      stored = null;
    }),
    prunePhotos: jest.fn(),
    photo: jest.fn(async () => PHOTO),
    publish: jest.fn(async () => undefined),
    now: () => new Date('2026-11-13T10:00:00Z'),
  } satisfies WidgetSyncDeps;
  return { queryClient, session, deps, stored: () => stored };
}

let sync: WidgetSync | null = null;

async function flush(running: WidgetSync) {
  await jest.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 10);
  await running.settled();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  sync?.stop();
  sync = null;
  jest.useRealTimers();
});

describe('widget sync', () => {
  it('writes the main car and its next item after the garage and maintenance queries answer, then pushes it', async () => {
    const { queryClient, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, [vehicle({ id: S15, is_main: false }), vehicle()]);
    queryClient.setQueryData(maintenanceKeys.upcoming, [upcoming({ days_left: 12, state: 'soon' })]);
    await flush(sync);
    expect(stored()).toMatchObject({
      member: 'member-1',
      locale: 'de',
      day: '2026-11-13',
      car: { id: R34, name: 'Skyline GT-R R34', photo: PHOTO, due: { title: 'HU/AU', days: 12, state: 'soon' }, dueKnown: true },
    });
    expect(deps.photo).toHaveBeenCalledWith(vehicle().cover, null);
    expect(deps.prunePhotos).toHaveBeenCalledWith(PHOTO.uri);
    expect(deps.publish).toHaveBeenCalledWith(stored());
  });

  it('writes nothing again while the content is the same (one write per change)', async () => {
    const { queryClient, deps } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    queryClient.setQueryData(myVehiclesKey, [vehicle({ title: 'Skyline GT-R R34 V-Spec' })]);
    await flush(sync);
    expect(deps.write).toHaveBeenCalledTimes(2);
  });

  it('waits for the garage list before writing anything', async () => {
    const { queryClient, deps } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(maintenanceKeys.upcoming, []);
    await flush(sync);
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('writes the empty car when the garage has none', async () => {
    const { queryClient, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, []);
    await flush(sync);
    expect(stored()?.car).toBeNull();
    expect(deps.photo).not.toHaveBeenCalled();
  });

  it('leaves the due item out while maintenance is off', async () => {
    const { queryClient, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } }, { android_widget: true });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(maintenanceKeys.upcoming, [upcoming()]);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    expect(stored()?.car).toMatchObject({ due: null, dueKnown: false });
  });

  it('clears the snapshot and redraws the empty widget on sign-out', async () => {
    const { queryClient, session, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    expect(stored()).not.toBeNull();
    session.setState({ status: 'guest', member: null });
    await sync.settled();
    expect(deps.clearAll).toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(deps.publish).toHaveBeenLastCalledWith(null);
    // Data arriving after sign-out writes nothing.
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    expect(stored()).toBeNull();
  });

  it("replaces another member's snapshot, and reads both lists on sign-in", async () => {
    const { session, deps, queryClient } = setup({ status: 'guest', member: null });
    const prefetch = jest.spyOn(queryClient, 'prefetchQuery');
    sync = startWidgetSync(deps);
    await sync.settled();
    session.setState({ status: 'member', member: { id: 'member-2' } });
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toEqual([myVehiclesKey, maintenanceKeys.upcoming]);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    deps.clearAll.mockClear();
    session.setState({ status: 'member', member: { id: 'member-3' } });
    await flush(sync);
    expect(deps.clearAll).toHaveBeenCalled();
  });

  it('keeps the widget empty while the flag is off', async () => {
    const { queryClient, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } }, { maintenance: true });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    expect(deps.write).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it('empties a written widget when the flag is switched off', async () => {
    const { queryClient, deps, stored } = setup({ status: 'member', member: { id: 'member-1' } });
    sync = startWidgetSync(deps);
    queryClient.setQueryData(myVehiclesKey, [vehicle()]);
    await flush(sync);
    queryClient.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: {} }, confirmed: true });
    await flush(sync);
    expect(stored()).toBeNull();
    expect(deps.publish).toHaveBeenLastCalledWith(null);
  });
});
