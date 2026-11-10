import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { appConfigKey, BUNDLED_APP_CONFIG, type Announcement } from '@/api/queries/appConfig';
import { meKey } from '@/api/queries/auth';
import { AnnouncementBanner } from '@/features/announcements/AnnouncementBanner';
import { DISMISSALS_STORAGE_KEY, resetDismissalsForTests } from '@/features/announcements/dismissals';
import { announcementLink, visibleAnnouncements } from '@/features/announcements/model';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderWithProviders, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, router: mockRouter, usePathname: () => '/' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const NOW = new Date('2026-11-09T12:00:00Z');

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: '01jann0000000000000000000a',
    title: 'Neue Kollektionen',
    body: 'Entdecke die Builds der Woche.',
    severity: 'info',
    link: '/discover',
    cta_label: 'Zu Entdecken',
    audience: 'all',
    dismissible: true,
    starts_at: null,
    ends_at: null,
    ...overrides,
  };
}

describe('which announcements a viewer sees (ADM-30)', () => {
  const member = { memberSince: '2026-11-01T10:00:00Z', vehicles: 0 };

  it('shows `all` to everyone and `new`, `with_vehicles` only to the members they name', () => {
    const list = [announcement({ id: 'a' }), announcement({ id: 'n', audience: 'new' }), announcement({ id: 'v', audience: 'with_vehicles' })];
    expect(visibleAnnouncements(list, null, new Set(), NOW).map((item) => item.id)).toEqual(['a']);
    expect(visibleAnnouncements(list, member, new Set(), NOW).map((item) => item.id)).toEqual(['a', 'n']);
    expect(visibleAnnouncements(list, { memberSince: '2026-09-01T10:00:00Z', vehicles: 2 }, new Set(), NOW).map((item) => item.id)).toEqual(['a', 'v']);
  });

  it('keeps to the schedule, hides a dismissed one unless it cannot be dismissed, and puts warnings first', () => {
    const list = [
      announcement({ id: 'early', starts_at: '2026-11-10T00:00:00Z' }),
      announcement({ id: 'over', ends_at: '2026-11-09T11:00:00Z' }),
      announcement({ id: 'gone' }),
      announcement({ id: 'stays', dismissible: false }),
      announcement({ id: 'warn', severity: 'warning' }),
    ];
    expect(visibleAnnouncements(list, null, new Set(['gone', 'stays']), NOW).map((item) => item.id)).toEqual(['warn', 'stays']);
  });

  it('opens an internal path in the app and only an https URL outside', () => {
    expect(announcementLink('/discover?make=bmw')).toEqual({ kind: 'internal', path: '/discover?make=bmw' });
    expect(announcementLink('https://speedclub.de/hilfe')).toEqual({ kind: 'external', url: 'https://speedclub.de/hilfe' });
    expect(announcementLink('//evil.example')).toBeNull();
    expect(announcementLink('javascript:alert(1)')).toBeNull();
    expect(announcementLink(null)).toBeNull();
  });
});

describe('AnnouncementBanner', () => {
  beforeAll(hydrateThemePreference);
  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    resetDismissalsForTests();
    await AsyncStorage.clear();
    stubFetch({});
    useSessionStore.setState({ status: 'guest', member: null });
    mockRouter.push.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  async function show(announcements: Announcement[]) {
    const client = newQueryClient();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, announcements }, confirmed: true });
    await renderWithProviders(<AnnouncementBanner routeId="HOME-01" />, client);
    await act(async () => undefined);
    return client;
  }

  it('shows title, body and the action, neutral for info; the action opens the path', async () => {
    await show([announcement()]);
    expect(screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a.title')).toHaveTextContent('Neue Kollektionen');
    expect(screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a').props.role).toBe('region');
    await fireEvent.press(screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a.cta'));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('marks a warning as an alert', async () => {
    await show([announcement({ severity: 'warning', title: 'Wartung heute Nacht' })]);
    const card = screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a');
    expect(card.props.role).toBe('alert');
    expect(card.props['aria-label']).toBe('Wichtig: Wartung heute Nacht');
  });

  it('hides a dismissed announcement and remembers it on the device', async () => {
    await show([announcement()]);
    await fireEvent.press(screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a.dismiss'));
    expect(screen.queryByTestId('HOME-01.announcement.01jann0000000000000000000a')).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(DISMISSALS_STORAGE_KEY)) ?? '[]')).toEqual(['01jann0000000000000000000a']);
  });

  it('shows a member-only announcement to a new member', async () => {
    useSessionStore.setState({ status: 'member' });
    const client = newQueryClient();
    client.setQueryData(meKey, { member_since: '2026-11-05T10:00:00Z', stats: { vehicles: 0, followers: 0, following: 0 } });
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, announcements: [announcement({ audience: 'new', link: null })] }, confirmed: true });
    await renderWithProviders(<AnnouncementBanner routeId="HOME-01" />, client);
    await act(async () => undefined);
    expect(screen.getByTestId('HOME-01.announcement.01jann0000000000000000000a')).toBeTruthy();
    expect(screen.queryByTestId('HOME-01.announcement.01jann0000000000000000000a.cta')).toBeNull();
  });
});
