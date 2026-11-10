import { publicIdOf, retryUnlessAnswered, isEntryNotFound, isVehicleUnavailable } from '@/api/queries/vehicles';
import { ApiError } from '@/api/client';
import {
  categoryCounts,
  isMediaCategory,
  photoFields,
  photosIn,
  variantUrl,
  viewerImages,
  visiblePhotos,
} from '@/features/vehicle/media';
import {
  categoryIcon,
  changeLine,
  changeLines,
  groupByMonth,
  isProfileTab,
  keptSubline,
  mergeUpdates,
  modValues,
  ownerMeta,
  ownerName,
  previewPhotos,
  provenanceOf,
  specGroupsOf,
  specStripItems,
  sublineOf,
  withoutContent,
} from '@/features/vehicle/model';
import { routeStateOf } from '@/features/vehicle/states';

import { R34 } from './fixtures';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const update = R34.updates[1]!;

describe('what FS-3 shows', () => {
  it('reads the public id at the end of any slug, so a renamed slug keeps its cache', () => {
    expect(publicIdOf('nissan-skyline-gt-r-r34-5tf974vj')).toBe('5tf974vj');
    expect(publicIdOf('foo-5TF974VJ')).toBe('5tf974vj');
    expect(publicIdOf('5tf974vj')).toBe('5tf974vj');
  });

  it('joins the sub-line and keeps the four strip columns, with "–" for a value not entered', () => {
    expect(sublineOf(R34)).toBe('2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue');
    expect(specStripItems(R34)).toEqual([
      { value: '500', label: 'PS' },
      { value: '540', label: 'Nm' },
      { value: '2002', label: 'Baujahr' },
      { value: 'AWD', label: 'Antrieb' },
    ]);
    const empty = { spec_strip: R34.spec_strip.map((item) => ({ ...item, value: item.key === 'torque' ? null : item.value })) };
    expect(specStripItems(empty)[1]).toEqual({ value: '–', label: 'Nm' });
  });

  it('keeps each part of the sub-line whole and no line starts with its separator (DQ-167)', () => {
    expect(keptSubline(R34)).toBe('2002\u00A0· 2,6\u00A0l\u00A0R6\u00A0Biturbo\u00A0(RB26DETT)\u00A0· Bayside\u00A0Blue');
    // At a large font a part no longer fits one line and wraps at its own spaces, the separator stays with the part before it.
    expect(keptSubline(R34, false)).toBe('2002\u00A0· 2,6 l R6 Biturbo (RB26DETT)\u00A0· Bayside Blue');
    // A long engine text from a member would otherwise break inside a word.
    const long = 'Selbst aufgebauter Reihensechszylinder mit Einzeldrosselklappen';
    expect(keptSubline({ subline_parts: ['2002', long, ' '] })).toBe(`2002\u00A0· ${long}`);
  });

  it('names the owner as WEB-01 does', () => {
    const owner = R34.owner!;
    expect(ownerName(owner)).toBe('Lukas Scholz');
    expect(ownerMeta(owner)).toBe('@lukas.sc · Stuttgart');
    expect(ownerName({ ...owner, display_name: null })).toBe('@lukas.sc');
    expect(ownerMeta({ ...owner, city: null })).toBe('@lukas.sc');
  });

  it('shows a mod row\'s key values without the title in front', () => {
    const wheels = R34.highlights[0]!;
    expect(modValues(wheels)).toBe('18″ × 9,5J ET22 · 265/35 R18');
    expect(modValues({ title: 'HKS Super Turbo Muffler', summary_line: 'HKS Super Turbo Muffler' })).toBeUndefined();
    expect(modValues({ title: 'KW V3', summary_line: 'Gewindefahrwerk · −35 mm' })).toBe('Gewindefahrwerk · −35 mm');
  });

  it('maps category glyphs and falls back to the wrench', () => {
    expect(categoryIcon('wheel')).toBe('wheel');
    expect(categoryIcon('brake-disc')).toBe('brake-disc');
    expect(categoryIcon('rocket')).toBe('wrench');
    expect(categoryIcon(null)).toBe('wrench');
  });

  it('shows provenance under every value that is not the factory figure', () => {
    const power = R34.spec_groups.find((group) => group.key === 'power')!.rows[0]!;
    expect(provenanceOf(power)).toBe('Gemessen');
    expect(provenanceOf({ ...power, source: 'factory', source_label: 'Werksangabe' })).toBeUndefined();
    expect(provenanceOf({ ...power, source: null, source_label: null })).toBeUndefined();
    expect(specGroupsOf({ spec_groups: [...R34.spec_groups, { key: 'x', label: 'Leer', rows: [] }] })).toHaveLength(4);
  });

  it('previews the photos after the hero, at most four', () => {
    expect(previewPhotos(R34).map((photo) => photo.sort)).toEqual([2, 3]);
  });

  it('accepts only the four content tabs', () => {
    expect(isProfileTab('history')).toBe(true);
    expect(isProfileTab('compare')).toBe(false);
    expect(isProfileTab(undefined)).toBe(false);
  });

  it('strips photos, description, mods and Verlauf for qaState=empty', () => {
    const empty = withoutContent(R34);
    expect(empty.photos).toEqual([]);
    expect(empty.cover).toBeNull();
    expect(empty.description).toBeNull();
    expect(empty.mods).toEqual({ count: 0, groups: [] });
    expect(empty.updates_count).toBe(0);
    expect(empty.title).toBe(R34.title);
    expect(empty.owner).toEqual(R34.owner);
  });
});

