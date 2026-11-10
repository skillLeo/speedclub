import { groupByDay, msUntilNextBerlinDay, notificationIcon, notificationTarget, notificationText } from '@/features/home/notifications';
import i18n from '@/i18n';

import { notification } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const de = i18n.getFixedT('de', 'home');
/** The sentence as read: the no-break space and the word joiner that keep a car name's last words together (DQ-305) do not show. */
const plain = (text: string) => text.replace(/\u00A0/g, ' ').replace(/\u2060/g, '');
const text = (...args: Parameters<typeof notificationText>) => plain(notificationText(...args));
const en = i18n.getFixedT('en', 'home');
const actor = (username: string) => ({ username, display_name: null, city: null, avatar: null });
const R34 = { id: '01r34', slug: 'nissan-skyline-gt-r-r34-xmeypf41', full_title: 'Nissan Skyline GT-R R34', cover: null };

describe('HOME-02 text, made in the app from type, actors and actor_count', () => {
  it('names new followers: one, two, and one plus the rest', () => {
    expect(text(notification(), de)).toBe('@lukas.sc folgt dir jetzt');
    expect(text(notification({ actors: [actor('lukas.sc'), actor('max.e46')], actor_count: 2 }), de)).toBe(
      '@lukas.sc und @max.e46 folgen dir jetzt',
    );
    expect(text(notification({ actors: [actor('lukas.sc'), actor('max.e46'), actor('nina.neu')], actor_count: 4 }), de)).toBe(
      '@lukas.sc und 3 weitere folgen dir jetzt',
    );
    expect(text(notification({ actors: [actor('lukas.sc'), actor('max.e46'), actor('nina.neu')], actor_count: 4 }), en)).toBe(
      '@lukas.sc and 3 others now follow you',
    );
  });

  it('says what a followed member published, alone or as a day of several', () => {
    const published = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'vehicle', update_id: null, vehicles: 1, updates: 0 } });
    expect(text(published, de)).toBe('@lukas.sc hat Nissan Skyline GT-R R34 veröffentlicht');
    const updated = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'update', update_id: 'u1', vehicles: 0, updates: 1 } });
    expect(text(updated, de)).toBe('@lukas.sc hat Nissan Skyline GT-R R34 aktualisiert');
    const day = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'update', update_id: 'u3', vehicles: 0, updates: 3 } });
    expect(text(day, de)).toBe('@lukas.sc hat 3 Build-Updates veröffentlicht');
    const mixed = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'vehicle', update_id: null, vehicles: 1, updates: 2 } });
    expect(text(mixed, en)).toBe('@lukas.sc posted 3 new builds and build updates');
  });

  it('counts saves without ever naming who saved', () => {
    const saved = notification({ type: 'build_saved', actors: [], actor_count: 3, vehicle: R34, details: { count: 3, week: '2026-W45' } });
    expect(text(saved, de)).toBe('3 Mitglieder haben deinen Build Nissan Skyline GT-R R34 gespeichert');
    expect(text({ ...saved, details: { count: 1 } }, de)).toBe('1 Mitglied hat deinen Build Nissan Skyline GT-R R34 gespeichert');
    expect(notificationIcon(saved)).toBe('bookmark-simple');
  });

  it('has one sentence per security event, and the device when the server names it', () => {
    const security = (details: Record<string, string | null>) => notification({ type: 'security', actors: [], actor_count: 0, details });
    expect(text(security({ event: 'password_changed', device_name: null }), de)).toBe('Dein Passwort wurde geändert. Warst du das nicht? Dann setz es über „Passwort vergessen“ zurück.');
    expect(text(security({ event: 'new_device', device_name: 'Pixel 9' }), de)).toBe(
      'Neue Anmeldung auf Pixel 9. Warst du das nicht? Dann ändere sofort dein Passwort.',
    );
    expect(text(security({ event: 'something_new', device_name: null }), de)).toBe('Eine Sicherheitseinstellung deines Kontos wurde geändert. Warst du das nicht? Dann ändere sofort dein Passwort.');
  });

  it('names "Ein Mitglied" when the actor is gone', () => {
    expect(text(notification({ actors: [], actor_count: 1 }), de)).toBe('Ein Mitglied folgt dir jetzt');
  });
});

