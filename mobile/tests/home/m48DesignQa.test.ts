// M4.8 design QA r1: captions without the repeated kind (DQ-1031), grouped Folge-ich updates (DQ-1027), the empty Folge ich's
// build suggestions (DQ-1026), the quote of Build der Woche (DQ-1032), the lead's row height (DQ-1024), the actor's car badge (DQ-1039).
import { actorCarCover } from '@/features/home/components/NotificationRow';
import { buildSuggestions, BUILD_SUGGESTIONS } from '@/features/home/components/FollowingStates';
import { changeCaption, withoutRepeatedKind } from '@/features/home/components/HomeFeedCard';
import { leadMinHeight } from '@/features/home/components/HomeLead';
import { boldRuns } from '@/features/home/components/SampleNotifications';
import { publicVehicleUrl } from '@/features/home/feedActions';
import { followingRows, weeklyQuote } from '@/features/home/screens/HomeScreen';

import { buildUpdate, feedVehicle, GTI, M4, R34, updateItem, vehicleItem } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('DQ-1031 feed captions', () => {
  it('drops the system the kind already names, in German and English', () => {
    expect(changeCaption({ type_label: 'Abgasanlage hinzugefügt', summary: 'Abgasanlage: Serie → Remus Sportauspuff' })).toBe(
      'Abgasanlage hinzugefügt: Serie → Remus Sportauspuff',
    );
    expect(changeCaption({ type_label: 'Exhaust added', summary: 'Exhaust: Stock → Remus' })).toBe('Exhaust added: Stock → Remus');
    expect(withoutRepeatedKind('Bremsen geändert', 'Bremsen: Serie → Brembo GT · 2 weitere')).toBe('Serie → Brembo GT · 2 weitere');
  });

  it('keeps a summary that does not start with the kind’s system', () => {
    expect(withoutRepeatedKind('Fahrwerk geändert', 'Felgen: 18″ → 19″')).toBe('Felgen: 18″ → 19″');
    expect(withoutRepeatedKind('Notiz', 'Saisonabschluss am Ring.')).toBe('Saisonabschluss am Ring.');
    expect(changeCaption({ type_label: 'Notiz', summary: '' })).toBe('Notiz');
  });
});

describe('DQ-1027 Folge ich', () => {
  it('groups consecutive updates of one build into one compact card, keeps a first publish as its card', () => {
    const ae86 = feedVehicle({ id: '01ae86', slug: 'ae86' });
    const rows = followingRows([
      updateItem(buildUpdate({ id: 'u1', vehicle: ae86 })),
      updateItem(buildUpdate({ id: 'u2', vehicle: ae86 })),
      vehicleItem(R34),
      updateItem(buildUpdate({ id: 'u3', vehicle: ae86 })),
      updateItem(buildUpdate({ id: 'u4', vehicle: M4 })),
    ]);
    expect(rows.map((row) => (row.kind === 'updates' ? `updates:${row.updates.map((update) => update.id).join('+')}` : row.kind))).toEqual([
      'updates:u1+u2',
      'card',
      'updates:u3',
      'updates:u4',
    ]);
  });
});

describe('DQ-1026 build suggestions', () => {
  it('takes featured and new builds once each, never the reader’s own, at most six', () => {
    const many = Array.from({ length: 8 }, (_, index) => feedVehicle({ id: `01n${index}`, slug: `n-${index}` }));
    const own = feedVehicle({ id: '01own', slug: 'own', owner: { ...GTI.owner!, username: 'me.myself' } });
    const out = buildSuggestions([[GTI, own], [GTI, ...many]], 'me.myself');
    expect(out).toHaveLength(BUILD_SUGGESTIONS);
    expect(out[0]?.id).toBe(GTI.id);
    expect(out.map((vehicle) => vehicle.id)).not.toContain('01own');
    expect(new Set(out.map((vehicle) => vehicle.id)).size).toBe(out.length);
  });
});

describe('DQ-1032 Build der Woche', () => {
  it('reads the editorial pick’s quote when the API sends one', () => {
    expect(weeklyQuote([{ source: 'editorial', vehicle: GTI, quote: null }, { source: 'editorial', vehicle: R34, quote: ' Jeder Kilometer selbst geschraubt. ' } as never])).toBe(
      'Jeder Kilometer selbst geschraubt.',
    );
    expect(weeklyQuote([{ source: 'editorial', vehicle: GTI, quote: null }, { source: 'editorial', vehicle: R34, quote: null }])).toBeNull();
  });
});

describe('DQ-1024 lead row', () => {
  it('reserves the whole photo: 4:5 on phones and tablets, 16:9 on the desktop and for Build der Woche', () => {
    expect(leadMinHeight(640, false)).toBe(800);
    expect(leadMinHeight(393, false)).toBe(492);
    expect(leadMinHeight(640, true)).toBe(360);
    expect(leadMinHeight(393, false, true)).toBe(222);
    expect(leadMinHeight(0, false)).toBe(0);
  });
});

describe('DQ-1039 and DQ-1033 notifications', () => {
  it('badges the avatar only when the API sends the actor’s car', () => {
    expect(actorCarCover({ username: 'lukas' })).toBeNull();
    expect(actorCarCover({ username: 'lukas', main_vehicle_cover: null })).toBeNull();
    expect(actorCarCover({ username: 'lukas', main_vehicle_cover: { id: 'm1' } })).toEqual({ id: 'm1' });
  });

  it('sets the actor and the car of a sample row in bold', () => {
    expect(boldRuns('Lukas hat ein Update zu seinem E46 M3 gepostet.', ['Lukas', 'E46 M3'])).toEqual([
      { text: 'Lukas', strong: true },
      { text: ' hat ein Update zu seinem ', strong: false },
      { text: 'E46 M3', strong: true },
      { text: ' gepostet.', strong: false },
    ]);
  });
});

describe('DQ-1025 share', () => {
  it('links the build’s public page', () => {
    expect(publicVehicleUrl('nissan-r34', 'https://speedclub.de/')).toBe('https://speedclub.de/v/nissan-r34');
    expect(publicVehicleUrl('nissan-r34', null)).toBeNull();
  });
});