describe('Verlauf', () => {
  it('groups entries by month in the order the API sends', () => {
    const months = groupByMonth(R34.updates);
    expect(months.map((month) => [month.label, month.updates.length])).toEqual([
      ['Mai 2026', 1],
      ['September 2024', 1],
      ['April 2024', 2],
      ['März 2023', 3],
    ]);
  });

  it('merges loaded pages by id behind the page\'s entries', () => {
    const extra = { ...update, id: 'older', month_label: 'Januar 2022' };
    const merged = mergeUpdates(R34.updates.slice(0, 2), [R34.updates[1]!, extra]);
    expect(merged.map((entry) => entry.id)).toEqual([R34.updates[0]!.id, R34.updates[1]!.id, 'older']);
  });

  it('writes a change as label and before → after, or the sentence when there is no after', () => {
    expect(changeLine(update.changes[0]!, update.type_label, 0)).toEqual({
      key: `${update.changes[0]!.modification_id}-0`,
      label: 'Bremsen',
      diff: 'Brembo Serie → AP Racing Radi-CAL · 356 mm',
    });
    const removed = { ...update.changes[0]!, before: 'KW V3', after: null, text: 'Fahrwerk: KW V3 entfernt', label: '' };
    expect(changeLine(removed, 'Modifikation entfernt', 1)).toMatchObject({ label: 'Modifikation entfernt', diff: 'Fahrwerk: KW V3 entfernt' });
    const added = { ...update.changes[0]!, before: null };
    expect(changeLine(added, '', 0).diff).toBe('AP Racing Radi-CAL · 356 mm');
  });

  it('counts the changes a list leaves out', () => {
    const many = { ...update, changes: [update.changes[0]!, update.changes[0]!, update.changes[0]!, update.changes[0]!], changes_count: 180 };
    const { lines, more } = changeLines(many, 3);
    expect(lines).toHaveLength(3);
    expect(more).toBe(177);
    expect(changeLines(R34.updates[0]!, 3)).toEqual({ lines: [], more: 0 });
  });
});