describe('HOME-02 targets', () => {
  it('opens the follower, your Follower list for several, or your own profile', () => {
    expect(notificationTarget(notification(), 'nina.neu')).toBe('/u/lukas.sc');
    expect(notificationTarget(notification({ actor_count: 3, actors: [actor('lukas.sc'), actor('max.e46')] }), 'nina.neu')).toEqual({
      pathname: '/profile/connections',
      params: { tab: 'followers' },
    });
  });

  it('opens a build, its Verlauf entry, the member for a busy day, your vehicle for saves, the settings for security', () => {
    const update = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'update', update_id: 'u1', vehicles: 0, updates: 1 } });
    expect(notificationTarget(update, null)).toBe(`/v/${R34.slug}/updates/u1`);
    expect(notificationTarget({ ...update, details: { kind: 'vehicle', update_id: null, vehicles: 1, updates: 0 } }, null)).toBe(`/v/${R34.slug}`);
    expect(notificationTarget({ ...update, details: { kind: 'update', update_id: 'u3', vehicles: 0, updates: 3 } }, null)).toBe('/u/lukas.sc');
    expect(notificationTarget(notification({ type: 'build_saved', actors: [], vehicle: R34, details: { count: 2 } }), null)).toBe(`/garage/${R34.id}`);
    expect(notificationTarget(notification({ type: 'security', actors: [], details: { event: 'email_changed' } }), null)).toBe('/settings');
  });
});

describe('HOME-02 day groups (Europe/Berlin)', () => {
  const now = new Date('2026-11-08T10:00:00+01:00');
  it('heads each Berlin day once: Heute, Gestern, then the weekday and date', () => {
    const rows = groupByDay(
      [
        notification({ id: 'a', created_at: '2026-11-08T08:00:00+01:00' }),
        notification({ id: 'b', created_at: '2026-11-07T23:30:00+00:00' }),
        notification({ id: 'c', created_at: '2026-11-07T12:00:00+01:00' }),
        notification({ id: 'd', created_at: '2026-11-03T12:00:00+01:00' }),
        notification({ id: 'e', created_at: '2025-12-24T12:00:00+01:00' }),
      ],
      now,
      'de',
      de,
    );
    // 23:30 UTC on the 7th is already the 8th in Berlin.
    expect(rows.map((row) => (row.kind === 'day' ? `#${row.label}` : row.key))).toEqual([
      '#Heute',
      'a',
      'b',
      '#Gestern',
      'c',
      '#Di., 3. Nov.',
      'd',
      '#Mi., 24. Dez. 2025',
      'e',
    ]);
    expect(groupByDay([notification({ created_at: '2026-11-03T12:00:00+01:00' })], now, 'en', en)[0]).toMatchObject({ label: 'Tue 3 Nov' });
  });

  it('keeps a row without a date under the day before it', () => {
    const rows = groupByDay([notification({ id: 'a' }), notification({ id: 'b', created_at: null })], now, 'de', de);
    expect(rows.map((row) => row.key)).toEqual(['day.2026-11-08', 'a', 'b']);
  });
});

describe('the Berlin midnight', () => {
  it('counts the time to the next Berlin day, across the clock change too', () => {
    expect(msUntilNextBerlinDay(new Date('2026-11-08T23:59:00+01:00'))).toBe(60 * 1000);
    expect(msUntilNextBerlinDay(new Date('2026-07-01T22:00:00Z'))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilNextBerlinDay(new Date('2026-11-08T12:00:00+01:00'))).toBe(12 * 60 * 60 * 1000);
  });
});

describe('car names in a sentence (DQ-305)', () => {
  it('keep their last two words on one line, so a model code is never alone', () => {
    const saved = notification({ type: 'build_saved', actors: [], actor_count: 2, vehicle: { ...R34, full_title: 'Nissan Silvia S15' }, details: { count: 2 } });
    expect(notificationText(saved, en)).toContain('Nissan Silvia S15');
  });
});

