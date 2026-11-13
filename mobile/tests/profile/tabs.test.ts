import { mergeProfileUpdates, type ProfileUpdate } from '@/api/queries/profile';
import type { BuildUpdate } from '@/api/queries/vehicles';
import { eventDateParts, garageColumns, profileTabs, profileUpdatePhotos, profileUpdateText } from '@/features/profile/components/ProfileTabs';
import { PROFILE_COLUMN_MAX, profileCover, profileCoverAspect, profileCoverHeight } from '@/features/profile/components/ProfileHeader';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const vehicle = { id: 'v1', slug: 's', full_title: 'BMW M3 E46', cover: null };
const entry = (id: string, created: string, hidden = false): ProfileUpdate => ({
  update: { id, created_at: created, hidden } as BuildUpdate,
  vehicle,
});

describe('PROF-01/02 tabs (09 §7.7)', () => {
  it('shows Treffen and Gespeichert only on the own profile and with their flags', () => {
    expect(profileTabs(true, { events: true, collections: true })).toEqual(['garage', 'updates', 'events', 'saved']);
    expect(profileTabs(true, { events: false, collections: true })).toEqual(['garage', 'updates', 'saved']);
    expect(profileTabs(false, { events: true, collections: true })).toEqual(['garage', 'updates']);
  });

  it('merges the builds’ updates newest first, without hidden ones, up to the limit', () => {
    const merged = mergeProfileUpdates(
      [
        [entry('a', '2026-06-01T10:00:00Z'), entry('b', '2026-06-03T10:00:00Z', true)],
        [entry('c', '2026-06-02T10:00:00Z'), entry('d', '2026-05-01T10:00:00Z')],
      ],
      2,
    );
    expect(merged.map((item) => item.update.id)).toEqual(['c', 'a']);
  });

  it('dates an event in its own time zone', () => {
    // 22:30 UTC on 14 June is 00:30 on 15 June in Berlin.
    expect(eventDateParts({ starts_at: '2026-06-14T22:30:00Z', timezone: 'Europe/Berlin' }, 'de-DE')).toEqual({ day: '15', month: 'Jun', time: '00:30' });
    expect(eventDateParts({ starts_at: null, timezone: 'Europe/Berlin' }, 'de-DE')).toBeNull();
  });
});

describe('PROF-01 cover', () => {
  it('takes the member’s own cover, else the main build’s photo', () => {
    const own = { id: 'own' } as never;
    const car = { id: 'car' } as never;
    expect(profileCover({ cover: own }, [car])).toBe(own);
    expect(profileCover({ cover: null }, [car])).toBe(car);
    expect(profileCover({ cover: null }, [])).toBeNull();
  });

  it('never repeats the first garage card’s photo when another build has one (DQ-1090)', () => {
    const car = { id: 'car' } as never;
    const second = { id: 'second' } as never;
    expect(profileCover({ cover: null }, [car, second])).toBe(second);
    expect(profileCover({ cover: car }, [car, null, second])).toBe(second);
    expect(profileCover({ cover: car }, [car])).toBe(car);
  });

  it('is 16:9 on every width, in the profile column on the desktop (ADR-451)', () => {
    expect(profileCoverAspect('phone')).toBe('16:9');
    expect(profileCoverAspect('desktop')).toBe('16:9');
    expect(profileCoverHeight(390, 'phone')).toBeCloseTo(219.375);
    expect(profileCoverHeight(1200, 'desktop')).toBeCloseTo(PROFILE_COLUMN_MAX / (16 / 9));
  });
});

describe('desktop Garage tab (09 §7.15)', () => {
  it('keeps one card per row on phones and tablets, puts 2 or 3 side by side in the wide column', () => {
    expect(garageColumns(353)).toBe(1);
    expect(garageColumns(600)).toBe(1);
    expect(garageColumns(800)).toBe(2);
    expect(garageColumns(1200)).toBe(3);
  });
});

describe('PROF-01 Updates rows (DQ-1093)', () => {
  const title = (key: string, values: { name: string; before?: string }) =>
    ({ added: `${values.name} verbaut`, replaced: `${values.name} statt ${values.before ?? ''}`, changed: `${values.name} geändert`, removed: `${values.name} ausgebaut` })[key] ?? key;
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const base = { created_at: '2023-03-13T10:00:00Z', note: null, photos: [], changes: [], changes_count: 0, hidden: false } as unknown as BuildUpdate;
  const r34 = { id: 'v1', slug: 's', full_title: 'Nissan Skyline GT-R R34', cover: { id: 'c1' } as never };

  it('names the change once: title from the parts, the system in the meta', () => {
    const update = {
      ...base,
      id: 'u1',
      type: 'mod_changed',
      type_label: 'Abgasanlage geändert',
      summary: 'Abgasanlage: Fujitsubo Legalis R → HKS Super Turbo Muffler',
      changes_count: 1,
      changes: [{ kind: 'mod', category: 'exhaust', modification_id: 'm1', label: 'Abgasanlage', before: 'Fujitsubo Legalis R', after: 'HKS Super Turbo Muffler', text: '', details: [] }],
    } as unknown as BuildUpdate;
    const text = profileUpdateText({ update, vehicle: r34 }, title, date);
    expect(text.title.replace(/\u00A0/g, ' ')).toBe('HKS Super Turbo Muffler statt Fujitsubo Legalis R');
    expect(text.meta.replace(/[\u00A0\u2060]/g, (char) => (char === '\u00A0' ? ' ' : ''))).toBe('Abgasanlage · 2023-03-13 · Nissan Skyline GT-R R34');
    expect(text.diff).toBeUndefined();
    // DQ-1126: the model code is bound to the word before it.
    expect(text.meta).toMatch(/\u00A0R34$/);
  });

  it('titles a note by its text, never "Notiz", and drops the repeated system of a summary', () => {
    const note = { ...base, id: 'u2', type: 'note', type_label: 'Notiz', summary: 'Bremse eingefahren', note: 'Bremse eingefahren' } as unknown as BuildUpdate;
    expect(profileUpdateText({ update: note, vehicle: r34 }, title, date).title).toBe('Bremse eingefahren');
    const specs = { ...base, id: 'u3', type: 'specs_changed', type_label: 'Räder hinzugefügt', summary: 'Räder: Serie 16″ → Work 18″' } as unknown as BuildUpdate;
    expect(profileUpdateText({ update: specs, vehicle: r34 }, title, date)).toMatchObject({ title: 'Räder hinzugefügt', diff: 'Serie 16″ → Work 18″' });
  });

  it('shows a build’s cover on its newest row only, the update’s own photo always', () => {
    const own = { id: 'p1' } as never;
    const rows = [
      { update: { ...base, id: 'a' }, vehicle: r34 },
      { update: { ...base, id: 'b', photos: [own] }, vehicle: r34 },
      { update: { ...base, id: 'c' }, vehicle: r34 },
    ] as ProfileUpdate[];
    expect(profileUpdatePhotos(rows)).toEqual([r34.cover, own, null]);
  });
});
