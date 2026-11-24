/** M5.9a GAR-01 "Kennzeichen prüfen" (contract §4): the card, "Später", and the sheet's two decisions, against a stubbed API. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { PlateCheckCard, PlateCheckSheet, usePlateCheckCard } from '@/features/garage/components/PlateCheck';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui';
import { ToastHost } from '@/ui/ToastHost';

import { flushQueryNotifications, ME, renderScreen, signIn, stubFetch, type Answer } from '../garage/harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), Link: () => null }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

beforeAll(hydrateThemePreference);
beforeEach(signIn);
afterEach(async () => {
  await act(async () => {
    dismissToast();
  });
});

const item = (id: string, kind = 'vehicle') => ({
  media_id: id,
  kind,
  vehicle: kind === 'cover' ? null : { id: '01v', slug: 'nina-m3', name: 'BMW M3 Touring' },
  image: { url: `https://speedclub.test/media/${id}.webp`, width: 1600, height: 1200, thumbhash: null, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' },
});

const page = (data: unknown[], meta: Partial<{ count: number; dismissed: boolean; next_cursor: string | null }> = {}): Answer => ({
  body: {
    data,
    links: { first: null, last: null, prev: null, next: meta.next_cursor ? `https://speedclub.test/api/v1/me/plate-check?cursor=${meta.next_cursor}` : null },
    meta: { path: 'https://speedclub.test/api/v1/me/plate-check', per_page: 25, next_cursor: null, prev_cursor: null, count: data.length, dismissed: false, ...meta },
  },
});

function Check({ online = true, restriction = null }: { online?: boolean; restriction?: string | null }) {
  const card = usePlateCheckCard(true);
  const [open, setOpen] = useState(false);
  return (
    <>
      {card.visible ? <PlateCheckCard count={card.count} items={card.items} onOpen={() => setOpen(true)} /> : null}
      <PlateCheckSheet visible={open} onClose={() => setOpen(false)} online={online} restriction={restriction} />
      <ToastHost />
    </>
  );
}

const ready = async () => {
  await flushQueryNotifications();
  await flushQueryNotifications();
};

describe('GAR-01 plate check card', () => {
  it('shows while unchecked photos exist, with calm copy and their count', async () => {
    stubFetch({ '/me': ME, 'GET /me/plate-check': page([item('01a'), item('01b', 'cover')]) });
    await renderScreen(<Check />);
    await ready();
    expect(screen.getByTestId('GAR-01.plateCheck.card')).toBeTruthy();
    expect(screen.getByText('Kennzeichen prüfen')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.plateCheck.body')).toHaveTextContent(
      'Wir haben eine neue Funktion: Kennzeichen auf Fotos unkenntlich machen. Für deine 2 vorhandenen Fotos entscheidest du selbst, Foto für Foto.',
    );
  });

  it.each([
    ['nothing to check', page([], { count: 0 })],
    ['"Später" was chosen', page([item('01a')], { dismissed: true })],
    ['the endpoint is not there yet', { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } }],
  ])('stays hidden when %s', async (_case, answer) => {
    stubFetch({ '/me': ME, 'GET /me/plate-check': answer as Answer });
    await renderScreen(<Check />);
    await ready();
    expect(screen.queryByTestId('GAR-01.plateCheck.card')).toBeNull();
  });

  it('"Später" dismisses it for good', async () => {
    let dismissed = false;
    const { calls } = stubFetch({
      '/me': ME,
      'GET /me/plate-check': () => page([item('01a')], { dismissed }),
      'POST /me/plate-check/dismiss': () => {
        dismissed = true;
        return { status: 204, body: null };
      },
    });
    await renderScreen(<Check />);
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.later'));
    await ready();
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/me/plate-check/dismiss'))).toBe(true);
    expect(screen.queryByTestId('GAR-01.plateCheck.card')).toBeNull();
  });
});

describe('GAR-01 plate check sheet', () => {
  it('"Kein Kennzeichen sichtbar" keeps the photo as it is and takes it off the list', async () => {
    let left = [item('01a'), item('01b')];
    const { calls } = stubFetch({
      '/me': ME,
      'GET /me/plate-check': () => page(left),
      'POST /me/plate-check/01a': () => {
        left = left.filter((entry) => entry.media_id !== '01a');
        return { status: 204, body: null };
      },
    });
    await renderScreen(<Check />);
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.open'));
    await ready();
    expect(screen.getByTestId('GAR-01.plateCheck.item.01a')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.item.01a.keep'));
    await ready();
    const keep = calls.find((call) => call.method === 'POST' && call.path.endsWith('/me/plate-check/01a'));
    expect(keep?.body).toEqual({ decision: 'keep' });
    expect(screen.queryByTestId('GAR-01.plateCheck.item.01a')).toBeNull();
    expect(screen.getByTestId('GAR-01.plateCheck.item.01b')).toBeTruthy();
  });

  it('"Unkenntlich machen" opens the editor in GAR-08 mode and patches the photo after the confirm', async () => {
    let left = [item('01a')];
    const { calls } = stubFetch({
      '/me': ME,
      'GET /me/plate-check': () => page(left),
      'PATCH /media/01a': () => {
        left = [];
        return { body: { data: { id: '01a', status: 'processing', variants: [] } } };
      },
    });
    await renderScreen(<Check />);
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.open'));
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.item.01a.blur'));
    expect(screen.getByTestId('GAR-01.plateCheck.editor')).toBeTruthy();
    expect(screen.queryByTestId('GAR-01.plateCheck.editor.switch')).toBeNull();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.editor.apply'));
    expect(screen.getByText('Endgültig unkenntlich machen?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.confirm.apply'));
    await ready();
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.path).toMatch(/\/media\/01a$/);
    expect(patch?.body).toEqual({ blur_regions: [{ x: 0.32, y: 0.7, w: 0.36, h: 0.12 }] });
    expect(screen.queryByTestId('GAR-01.plateCheck.editor')).toBeNull();
    expect(screen.getByTestId('GAR-01.plateCheck.done')).toBeTruthy();
  });

  it('leaving the editor with changed rectangles asks first', async () => {
    stubFetch({ '/me': ME, 'GET /me/plate-check': page([item('01a')]) });
    await renderScreen(<Check />);
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.open'));
    await ready();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.item.01a.blur'));
    await fireEvent(screen.getByTestId('GAR-01.plateCheck.editor.stage'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.editor.add'));
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.editor.back'));
    expect(screen.getByText('Rechtecke verwerfen?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-01.plateCheck.discard.confirm'));
    expect(screen.getByTestId('GAR-01.plateCheck.list')).toBeTruthy();
  });

  // A 4xx, which the query does not retry by itself (a 5xx gets two automatic tries first).
  it('shows an error with retry when the list cannot load', async () => {
    let fail = true;
    stubFetch({
      '/me': ME,
      'GET /me/plate-check': () => (fail ? { status: 429, body: { message: 'Zu viele Anfragen', code: 'rate_limited', errors: {} } } : page([item('01a')])),
    });
    await renderScreen(<PlateCheckSheet visible onClose={jest.fn()} online restriction={null} />);
    await ready();
    expect(screen.getByTestId('GAR-01.plateCheck.error')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    await ready();
    expect(screen.getByTestId('GAR-01.plateCheck.item.01a')).toBeTruthy();
  });

  it('restricted or offline: the reason shows and both decisions are off', async () => {
    stubFetch({ '/me': ME, 'GET /me/plate-check': page([item('01a')]) });
    await renderScreen(<PlateCheckSheet visible onClose={jest.fn()} online={false} restriction="Dein Konto ist eingeschränkt." />);
    await ready();
    expect(screen.getByTestId('GAR-01.plateCheck.restricted')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.plateCheck.offline')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.plateCheck.item.01a.blur')).toBeDisabled();
    expect(screen.getByTestId('GAR-01.plateCheck.item.01a.keep')).toBeDisabled();
  });
});