describe('photos', () => {
  const [cover, interior] = R34.photos;

  it('takes the smallest variant that fills the box on this screen', () => {
    expect(variantUrl(cover, 390, 1)).toMatch(/-640\.webp$/);
    expect(variantUrl(cover, 390, 3)).toMatch(/-1440\.webp$/);
    expect(variantUrl(cover, 160, 2)).toMatch(/-320\.webp$/);
    expect(variantUrl(null, 390, 1)).toBeNull();
  });

  it('keeps blurhash and focal point (§7)', () => {
    expect(photoFields(cover, 390)).toMatchObject({ blurhash: cover!.blurhash, focal: { x: 0.54, y: 0.66 } });
    expect(photoFields({ ...cover!, focal_x: null }, 390).focal).toBeNull();
    expect(photoFields(null, 390)).toEqual({ source: null });
  });

  it('gives the viewer the largest file, the stored ratio and the alt text', () => {
    const [first] = viewerImages(R34.photos, 'Nissan Skyline GT-R R34');
    expect(first).toMatchObject({ uri: expect.stringMatching(/-1440\.webp$/), aspectRatio: 1440 / 1920, alt: cover!.alt });
    const [unnamed] = viewerImages([{ ...interior!, alt: null }], 'Nissan Skyline GT-R R34');
    expect(unnamed!.alt).toBe('Nissan Skyline GT-R R34');
  });

  it('leaves out photos without a file, and counts categories in their fixed order', () => {
    const processing = { ...cover!, id: 'p', variants: [], status: 'processing' as const };
    expect(visiblePhotos([processing, ...R34.photos])).toHaveLength(3);
    expect(categoryCounts(R34.photos)).toEqual([
      { category: 'exterior', count: 1 },
      { category: 'interior', count: 1 },
      { category: 'engine', count: 1 },
    ]);
    expect(photosIn(R34.photos, 'interior').map((photo) => photo.id)).toEqual([interior!.id]);
    expect(isMediaCategory('wheels')).toBe(true);
    expect(isMediaCategory('selfie')).toBe(false);
  });
});

describe('route states', () => {
  const unavailable = new ApiError({ kind: 'not_found', status: 404, code: 'vehicle_unavailable', message: 'Fahrzeug nicht verfügbar.' });
  const missing = new ApiError({ kind: 'not_found', status: 404, code: 'not_found', message: 'Nicht gefunden.' });
  const server = new ApiError({ kind: 'server', status: 500, code: 'server', message: 'Fehler' });
  const idle = { data: undefined, error: null, isPending: true, fetchStatus: 'fetching' as const };

  it('tells a hidden vehicle from a missing entry, and never retries an answer', () => {
    expect(isVehicleUnavailable(unavailable)).toBe(true);
    expect(isEntryNotFound(unavailable)).toBe(false);
    expect(isEntryNotFound(missing)).toBe(true);
    expect(retryUnlessAnswered(0, unavailable)).toBe(false);
    expect(retryUnlessAnswered(0, server)).toBe(true);
    expect(retryUnlessAnswered(2, server)).toBe(false);
  });

  it('decides the state of a vehicle route', () => {
    expect(routeStateOf(idle, true, 'default')).toBe('loading');
    expect(routeStateOf({ ...idle, fetchStatus: 'paused' }, false, 'default')).toBe('offline');
    expect(routeStateOf({ ...idle, error: unavailable }, true, 'default')).toBe('unavailable');
    expect(routeStateOf({ ...idle, error: missing }, true, 'default')).toBe('notFound');
    expect(routeStateOf({ ...idle, error: server }, true, 'default')).toBe('error');
    expect(routeStateOf({ ...idle, error: server }, false, 'default')).toBe('offline');
    expect(routeStateOf({ ...idle, data: R34 }, false, 'default')).toBe('ready');
  });

  it('lets a 404 win over the copy a failed refetch keeps (ADR-141, ADR-148)', () => {
    const cached = { ...idle, data: R34, isPending: false, fetchStatus: 'idle' as const };
    expect(routeStateOf({ ...cached, error: unavailable }, true, 'default')).toBe('unavailable');
    expect(routeStateOf({ ...cached, error: unavailable }, false, 'default')).toBe('unavailable');
    expect(routeStateOf({ ...cached, error: missing }, true, 'default')).toBe('notFound');
    // A dropped connection or a server in trouble says nothing about the vehicle: the copy stays.
    expect(routeStateOf({ ...cached, error: server }, true, 'default')).toBe('ready');
    expect(routeStateOf({ ...cached, error: server }, false, 'default')).toBe('ready');
  });

  it('lets the QA matrix force every state', () => {
    const ready = { ...idle, data: R34 };
    expect(routeStateOf(ready, true, 'loading')).toBe('loading');
    expect(routeStateOf(ready, true, 'error')).toBe('error');
    expect(routeStateOf(ready, true, 'restricted')).toBe('unavailable');
    expect(routeStateOf(ready, true, 'empty')).toBe('ready');
  });
});
