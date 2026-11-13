import { emphasisRuns, groupByDay, groupBySection, matchesFilter, msUntilNextBerlinDay, notificationCategory, notificationHyphenates, notificationIcon, notificationTarget, notificationText, notificationThumb, sectionOf } from '@/features/home/notifications';
import i18n from '@/i18n';

import { notification } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const de = i18n.getFixedT('de', 'home');
/** The sentence as read: the no-break space and the word joiner that keep a car name's last words together (DQ-305) do not show. */
const plain = (text: string) => text.replace(/\u00A0/g, ' ').replace(/\u2060/g, '');
const text = (...args: Parameters<typeof notificationText>) => plain(notificationText(...args));
const en = i18n.getFixedT('en', 'home');
const actor = (username: string) => ({ username, display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false, main_vehicle_cover: null });
const R34 = { id: '01r34', slug: 'nissan-skyline-gt-r-r34-xmeypf41', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false };

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
      'Neue Anmeldung auf Pixel 9. Warst du das nicht? Dann sichere dein Konto mit „Das war ich nicht“.',
    );
    expect(text(security({ event: 'something_new', device_name: null }), de)).toBe('Eine Sicherheitseinstellung deines Kontos wurde geändert. Warst du das nicht? Dann sichere dein Konto mit „Das war ich nicht“.');
  });

  it('keeps a device name whole and sets its sentence without hyphenation (DQ-910)', () => {
    const security = (details: Record<string, string | null>) => notification({ type: 'security', actors: [], actor_count: 0, details });
    const emulator = security({ event: 'new_device', device_name: 'sdk_gphone64_arm64' });
    expect(notificationHyphenates(emulator)).toBe(false);
    expect(text(emulator, de)).toBe('Neue Anmeldung auf sdk_gphone64_arm64. Warst du das nicht? Dann sichere dein Konto mit „Das war ich nicht“.');
    // A short name keeps its spaces from breaking, a hyphenated one its hyphen.
    expect(notificationText(security({ event: 'new_device', device_name: 'iPhone 15 Pro' }), de)).toContain('iPhone\u00A015\u00A0Pro');
    expect(notificationText(security({ event: 'new_device', device_name: 'Galaxy S24-Ultra' }), en)).toContain('S24-\u2060Ultra');
    // Without a device name, and for every other type, the sentence hyphenates as running text.
    expect(notificationHyphenates(security({ event: 'new_device', device_name: null }))).toBe(true);
    expect(notificationHyphenates(security({ event: 'password_changed', device_name: 'Pixel 9' }))).toBe(true);
    expect(notificationHyphenates(notification())).toBe(true);
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
    // M4.7: a row with its SET-21 event opens the security log on that event (`security_event_id`, not in the OpenAPI type yet).
    expect(
      notificationTarget(notification({ type: 'security', actors: [], details: { event: 'new_device', security_event_id: '01jcz8q3m5w6x7y8z9a0b1c2d3' } as never }), null),
    ).toEqual({ pathname: '/settings/security/activity', params: { event: '01jcz8q3m5w6x7y8z9a0b1c2d3' } });
    expect(notificationTarget(notification({ type: 'security', actors: [], details: { event: 'email_changed', security_event_id: '../x' } as never }), null)).toBe('/settings');
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

describe('09 §7.4 HOME-02 2.0: chips, sections, bold names, the car photo', () => {
  const at = (iso: string) => notification({ created_at: iso });
  const now = new Date('2026-11-12T12:00:00+01:00');

  it('sorts every type into one chip: Builds, Social, Treffen or System', () => {
    expect(notificationCategory({ type: 'followed_published' })).toBe('builds');
    expect(notificationCategory({ type: 'build_saved' })).toBe('builds');
    expect(notificationCategory({ type: 'new_follower' })).toBe('social');
    expect(notificationCategory({ type: 'reaction' })).toBe('social');
    expect(notificationCategory({ type: 'event_reminder' })).toBe('events');
    expect(notificationCategory({ type: 'security' })).toBe('system');
    expect(notificationCategory({ type: 'support_reply' })).toBe('system');
    expect(matchesFilter({ type: 'security' }, 'all')).toBe(true);
    expect(matchesFilter({ type: 'security' }, 'builds')).toBe(false);
  });

  it('groups into Heute, Gestern, Diese Woche and Früher by the Berlin day', () => {
    const rows = groupBySection(
      [at('2026-11-12T09:00:00+01:00'), at('2026-11-11T23:30:00+01:00'), at('2026-11-08T10:00:00+01:00'), at('2026-11-05T10:00:00+01:00'), at('2026-10-01T10:00:00+02:00')],
      now,
      de,
    );
    expect(rows.filter((row) => row.kind === 'day').map((row) => row.kind === 'day' && row.label)).toEqual(['Heute', 'Gestern', 'Diese Woche', 'Früher']);
    expect(sectionOf(new Date('2026-11-06T10:00:00+01:00'), now)).toBe('week');
    expect(sectionOf(new Date('2026-11-05T10:00:00+01:00'), now)).toBe('earlier');
  });

  it('sets the members and the vehicle in bold, the rest plain', () => {
    const row = notification({ type: 'followed_published', vehicle: R34, details: { kind: 'vehicle', update_id: null, vehicles: 1, updates: 0 } });
    const sentence = notificationText(row, de);
    const runs = emphasisRuns(sentence, row);
    expect(runs.map((run) => run.text).join('')).toBe(sentence);
    expect(runs.filter((run) => run.strong).map((run) => plain(run.text))).toEqual(['@lukas.sc', 'Nissan Skyline GT-R R34']);
    expect(emphasisRuns('Kein Name hier', row)).toEqual([{ text: 'Kein Name hier', strong: false }]);
  });

  it('shows the car photo of the object, never on a security row', () => {
    const cover = { id: 'm', blurhash: null } as unknown as NonNullable<typeof R34.cover>;
    expect(notificationThumb({ type: 'followed_published', vehicle: { ...R34, cover } })).toBe(cover);
    expect(notificationThumb({ type: 'security', vehicle: { ...R34, cover } })).toBeNull();
    expect(notificationThumb({ type: 'followed_published', vehicle: null })).toBeNull();
  });

  it('never quotes the generic passkey name (DQ-999)', () => {
    const generic = text(notification({ type: 'security', actors: [], actor_count: 0, details: { event: 'passkey_added', device_name: 'Passkey' } }), de);
    expect(generic).not.toMatch(/„Passkey“/);
    const named = text(notification({ type: 'security', actors: [], actor_count: 0, details: { event: 'passkey_added', device_name: 'iCloud-Schlüsselbund' } }), de);
    expect(named).toMatch(/iCloud/);
  });
});
