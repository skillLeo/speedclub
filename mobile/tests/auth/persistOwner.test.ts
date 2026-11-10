// BH-28: the persisted cache knows whose it is. One browser profile, two members: a restore for anybody else is dropped.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { persistOptions } from '@/api/queryClient';
import { setGuest, setMember, useSessionStore } from '@/state/session';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const KEY = 'sc.queryCache';
const LUKAS = { id: '01LUKAS', username: 'lukas.sc', displayName: null, avatarUrl: null };
const NINA = { id: '01NINA', username: 'nina.neu', displayName: null, avatarUrl: null };
const clientState = { mutations: [], queries: [] };

async function stored(owner?: string | null) {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ buster: persistOptions.buster, timestamp: Date.now(), clientState, ...(owner === undefined ? {} : { owner }) }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useSessionStore.setState({ status: 'loading', member: null, expiredFrom: null });
});

describe('restoring the persisted cache', () => {
  const restore = () => persistOptions.persister.restoreClient();

  it('hands it to its owner', async () => {
    await stored(LUKAS.id);
    setMember(LUKAS);
    await expect(restore()).resolves.toMatchObject({ clientState });
  });

  it('drops one that belongs to another member, on disk too', async () => {
    await stored(LUKAS.id);
    setMember(NINA);
    await expect(restore()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('never shows a guest what a member left behind', async () => {
    await stored(LUKAS.id);
    setGuest();
    await expect(restore()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('drops one without an owner for a member: a build from before the stamp, or a guest’s', async () => {
    await stored();
    setMember(LUKAS);
    await expect(restore()).resolves.toBeUndefined();
    await stored(null);
    await expect(restore()).resolves.toBeUndefined();
  });

  it('keeps a guest’s own cache for the guest', async () => {
    await stored(null);
    setGuest();
    await expect(restore()).resolves.toMatchObject({ clientState });
  });

  it('waits for the start to decide who this is', async () => {
    await stored(LUKAS.id);
    const restoring = Promise.resolve(restore());
    let done = false;
    void restoring.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);
    setMember(LUKAS);
    await expect(restoring).resolves.toMatchObject({ clientState });
  });
});

describe('writing the persisted cache', () => {
  const persist = async () => {
    await persistOptions.persister.persistClient({ buster: persistOptions.buster ?? '', timestamp: Date.now(), clientState });
    // The persister throttles its writes by a second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { owner?: string | null }) : null;
  };

  it('stamps the member who is signed in', async () => {
    setMember(LUKAS);
    await expect(persist()).resolves.toMatchObject({ owner: LUKAS.id });
  });

  it('stamps a guest as nobody', async () => {
    setGuest();
    await expect(persist()).resolves.toMatchObject({ owner: null });
  });

  it('writes nothing while an ended session is held for its form (BH-30)', async () => {
    useSessionStore.setState({ status: 'guest', member: null, expiredFrom: LUKAS.id });
    await expect(persist()).resolves.toBeNull();
  });
});