describe('HOME-02 signature rows (M2.7)', () => {
  it('names a QR milestone and an HU/AU reminder, with and without the vehicle', () => {
    expect(text(notification({ type: 'qr_milestone', actors: [], actor_count: 0, vehicle: R34, details: { milestone: 1000 } }), de)).toBe(
      'Dein QR-Code für Nissan Skyline GT-R R34 wurde 1.000-mal gescannt',
    );
    expect(text(notification({ type: 'qr_milestone', actors: [], actor_count: 0, details: { milestone: 50 } }), en)).toBe(
      'One of your QR codes has been scanned 50 times',
    );
    expect(text(notification({ type: 'hu_au_reminder', actors: [], actor_count: 0, vehicle: R34, details: { due: '2027-03' } }), de)).toBe(
      'HU/AU für Nissan Skyline GT-R R34 ist im März 2027 fällig',
    );
    expect(text(notification({ type: 'hu_au_reminder', actors: [], actor_count: 0, details: { due: '2027-03' } }), en)).toBe(
      'Your HU/AU inspection is due in March 2027',
    );
    expect(text(notification({ type: 'hu_au_reminder', actors: [], actor_count: 0, details: {} }), de)).toBe('Neue Mitteilung');
  });

  it('opens QR-02 and GAR-06', () => {
    expect(notificationTarget(notification({ type: 'qr_milestone', vehicle: R34, details: { milestone: 10 } }), 'lukas.sc')).toBe('/qr/01r34');
    expect(notificationTarget(notification({ type: 'hu_au_reminder', vehicle: R34, details: { due: '2027-03' } }), 'lukas.sc')).toBe('/garage/01r34/specs');
    expect(notificationTarget(notification({ type: 'qr_milestone', vehicle: null }), 'lukas.sc')).toBe('/profile/qr');
    expect(notificationIcon({ type: 'qr_milestone' })).toBe('qr-code');
    expect(notificationIcon({ type: 'hu_au_reminder' })).toBe('clock');
  });

  it('words a catalogue request answer (M3.3) and opens the vehicle', () => {
    expect(text(notification({ type: 'catalog_request', actors: [], actor_count: 0, vehicle: R34, details: { outcome: 'accepted', requested: 'Nissan Skyline R34', reason: null } }), de)).toBe(
      'Dein Fahrzeug ist jetzt im Katalog: Nissan Skyline GT-R R34',
    );
    expect(
      text(notification({ type: 'catalog_request', actors: [], actor_count: 0, vehicle: null, details: { outcome: 'rejected', requested: 'Trabant P50', reason: 'Den Eintrag gibt es schon als Trabant P 50.' } }), de),
    ).toBe('Deine Katalog-Anfrage für Trabant P50 haben wir nicht übernommen. Grund: Den Eintrag gibt es schon als Trabant P 50.');
    expect(text(notification({ type: 'catalog_request', actors: [], actor_count: 0, vehicle: null, details: { outcome: 'rejected' } }), en)).toBe(
      'We didn’t add your catalogue request for your vehicle.',
    );
    expect(notificationTarget(notification({ type: 'catalog_request', vehicle: R34, details: { outcome: 'accepted' } }), 'lukas.sc')).toBe('/garage/01r34');
    expect(notificationIcon({ type: 'catalog_request' })).toBe('garage');
  });

  it('words a support reply (ADR-249) with its reference and opens the request', () => {
    const reply = notification({ type: 'support_reply', actors: [], actor_count: 0, vehicle: null, details: { ticket_id: '01JC8W5ZK3TQ9V', reference: 'SC-7H2KQXMB' } });
    expect(text(reply, de)).toBe('Das Team hat auf deine Anfrage SC-7H2KQXMB geantwortet');
    expect(text(reply, en)).toBe('The team replied to your request SC-7H2KQXMB');
    expect(notificationTarget(reply, 'lukas.sc')).toEqual({ pathname: '/settings/help/requests/[ticket]', params: { ticket: '01JC8W5ZK3TQ9V' } });
    expect(notificationIcon({ type: 'support_reply' })).toBe('lifebuoy');
    // Anything that is no reference or id is never shown or put into a path.
    const odd = notification({ type: 'support_reply', actors: [], actor_count: 0, vehicle: null, details: { ticket_id: '../x', reference: '<b>' } });
    expect(text(odd, de)).toBe('Das Team hat auf deine Support-Anfrage geantwortet');
    expect(notificationTarget(odd, 'lukas.sc')).toBe('/settings/help/requests');
  });
});
